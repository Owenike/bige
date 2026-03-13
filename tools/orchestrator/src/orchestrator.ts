import path from "node:path";
import {
  approvalStatusSchema,
  ciStatusSummarySchema,
  cleanupDecisionSchema,
  liveSmokeResultSchema,
  orchestratorStateJsonSchema,
  orchestratorStateSchema,
  parseWithDualValidation,
  patchStatusSchema,
  promotionStatusSchema,
  type CIStatusSummary,
  type CleanupDecision,
  type ExecutionMode,
  type ExecutorFallbackMode,
  type ExecutorProviderKind,
  type IterationRecord,
  type OrchestratorState,
  type PlannerProviderKind,
} from "./schemas";
import {
  ORCHESTRATOR_ACCEPTANCE_COMMANDS,
  shouldStopForPolicy,
} from "./policies";
import {
  OpenAIResponsesPlannerProvider,
  RuleBasedPlannerProvider,
  createNextIterationPlan,
  resolvePlannerDecision,
  type PlannerProvider,
} from "./planner";
import {
  OpenAIResponsesReviewerProvider,
  RuleBasedReviewerProvider,
  resolveReviewerVerdict,
  type ReviewerProvider,
} from "./reviewer";
import type { ExecutionProvider } from "./executor-adapters";
import { LocalRepoExecutor, MockExecutor, OpenAIResponsesExecutorProvider } from "./executor-adapters";
import type { StorageProvider } from "./storage";
import { FileStorage } from "./storage";
import type { GitHubStatusAdapter } from "./github";
import { MockGitHubStatusAdapter } from "./github";
import { transitionState } from "./workflows/state-machine";
import type { OpenAIResponsesClient } from "./openai";
import { NodeHttpsResponsesClient } from "./openai";
import { FileSystemWorkspaceManager } from "./workspace";
import { pruneOrchestratorArtifacts } from "./artifacts";
import {
  exportPatchBundle,
  preparePromotionBranch,
  promotePatchFromState,
  validatePatchPromotionPreconditions,
} from "./promotion";
import { inspectWorkspaceCleanup } from "./cleanup";
import { runOpenAIExecutorLiveSmoke } from "./live-smoke";

type ProviderMap<T> = Record<PlannerProviderKind, T | null>;
type ExecutorProviderMap = Record<ExecutorProviderKind, ExecutionProvider | null>;

export type OrchestratorDependencies = {
  storage: StorageProvider;
  plannerProviders: ProviderMap<PlannerProvider>;
  reviewerProviders: ProviderMap<ReviewerProvider>;
  executorProviders: ExecutorProviderMap;
  githubAdapter: GitHubStatusAdapter | null;
  workspaceManager: FileSystemWorkspaceManager;
  now?: () => Date;
};

function createIterationRecord(params: {
  iterationNumber: number;
  plannerProviderRequested: PlannerProviderKind;
  plannerProviderResolved: PlannerProviderKind;
  plannerFallbackReason: string | null;
  executionMode: ExecutionMode;
  stateBefore: OrchestratorState["status"];
  stateAfter: OrchestratorState["status"];
  now: Date;
}): IterationRecord {
  return {
    iterationNumber: params.iterationNumber,
    plannerProviderRequested: params.plannerProviderRequested,
    plannerProviderResolved: params.plannerProviderResolved,
    plannerFallbackReason: params.plannerFallbackReason,
    executorProviderRequested: null,
    executorProviderResolved: null,
    executorFallbackReason: null,
    executionMode: params.executionMode,
    reviewerProviderRequested: null,
    reviewerProviderResolved: null,
    reviewerFallbackReason: null,
    plannerDecision: null,
    executionReport: null,
    reviewVerdict: null,
    ciSummary: null,
    patchStatus: "none",
    approvalStatus: "not_requested",
    promotionStatus: "not_ready",
    liveAcceptanceStatus: "not_run",
    workspaceStatus: "unknown",
    exportArtifactPaths: [],
    artifactPruneResult: null,
    cleanupDecision: null,
    stateBefore: params.stateBefore,
    stateAfter: params.stateAfter,
    stopReason: null,
    createdAt: params.now.toISOString(),
    updatedAt: params.now.toISOString(),
  };
}

function upsertIterationRecord(
  state: OrchestratorState,
  iterationNumber: number,
  patch: Partial<IterationRecord>,
  now: Date,
) {
  const nextHistory = [...state.iterationHistory];
  const recordIndex = nextHistory.findIndex((record) => record.iterationNumber === iterationNumber);
  if (recordIndex === -1) {
    throw new Error(`Iteration record ${iterationNumber} is missing.`);
  }
  nextHistory[recordIndex] = {
    ...nextHistory[recordIndex],
    ...patch,
    updatedAt: now.toISOString(),
  };
  return orchestratorStateSchema.parse({
    ...state,
    iterationHistory: nextHistory,
    updatedAt: now.toISOString(),
  });
}

function appendIterationRecord(state: OrchestratorState, record: IterationRecord, now: Date) {
  return orchestratorStateSchema.parse({
    ...state,
    iterationHistory: [...state.iterationHistory, record],
    updatedAt: now.toISOString(),
  });
}

function persistStop(state: OrchestratorState, stopReason: string, now: Date) {
  let nextState =
    state.status === "stopped"
      ? orchestratorStateSchema.parse({
          ...state,
          stopReason,
          updatedAt: now.toISOString(),
        })
      : orchestratorStateSchema.parse({
          ...transitionState(state, "stopped", now),
          stopReason,
          pendingHumanApproval: false,
          nextIterationPlan: null,
          updatedAt: now.toISOString(),
        });
  if (nextState.iterationHistory.length > 0) {
    const lastIteration = nextState.iterationHistory[nextState.iterationHistory.length - 1];
    nextState = upsertIterationRecord(
      nextState,
      lastIteration.iterationNumber,
      {
        stateAfter: "stopped",
        stopReason,
      },
      now,
    );
  }
  return nextState;
}

function currentLoopStopReason(state: OrchestratorState) {
  if (state.iterationNumber >= state.task.maxIterations) {
    return "Maximum iterations reached.";
  }
  if (state.consecutiveFailures >= state.task.maxConsecutiveFailures) {
    return "Maximum consecutive failures reached.";
  }
  return null;
}

function findArtifactPath(report: NonNullable<OrchestratorState["lastExecutionReport"]>, kind: string) {
  return report.artifacts.find((artifact) => artifact.kind === kind)?.path ?? null;
}

function reportWorkspaceStatus(report: NonNullable<OrchestratorState["lastExecutionReport"]> | null) {
  return report && report.artifacts.some((artifact) => artifact.kind === "workspace" && artifact.path)
    ? "active"
    : "clean";
}

function appendArtifactsToReport(
  report: NonNullable<OrchestratorState["lastExecutionReport"]>,
  artifacts: Array<{ kind: string; label: string; path: string | null; value: string | null }>,
) {
  return {
    ...report,
    artifacts: [...report.artifacts, ...artifacts],
  };
}

function resolveExecutorProvider(params: {
  state: OrchestratorState;
  providers: ExecutorProviderMap;
}) {
  const preferred = params.providers[params.state.task.executorMode];
  if (preferred) {
    return {
      provider: preferred,
      resolved: preferred.kind,
      fallbackReason: null,
    };
  }

  if (params.state.task.executorFallbackMode === "blocked") {
    return {
      provider: null,
      resolved: null,
      fallbackReason: `${params.state.task.executorMode} executor provider is not configured.`,
    };
  }

  const fallback = params.providers[params.state.task.executorFallbackMode];
  if (!fallback) {
    return {
      provider: null,
      resolved: null,
      fallbackReason: `${params.state.task.executorMode} executor provider is unavailable and fallback ${params.state.task.executorFallbackMode} is not configured.`,
    };
  }

  return {
    provider: fallback,
    resolved: fallback.kind,
    fallbackReason: `${params.state.task.executorMode} executor provider is unavailable; falling back to ${fallback.kind}.`,
  };
}

function reportHasPatchArtifacts(state: OrchestratorState, report: NonNullable<OrchestratorState["lastExecutionReport"]>) {
  return (
    report.changedFiles.length > 0 &&
    report.artifacts.some((artifact) => artifact.kind === "workspace" && artifact.path) &&
    report.artifacts.some((artifact) => artifact.kind === "diff" && artifact.path)
  );
}

function shouldWaitForPatchApproval(state: OrchestratorState, report: NonNullable<OrchestratorState["lastExecutionReport"]>) {
  return state.task.executionMode === "apply" && reportHasPatchArtifacts(state, report);
}

export function createInitialState(params: {
  id: string;
  repoPath: string;
  repoName: string;
  userGoal: string;
  objective: string;
  subtasks: string[];
  allowedFiles: string[];
  forbiddenFiles: string[];
  successCriteria: string[];
  maxIterations?: number;
  maxConsecutiveFailures?: number;
  autoMode?: boolean;
  approvalMode?: "auto" | "human_approval";
  executorMode?: ExecutorProviderKind;
  executionMode?: ExecutionMode;
  executorFallbackMode?: ExecutorFallbackMode;
  workspaceRoot?: string | null;
  executorCommand?: string[];
  plannerProvider?: PlannerProviderKind;
  reviewerProvider?: PlannerProviderKind;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return parseWithDualValidation({
    schemaName: "OrchestratorState",
    zodSchema: orchestratorStateSchema,
    jsonSchema: orchestratorStateJsonSchema,
    data: {
      id: params.id,
      status: "draft",
      iterationNumber: 0,
      consecutiveFailures: 0,
      repeatedNoProgressCount: 0,
      pendingHumanApproval: false,
      task: {
        userGoal: params.userGoal,
        repoPath: params.repoPath,
        repoName: params.repoName,
        allowedFiles: params.allowedFiles,
        forbiddenFiles: params.forbiddenFiles,
        acceptanceGates: [...ORCHESTRATOR_ACCEPTANCE_COMMANDS],
        maxIterations: params.maxIterations ?? 5,
        maxConsecutiveFailures: params.maxConsecutiveFailures ?? 2,
        autoMode: params.autoMode ?? false,
        approvalMode: params.approvalMode ?? "human_approval",
        objective: params.objective,
        subtasks: params.subtasks,
        successCriteria: params.successCriteria,
        sameBoundary: true,
        specsClear: true,
        sameAcceptanceSuite: true,
        executorMode: params.executorMode ?? "mock",
        executionMode: params.executionMode ?? (params.executorMode === "mock" ? "mock" : "dry_run"),
        executorFallbackMode: params.executorFallbackMode ?? "blocked",
        workspaceRoot: params.workspaceRoot ?? null,
        executorCommand: params.executorCommand ?? [],
        plannerProvider: params.plannerProvider ?? "rule_based",
        reviewerProvider: params.reviewerProvider ?? "rule_based",
        artifactRetentionSuccess: 3,
        artifactRetentionFailure: 5,
      },
      plannerDecision: null,
      nextIterationPlan: null,
      lastExecutionReport: null,
      lastReviewVerdict: null,
      lastCIStatus: null,
      lastPlannerProvider: null,
      lastReviewerProvider: null,
      lastPlannerFallbackReason: null,
      lastReviewerFallbackReason: null,
      patchStatus: "none",
      approvalStatus: "not_requested",
      promotionStatus: "not_ready",
      workspaceStatus: "unknown",
      liveAcceptanceStatus: "not_run",
      exportArtifactPaths: [],
      lastArtifactPruneResult: null,
      lastLiveSmokeResult: null,
      lastCleanupDecision: null,
      stopReason: null,
      iterationHistory: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  });
}

async function planIteration(state: OrchestratorState, dependencies: OrchestratorDependencies, now: Date) {
  const planningStateBefore = state.status;
  const planningState = transitionState(state, "planning_started", now);
  const plannerResolution = await resolvePlannerDecision({
    input: {
      state: planningState,
      previousExecutionReport: planningState.lastExecutionReport,
    },
    preferredProvider: planningState.task.plannerProvider,
    providers: dependencies.plannerProviders,
  });

  const nextIterationPlan = createNextIterationPlan({
    state: planningState,
    plannerDecision: plannerResolution.decision,
  });

  let nextState = orchestratorStateSchema.parse({
    ...planningState,
    plannerDecision: plannerResolution.decision,
    nextIterationPlan,
    pendingHumanApproval: nextIterationPlan.approvalRequired,
    patchStatus: "plan_ready",
    approvalStatus: nextIterationPlan.approvalRequired ? "pending_plan" : "not_requested",
    lastPlannerProvider: plannerResolution.resolved,
    lastPlannerFallbackReason: plannerResolution.fallbackReason,
    stopReason: null,
    updatedAt: now.toISOString(),
  });

  nextState = appendIterationRecord(
    nextState,
    createIterationRecord({
      iterationNumber: nextIterationPlan.iterationNumber,
      plannerProviderRequested: plannerResolution.requested,
      plannerProviderResolved: plannerResolution.resolved,
      plannerFallbackReason: plannerResolution.fallbackReason,
      executionMode: nextIterationPlan.executionMode,
      stateBefore: planningStateBefore,
      stateAfter: nextIterationPlan.approvalRequired ? "waiting_approval" : "planning",
      now,
    }),
    now,
  );
  nextState = upsertIterationRecord(
    nextState,
    nextIterationPlan.iterationNumber,
    {
      plannerDecision: plannerResolution.decision,
      patchStatus: "plan_ready",
      approvalStatus: nextIterationPlan.approvalRequired ? "pending_plan" : "not_requested",
    },
    now,
  );

  if (nextIterationPlan.approvalRequired) {
    nextState = transitionState(nextState, "waiting_approval", now);
  }

  await dependencies.storage.saveState(nextState);
  return nextState;
}

export async function planOrchestratorIteration(stateId: string, dependencies: OrchestratorDependencies) {
  const initial = await dependencies.storage.loadState(stateId);
  if (!initial) throw new Error(`Orchestrator state ${stateId} was not found.`);
  if (initial.status === "waiting_approval" && initial.pendingHumanApproval) {
    return initial;
  }
  return planIteration(initial, dependencies, (dependencies.now ?? (() => new Date()))());
}

async function executePlannedIteration(
  state: OrchestratorState,
  dependencies: OrchestratorDependencies,
  now: Date,
) {
  if (!state.nextIterationPlan || !state.plannerDecision) {
    throw new Error("Execution requires an existing next iteration plan.");
  }

  let nextState = transitionState(state, "execution_started", now);
  nextState = orchestratorStateSchema.parse({
    ...nextState,
    pendingHumanApproval: false,
    approvalStatus: "not_requested",
    updatedAt: now.toISOString(),
  });
  await dependencies.storage.saveState(nextState);

  const executorResolution = resolveExecutorProvider({
    state,
    providers: dependencies.executorProviders,
  });
  if (!executorResolution.provider) {
    let stopped = upsertIterationRecord(
      nextState,
      state.nextIterationPlan.iterationNumber,
      {
        executorProviderRequested: state.task.executorMode,
        executorProviderResolved: null,
        executorFallbackReason: executorResolution.fallbackReason,
        executionMode: state.task.executionMode,
      },
      now,
    );
    stopped = persistStop(
      stopped,
      executorResolution.fallbackReason ?? "No executor provider is available.",
      now,
    );
    await dependencies.storage.saveState(stopped);
    return stopped;
  }

  const run = await executorResolution.provider.submitTask({
    iterationNumber: state.nextIterationPlan.iterationNumber,
    prompt: state.plannerDecision.nextPrompt,
    allowedFiles: state.plannerDecision.allowedFiles,
    forbiddenFiles: state.plannerDecision.forbiddenFiles,
    acceptanceCommands: state.plannerDecision.acceptanceCommands,
    repoPath: state.task.repoPath,
    metadata: {
      localCommand: state.task.executorMode === "local_repo" ? state.task.executorCommand : undefined,
      executionMode: state.task.executionMode,
      workspaceRoot: state.task.workspaceRoot,
      taskId: state.id,
      applyAllowed: state.task.executionMode !== "apply" || (state.task.autoMode && state.task.approvalMode === "auto"),
    },
  });

  nextState = transitionState(nextState, "awaiting_result", now);
  await dependencies.storage.saveState(nextState);
  await executorResolution.provider.pollRun(run.runId);

  const report = await executorResolution.provider.collectResult(run.runId);
  const reviewContextState = orchestratorStateSchema.parse({
    ...state,
    iterationNumber: report.iterationNumber,
    consecutiveFailures: report.blockers.length > 0 ? state.consecutiveFailures + 1 : state.consecutiveFailures,
    updatedAt: now.toISOString(),
  });

  nextState = transitionState(nextState, "validating", now);
  nextState = orchestratorStateSchema.parse({
    ...nextState,
    iterationNumber: report.iterationNumber,
    lastExecutionReport: report,
    consecutiveFailures: report.blockers.length > 0 ? nextState.consecutiveFailures + 1 : 0,
    patchStatus:
      reportHasPatchArtifacts(state, report) && state.task.executionMode === "apply" ? "patch_ready" : state.patchStatus,
    workspaceStatus: reportWorkspaceStatus(report),
    updatedAt: now.toISOString(),
  });
  nextState = upsertIterationRecord(
    nextState,
    report.iterationNumber,
    {
      executorProviderRequested: state.task.executorMode,
      executorProviderResolved: executorResolution.resolved,
      executorFallbackReason: executorResolution.fallbackReason,
      executionMode: state.task.executionMode,
      executionReport: report,
      patchStatus:
        reportHasPatchArtifacts(state, report) && state.task.executionMode === "apply" ? "patch_ready" : nextState.patchStatus,
      workspaceStatus: reportWorkspaceStatus(report),
      stateAfter: "validating",
    },
    now,
  );
  await dependencies.storage.saveState(nextState);

  let ciSummary: CIStatusSummary | null = report.ciValidation;
  if (!ciSummary && dependencies.githubAdapter && report.ciValidation?.runId) {
    ciSummary = await dependencies.githubAdapter.getRunSummary(report.ciValidation.runId);
  }
  if (ciSummary) {
    nextState = transitionState(nextState, ciSummary.status === "in_progress" ? "ci_running" : "validating", now);
    nextState = orchestratorStateSchema.parse({
      ...nextState,
      lastCIStatus: ciStatusSummarySchema.parse(ciSummary),
      updatedAt: now.toISOString(),
    });
    nextState = upsertIterationRecord(
      nextState,
      report.iterationNumber,
      {
        ciSummary,
        stateAfter: nextState.status,
      },
      now,
    );
    await dependencies.storage.saveState(nextState);
  }

  const reviewerResolution = await resolveReviewerVerdict({
    input: {
      state: reviewContextState,
      report,
      decision: state.plannerDecision,
      ciSummary,
    },
    preferredProvider: nextState.task.reviewerProvider,
    providers: dependencies.reviewerProviders,
  });

  const policyStopReason = shouldStopForPolicy({
    state: reviewContextState,
    report,
    decision: state.plannerDecision,
    reviewVerdict: reviewerResolution.verdict,
  });

  let nextStatus: OrchestratorState["status"] =
    reviewerResolution.verdict.verdict === "accept"
      ? report.shouldCloseSlice
        ? "completed"
        : "needs_revision"
      : reviewerResolution.verdict.verdict === "revise"
        ? "needs_revision"
        : reviewerResolution.verdict.verdict === "escalate"
          ? "blocked"
          : "stopped";

  if (policyStopReason) {
    nextStatus = "stopped";
  }

  const waitingForPatchApproval =
    !policyStopReason &&
    reviewerResolution.verdict.verdict === "accept" &&
    shouldWaitForPatchApproval(state, report);
  if (waitingForPatchApproval) {
    nextStatus = "waiting_approval";
  }

  nextState = transitionState(nextState, nextStatus, now);
  const repeatedNoProgress =
    reviewerResolution.verdict.reasons.some((reason) => reason.includes("same problem repeated")) ||
    reviewerResolution.verdict.reasons.some((reason) => reason.includes("same blocker repeated")) ||
    Boolean(policyStopReason?.includes("same"));
  const failureVerdict = reviewerResolution.verdict.verdict !== "accept";
  const nextConsecutiveFailures =
    failureVerdict && report.blockers.length === 0
      ? nextState.consecutiveFailures + 1
      : failureVerdict
        ? nextState.consecutiveFailures
        : 0;

  nextState = orchestratorStateSchema.parse({
    ...nextState,
    lastReviewVerdict: reviewerResolution.verdict,
    lastReviewerProvider: reviewerResolution.resolved,
    lastReviewerFallbackReason: reviewerResolution.fallbackReason,
    consecutiveFailures: nextConsecutiveFailures,
    repeatedNoProgressCount: repeatedNoProgress ? nextState.repeatedNoProgressCount + 1 : 0,
    pendingHumanApproval: waitingForPatchApproval ? true : false,
    nextIterationPlan: null,
    patchStatus: waitingForPatchApproval
      ? "waiting_approval"
      : reportHasPatchArtifacts(state, report) && state.task.executionMode === "apply" && reviewerResolution.verdict.verdict === "accept"
        ? "patch_ready"
        : nextState.patchStatus,
    approvalStatus: waitingForPatchApproval ? "pending_patch" : nextState.approvalStatus,
    workspaceStatus: reportWorkspaceStatus(report),
    stopReason:
      nextStatus === "stopped" || nextStatus === "blocked"
        ? policyStopReason ?? reviewerResolution.verdict.reasons.join(" | ")
        : null,
    updatedAt: now.toISOString(),
  });
  nextState = upsertIterationRecord(
    nextState,
    report.iterationNumber,
    {
      reviewerProviderRequested: reviewerResolution.requested,
      reviewerProviderResolved: reviewerResolution.resolved,
      reviewerFallbackReason: reviewerResolution.fallbackReason,
      reviewVerdict: reviewerResolution.verdict,
      ciSummary,
      patchStatus: waitingForPatchApproval
        ? "waiting_approval"
        : reportHasPatchArtifacts(state, report) && state.task.executionMode === "apply" && reviewerResolution.verdict.verdict === "accept"
          ? "patch_ready"
          : nextState.patchStatus,
      approvalStatus: waitingForPatchApproval ? "pending_patch" : nextState.approvalStatus,
      workspaceStatus: reportWorkspaceStatus(report),
      stateAfter: nextStatus,
      stopReason: nextState.stopReason,
    },
    now,
  );
  await dependencies.storage.saveState(nextState);

  return nextState;
}

export async function runOrchestratorOnce(stateId: string, dependencies: OrchestratorDependencies) {
  const nowFactory = dependencies.now ?? (() => new Date());
  let initial = await dependencies.storage.loadState(stateId);
  if (!initial) throw new Error(`Orchestrator state ${stateId} was not found.`);

  if (initial.task.workspaceRoot) {
    const cleanup = await cleanupStateWorkspaces(stateId, dependencies);
    initial = cleanup.state;
  }

  const loopStopReason = currentLoopStopReason(initial);
  if (loopStopReason) {
    const stopped = persistStop(initial, loopStopReason, nowFactory());
    await dependencies.storage.saveState(stopped);
    return stopped;
  }

  if (initial.status === "completed" || initial.status === "stopped" || initial.status === "blocked") {
    return initial;
  }

  if (initial.status === "waiting_approval" && initial.pendingHumanApproval) {
    return initial;
  }

  const now = nowFactory();
  const reusableApprovedPlan =
    initial.status === "waiting_approval" && !initial.pendingHumanApproval && Boolean(initial.nextIterationPlan);

  if (!reusableApprovedPlan) {
    const planned = await planIteration(initial, dependencies, now);
    if (planned.status === "waiting_approval") {
      return planned;
    }
    return executePlannedIteration(planned, dependencies, nowFactory());
  }

  return executePlannedIteration(initial, dependencies, nowFactory());
}

export async function runOrchestratorLoop(stateId: string, dependencies: OrchestratorDependencies) {
  for (;;) {
    let state = await dependencies.storage.loadState(stateId);
    if (!state) throw new Error(`Orchestrator state ${stateId} was not found.`);

    const loopStopReason = currentLoopStopReason(state);
    if (loopStopReason) {
      state = persistStop(state, loopStopReason, (dependencies.now ?? (() => new Date()))());
      await dependencies.storage.saveState(state);
      return state;
    }

    if (state.status === "completed" || state.status === "stopped") {
      return state;
    }
    if (state.status === "blocked") {
      state = persistStop(state, state.stopReason ?? "Execution blocked and requires manual intervention.", (dependencies.now ?? (() => new Date()))());
      await dependencies.storage.saveState(state);
      return state;
    }
    if (state.status === "waiting_approval" && state.pendingHumanApproval) {
      return state;
    }

    state = await runOrchestratorOnce(stateId, dependencies);

    if (state.status === "completed" || state.status === "stopped") {
      return state;
    }
    if (state.status === "blocked") {
      state = persistStop(state, state.stopReason ?? "Execution blocked and requires manual intervention.", (dependencies.now ?? (() => new Date()))());
      await dependencies.storage.saveState(state);
      return state;
    }
    if (state.status === "waiting_approval" && state.pendingHumanApproval) {
      return state;
    }
  }
}

export async function approvePendingPlan(stateId: string, dependencies: OrchestratorDependencies) {
  const state = await dependencies.storage.loadState(stateId);
  if (!state) throw new Error(`Orchestrator state ${stateId} was not found.`);
  if (state.status !== "waiting_approval" || !state.pendingHumanApproval || !state.nextIterationPlan) {
    throw new Error("State is not waiting for approval.");
  }

  const approved = orchestratorStateSchema.parse({
    ...state,
    pendingHumanApproval: false,
    approvalStatus: "approved",
    stopReason: null,
    updatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  });
  const nextIterationNumber = state.nextIterationPlan.iterationNumber;
  const approvedNow = dependencies.now ?? (() => new Date());
  const approvedWithRecord = upsertIterationRecord(
    approved,
    nextIterationNumber,
    {
      patchStatus: state.patchStatus,
      approvalStatus: "approved",
      stateAfter: "planning",
    },
    approvedNow(),
  );
  await dependencies.storage.saveState(approvedWithRecord);
  return approvedWithRecord;
}

export async function rejectPendingPlan(stateId: string, dependencies: OrchestratorDependencies, reason?: string) {
  const state = await dependencies.storage.loadState(stateId);
  if (!state) throw new Error(`Orchestrator state ${stateId} was not found.`);
  if (state.status !== "waiting_approval" || !state.pendingHumanApproval || !state.nextIterationPlan) {
    throw new Error("State is not waiting for approval.");
  }

  const now = (dependencies.now ?? (() => new Date()))();
  let rejected = transitionState(state, "blocked", now);
  rejected = orchestratorStateSchema.parse({
    ...rejected,
    pendingHumanApproval: false,
    patchStatus: "rejected",
    approvalStatus: "rejected",
    stopReason: reason ?? "Human approval rejected the planned iteration.",
    nextIterationPlan: null,
    updatedAt: now.toISOString(),
  });
  rejected = upsertIterationRecord(
    rejected,
    state.nextIterationPlan.iterationNumber,
    {
      patchStatus: "rejected",
      approvalStatus: "rejected",
      stopReason: rejected.stopReason,
      stateAfter: "blocked",
    },
    now,
  );
  await dependencies.storage.saveState(rejected);
  return rejected;
}

export async function approvePendingPatch(stateId: string, dependencies: OrchestratorDependencies) {
  const state = await dependencies.storage.loadState(stateId);
  if (!state) throw new Error(`Orchestrator state ${stateId} was not found.`);
  const issues = validatePatchPromotionPreconditions(state);
  if (issues.length > 0) {
    throw new Error(`Patch approval preconditions failed: ${issues.join(" | ")}`);
  }

  const now = (dependencies.now ?? (() => new Date()))();
  const exportRoot = path.join(state.task.repoPath, ".tmp", "orchestrator-promotion");
  const exportBundle = await exportPatchBundle({
    state,
    exportRoot,
  });
  const branchPrep = await preparePromotionBranch({
    state,
    createBranch: false,
  });

  const nextStatus =
    state.lastExecutionReport?.shouldCloseSlice && state.lastReviewVerdict?.verdict === "accept" ? "completed" : "needs_revision";

  let approved = orchestratorStateSchema.parse({
    ...state,
    pendingHumanApproval: false,
    status: nextStatus,
    patchStatus: patchStatusSchema.parse("promotion_ready"),
    approvalStatus: approvalStatusSchema.parse("approved"),
    promotionStatus: promotionStatusSchema.parse("promotion_ready"),
    exportArtifactPaths: [exportBundle.patchExportPath, exportBundle.manifestPath],
    stopReason: null,
    updatedAt: now.toISOString(),
  });
  if (approved.lastExecutionReport) {
    approved = orchestratorStateSchema.parse({
      ...approved,
      lastExecutionReport: appendArtifactsToReport(approved.lastExecutionReport, [
        {
          kind: "patch_export",
          label: "patch export",
          path: exportBundle.patchExportPath,
          value: exportBundle.branchName,
        },
        {
          kind: "promotion_manifest",
          label: "promotion manifest",
          path: exportBundle.manifestPath,
          value: exportBundle.prTitle,
        },
        {
          kind: "branch_metadata",
          label: "branch metadata",
          path: null,
          value: branchPrep.branchReason,
        },
      ]),
      updatedAt: now.toISOString(),
    });
  }
  approved = upsertIterationRecord(
    approved,
    state.lastExecutionReport!.iterationNumber,
    {
      executionReport: approved.lastExecutionReport,
      patchStatus: "promotion_ready",
      approvalStatus: "approved",
      promotionStatus: "promotion_ready",
      exportArtifactPaths: [exportBundle.patchExportPath, exportBundle.manifestPath],
      stateAfter: nextStatus,
    },
    now,
  );
  await dependencies.storage.saveState(approved);
  return approved;
}

export async function rejectPendingPatch(stateId: string, dependencies: OrchestratorDependencies, reason?: string) {
  const state = await dependencies.storage.loadState(stateId);
  if (!state) throw new Error(`Orchestrator state ${stateId} was not found.`);
  if (!state.lastExecutionReport || state.patchStatus !== "waiting_approval") {
    throw new Error("State is not waiting for patch approval.");
  }

  const now = (dependencies.now ?? (() => new Date()))();
  let rejected = transitionState(state, "blocked", now);
  rejected = orchestratorStateSchema.parse({
    ...rejected,
    pendingHumanApproval: false,
    patchStatus: "rejected",
    approvalStatus: "rejected",
    stopReason: reason ?? "Human approval rejected patch promotion.",
    updatedAt: now.toISOString(),
  });
  rejected = upsertIterationRecord(
    rejected,
    state.lastExecutionReport.iterationNumber,
    {
      patchStatus: "rejected",
      approvalStatus: "rejected",
      stateAfter: "blocked",
      stopReason: rejected.stopReason,
    },
    now,
  );
  await dependencies.storage.saveState(rejected);
  return rejected;
}

export async function promoteApprovedPatch(
  stateId: string,
  dependencies: OrchestratorDependencies,
  options?: { applyWorkspace?: boolean; createBranch?: boolean },
) {
  const state = await dependencies.storage.loadState(stateId);
  if (!state) throw new Error(`Orchestrator state ${stateId} was not found.`);
  if (!state.lastExecutionReport) {
    throw new Error("Promotion requires an execution report.");
  }
  if (state.approvalStatus !== "approved") {
    throw new Error("Promotion requires an approved patch.");
  }
  if (state.patchStatus !== "promotion_ready" && state.patchStatus !== "approved_for_apply") {
    throw new Error(`Promotion requires promotion_ready state, received ${state.patchStatus}.`);
  }
  const issues = validatePatchPromotionPreconditions(state);
  if (issues.length > 0) {
    throw new Error(`Patch promotion preconditions failed: ${issues.join(" | ")}`);
  }

  const now = (dependencies.now ?? (() => new Date()))();
  const branchPrep = await preparePromotionBranch({
    state,
    createBranch: options?.createBranch ?? true,
  });

  let report = state.lastExecutionReport;
  if (options?.applyWorkspace) {
    const promotion = await promotePatchFromState({
      state,
      workspaceManager: dependencies.workspaceManager,
    });
    report = appendArtifactsToReport(report, [
      {
        kind: "promotion",
        label: "promotion summary",
        path: null,
        value: `Applied ${promotion.changedFiles.length} files from ${promotion.workspacePath}.`,
      },
    ]);
  }

  report = appendArtifactsToReport(report, [
    {
      kind: "promotion_branch",
      label: "promotion branch",
      path: null,
      value: branchPrep.branchName,
    },
    {
      kind: "pr_ready",
      label: "pr ready metadata",
      path: null,
      value: `${branchPrep.prTitle}\n\n${branchPrep.prBody}`,
    },
  ]);

  let promoted = orchestratorStateSchema.parse({
    ...state,
    status:
      state.lastExecutionReport.shouldCloseSlice && state.lastReviewVerdict?.verdict === "accept"
        ? "completed"
        : "needs_revision",
    patchStatus: patchStatusSchema.parse(options?.applyWorkspace ? "applied" : "promoted"),
    promotionStatus: promotionStatusSchema.parse("promoted"),
    lastExecutionReport: report,
    stopReason: null,
    updatedAt: now.toISOString(),
  });
  promoted = upsertIterationRecord(
    promoted,
    state.lastExecutionReport.iterationNumber,
    {
      executionReport: report,
      patchStatus: options?.applyWorkspace ? "applied" : "promoted",
      promotionStatus: "promoted",
      stateAfter: promoted.status,
    },
    now,
  );
  await dependencies.storage.saveState(promoted);
  return promoted;
}

export async function pruneStateArtifacts(
  stateId: string,
  dependencies: OrchestratorDependencies,
  policy?: { retainRecentSuccess?: number; retainRecentFailure?: number },
) {
  const state = await dependencies.storage.loadState(stateId);
  if (!state) throw new Error(`Orchestrator state ${stateId} was not found.`);
  const pruned = await pruneOrchestratorArtifacts({
    state,
    workspaceManager: dependencies.workspaceManager,
    now: (dependencies.now ?? (() => new Date()))(),
    policy,
  });
  await dependencies.storage.saveState(orchestratorStateSchema.parse(pruned.state));
  return pruned;
}

export async function cleanupStateWorkspaces(
  stateId: string,
  dependencies: OrchestratorDependencies,
  options?: { staleMinutes?: number },
) {
  const state = await dependencies.storage.loadState(stateId);
  if (!state) throw new Error(`Orchestrator state ${stateId} was not found.`);
  const decision = cleanupDecisionSchema.parse(
    await inspectWorkspaceCleanup({
      state,
      workspaceManager: dependencies.workspaceManager,
      now: (dependencies.now ?? (() => new Date()))(),
      staleMinutes: options?.staleMinutes,
    }),
  );
  let updated = orchestratorStateSchema.parse({
    ...state,
    workspaceStatus: decision.workspaceStatus,
    lastCleanupDecision: decision,
    updatedAt: decision.cleanedAt,
  });
  if (state.iterationHistory.length > 0) {
    const lastIteration = state.iterationHistory[state.iterationHistory.length - 1];
    updated = upsertIterationRecord(
      updated,
      lastIteration.iterationNumber,
      {
        workspaceStatus: decision.workspaceStatus,
        cleanupDecision: decision,
      },
      new Date(decision.cleanedAt),
    );
  }
  await dependencies.storage.saveState(updated);
  return {
    state: updated,
    result: decision,
  };
}

export async function runLiveSmoke(params: {
  repoPath: string;
  workspaceRoot?: string;
  outputRoot?: string;
  model?: string;
  openaiClient?: OpenAIResponsesClient | null;
  enabled?: boolean;
}) {
  const result = await runOpenAIExecutorLiveSmoke({
    apiKey: process.env.OPENAI_API_KEY,
    enabled: params.enabled ?? true,
    model: params.model,
    workspaceRoot: params.workspaceRoot,
    outputRoot: params.outputRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-live-smoke"),
    client: params.openaiClient ?? undefined,
  });
  return liveSmokeResultSchema.parse(result);
}

export async function runLiveAcceptance(params: {
  stateId?: string;
  dependencies?: OrchestratorDependencies;
  repoPath: string;
  workspaceRoot?: string;
  outputRoot?: string;
  model?: string;
  openaiClient?: OpenAIResponsesClient | null;
  enabled?: boolean;
}) {
  const result = await runLiveSmoke({
    repoPath: params.repoPath,
    workspaceRoot: params.workspaceRoot,
    outputRoot: params.outputRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-live-acceptance"),
    model: params.model,
    openaiClient: params.openaiClient,
    enabled: params.enabled,
  });

  if (params.stateId && params.dependencies) {
    const state = await params.dependencies.storage.loadState(params.stateId);
    if (!state) throw new Error(`Orchestrator state ${params.stateId} was not found.`);
    let updated = orchestratorStateSchema.parse({
      ...state,
      liveAcceptanceStatus: result.status,
      lastLiveSmokeResult: result,
      updatedAt: result.ranAt,
    });
    if (state.iterationHistory.length > 0) {
      const lastIteration = state.iterationHistory[state.iterationHistory.length - 1];
      updated = upsertIterationRecord(
        updated,
        lastIteration.iterationNumber,
        {
          liveAcceptanceStatus: result.status,
        },
        new Date(result.ranAt),
      );
    }
    await params.dependencies.storage.saveState(updated);
  }

  return result;
}

export function createDefaultDependencies(params: {
  repoPath: string;
  storageRoot?: string;
  executorMode?: ExecutorProviderKind;
  mockCiStatus?: CIStatusSummary;
  openaiClient?: OpenAIResponsesClient | null;
  workspaceRoot?: string;
}) {
  const storage = new FileStorage(params.storageRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-state"));
  const responsesClient =
    params.openaiClient ??
    (process.env.OPENAI_API_KEY ? new NodeHttpsResponsesClient(process.env.OPENAI_API_KEY) : null);
  const workspaceManager = new FileSystemWorkspaceManager(
    params.workspaceRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-workspaces"),
  );

  const plannerProviders: ProviderMap<PlannerProvider> = {
    rule_based: new RuleBasedPlannerProvider(),
    openai: responsesClient ? new OpenAIResponsesPlannerProvider({ client: responsesClient }) : null,
  };
  const reviewerProviders: ProviderMap<ReviewerProvider> = {
    rule_based: new RuleBasedReviewerProvider(),
    openai: responsesClient ? new OpenAIResponsesReviewerProvider({ client: responsesClient }) : null,
  };
  const executorProviders: ExecutorProviderMap = {
    mock: new MockExecutor(),
    local_repo: new LocalRepoExecutor(),
    openai_responses: responsesClient
      ? new OpenAIResponsesExecutorProvider({
          client: responsesClient,
          workspaceManager,
        })
      : null,
  };
  const githubAdapter = params.mockCiStatus ? new MockGitHubStatusAdapter(params.mockCiStatus) : null;
  return {
    storage,
    plannerProviders,
    reviewerProviders,
    executorProviders,
    githubAdapter,
    workspaceManager,
  } satisfies OrchestratorDependencies;
}
