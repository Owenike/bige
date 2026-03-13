import path from "node:path";
import {
  ciStatusSummarySchema,
  orchestratorStateJsonSchema,
  orchestratorStateSchema,
  parseWithDualValidation,
  type CIStatusSummary,
  type OrchestratorState,
} from "./schemas";
import { ORCHESTRATOR_ACCEPTANCE_COMMANDS } from "./policies";
import { createNextIterationPlan, RuleBasedPlanner, type PlannerProvider } from "./planner";
import { RuleBasedReviewer, type ReviewerProvider } from "./reviewer";
import type { ExecutionProvider } from "./executor-adapters";
import { MockExecutor, LocalRepoExecutor } from "./executor-adapters";
import type { StorageProvider } from "./storage";
import { FileStorage } from "./storage";
import type { GitHubStatusAdapter } from "./github";
import { MockGitHubStatusAdapter } from "./github";
import { transitionState } from "./workflows/state-machine";

export type OrchestratorDependencies = {
  storage: StorageProvider;
  planner: PlannerProvider;
  reviewer: ReviewerProvider;
  executor: ExecutionProvider;
  githubAdapter: GitHubStatusAdapter | null;
  now?: () => Date;
};

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
  executorMode?: "mock" | "local_repo";
  executorCommand?: string[];
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
        executorCommand: params.executorCommand ?? [],
      },
      plannerDecision: null,
      nextIterationPlan: null,
      lastExecutionReport: null,
      lastReviewVerdict: null,
      lastCIStatus: null,
      stopReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  });
}

export async function runOrchestratorOnce(stateId: string, dependencies: OrchestratorDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const initial = await dependencies.storage.loadState(stateId);
  if (!initial) throw new Error(`Orchestrator state ${stateId} was not found.`);

  let state = transitionState(initial, "planning_started", now());
  const plannerDecision = await dependencies.planner.plan({
    state,
    previousExecutionReport: state.lastExecutionReport,
  });
  const nextIterationPlan = createNextIterationPlan({
    state,
    plannerDecision,
  });

  state = orchestratorStateSchema.parse({
    ...state,
    plannerDecision,
    nextIterationPlan,
    pendingHumanApproval: nextIterationPlan.approvalRequired,
    updatedAt: now().toISOString(),
  });
  await dependencies.storage.saveState(state);

  if (nextIterationPlan.approvalRequired) {
    return state;
  }

  state = transitionState(state, "execution_started", now());
  await dependencies.storage.saveState(state);

  const run = await dependencies.executor.submitTask({
    iterationNumber: nextIterationPlan.iterationNumber,
    prompt: plannerDecision.nextPrompt,
    allowedFiles: plannerDecision.allowedFiles,
    forbiddenFiles: plannerDecision.forbiddenFiles,
    acceptanceCommands: plannerDecision.acceptanceCommands,
    repoPath: state.task.repoPath,
    metadata:
      state.task.executorMode === "local_repo"
        ? { localCommand: state.task.executorCommand }
        : undefined,
  });

  state = transitionState(state, "awaiting_result", now());
  await dependencies.storage.saveState(state);
  await dependencies.executor.pollRun(run.runId);

  const report = await dependencies.executor.collectResult(run.runId);

  state = transitionState(state, "validating", now());
  state = orchestratorStateSchema.parse({
    ...state,
    iterationNumber: report.iterationNumber,
    lastExecutionReport: report,
    consecutiveFailures: report.blockers.length > 0 ? state.consecutiveFailures + 1 : 0,
    updatedAt: now().toISOString(),
  });
  await dependencies.storage.saveState(state);

  let ciSummary: CIStatusSummary | null = report.ciValidation;
  if (!ciSummary && dependencies.githubAdapter && report.ciValidation?.runId) {
    ciSummary = await dependencies.githubAdapter.getRunSummary(report.ciValidation.runId);
  }
  if (ciSummary) {
    state = transitionState(state, ciSummary.status === "in_progress" ? "ci_running" : "validating", now());
    state = orchestratorStateSchema.parse({
      ...state,
      lastCIStatus: ciStatusSummarySchema.parse(ciSummary),
      updatedAt: now().toISOString(),
    });
    await dependencies.storage.saveState(state);
  }

  const reviewVerdict = await dependencies.reviewer.review({
    state,
    report,
    decision: plannerDecision,
    ciSummary,
  });

  const nextStatus =
    reviewVerdict.verdict === "accept"
      ? report.shouldCloseSlice
        ? "completed"
        : "needs_revision"
      : reviewVerdict.verdict === "revise"
        ? "needs_revision"
        : reviewVerdict.verdict === "escalate"
          ? "blocked"
          : "stopped";

  state = transitionState(state, nextStatus, now());
  state = orchestratorStateSchema.parse({
    ...state,
    lastReviewVerdict: reviewVerdict,
    stopReason: nextStatus === "stopped" || nextStatus === "blocked" ? reviewVerdict.reasons.join(" | ") : null,
    updatedAt: now().toISOString(),
  });
  await dependencies.storage.saveState(state);

  return state;
}

export function createDefaultDependencies(params: {
  repoPath: string;
  storageRoot?: string;
  executorMode?: "mock" | "local_repo";
  mockCiStatus?: CIStatusSummary;
}) {
  const storage = new FileStorage(params.storageRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-state"));
  const planner = new RuleBasedPlanner();
  const reviewer = new RuleBasedReviewer();
  const executor =
    params.executorMode === "local_repo" ? new LocalRepoExecutor() : new MockExecutor();
  const githubAdapter = params.mockCiStatus ? new MockGitHubStatusAdapter(params.mockCiStatus) : null;
  return {
    storage,
    planner,
    reviewer,
    executor,
    githubAdapter,
  } satisfies OrchestratorDependencies;
}
