import path from "node:path";
import {
  ciStatusSummarySchema,
  orchestratorStateJsonSchema,
  orchestratorStateSchema,
  parseWithDualValidation,
  type CIStatusSummary,
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

type ProviderMap<T> = Record<PlannerProviderKind, T | null>;
type ExecutorProviderMap = Record<ExecutorProviderKind, ExecutionProvider | null>;

export type OrchestratorDependencies = {
  storage: StorageProvider;
  plannerProviders: ProviderMap<PlannerProvider>;
  reviewerProviders: ProviderMap<ReviewerProvider>;
  executorProviders: ExecutorProviderMap;
  githubAdapter: GitHubStatusAdapter | null;
  now?: () => Date;
};

function createIterationRecord(params: {
  iterationNumber: number;
  plannerProviderRequested: PlannerProviderKind;
  plannerProviderResolved: PlannerProviderKind;
  plannerFallbackReason: string | null;
  stateBefore: OrchestratorState["status"];
  stateAfter: OrchestratorState["status"];
  now: Date;
}): IterationRecord {
  return {
    iterationNumber: params.iterationNumber,
    plannerProviderRequested: params.plannerProviderRequested,
    plannerProviderResolved: params.plannerProviderResolved,
    plannerFallbackReason: params.plannerFallbackReason,
    reviewerProviderRequested: null,
    reviewerProviderResolved: null,
    reviewerFallbackReason: null,
    plannerDecision: null,
    executionReport: null,
    reviewVerdict: null,
    ciSummary: null,
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
    updatedAt: now.toISOString(),
  });
  await dependencies.storage.saveState(nextState);

  const executorResolution = resolveExecutorProvider({
    state,
    providers: dependencies.executorProviders,
  });
  if (!executorResolution.provider) {
    const stopped = persistStop(
      nextState,
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
    updatedAt: now.toISOString(),
  });
  nextState = upsertIterationRecord(
    nextState,
    report.iterationNumber,
    {
      executionReport: report,
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
    pendingHumanApproval: false,
    nextIterationPlan: null,
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
  const initial = await dependencies.storage.loadState(stateId);
  if (!initial) throw new Error(`Orchestrator state ${stateId} was not found.`);

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
    stopReason: null,
    updatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  });
  await dependencies.storage.saveState(approved);
  return approved;
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
    stopReason: reason ?? "Human approval rejected the planned iteration.",
    nextIterationPlan: null,
    updatedAt: now.toISOString(),
  });
  rejected = upsertIterationRecord(
    rejected,
    state.nextIterationPlan.iterationNumber,
    {
      stopReason: rejected.stopReason,
      stateAfter: "blocked",
    },
    now,
  );
  await dependencies.storage.saveState(rejected);
  return rejected;
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
  } satisfies OrchestratorDependencies;
}
