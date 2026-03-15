import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  approvalStatusSchema,
  auditTrailSchema,
  blockedReasonSchema,
  ciStatusSummarySchema,
  cleanupDecisionSchema,
  githubHandoffResultSchema,
  liveEvidenceSchema,
  liveSmokeResultSchema,
  orchestratorStateJsonSchema,
  orchestratorStateSchema,
  parseWithDualValidation,
  patchStatusSchema,
  promotionStatusSchema,
  prDraftMetadataSchema,
  type CIStatusSummary,
  type BackendType,
  type CleanupDecision,
  type ExecutionMode,
  type ExecutorFallbackMode,
  type ExecutorProviderKind,
  type GitHubHandoffResult,
  type IterationRecord,
  type OrchestratorState,
  type PlannerProviderKind,
  type PreflightResult,
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
import { FileStorage, SupabaseStorage } from "./storage";
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
  validatePublishPreconditions,
} from "./promotion";
import { inspectWorkspaceCleanup } from "./cleanup";
import { createHandoffPackage } from "./handoff";
import { writeIterationAuditTrail } from "./audit";
import { runOpenAIExecutorLiveSmoke } from "./live-smoke";
import { resolvePromotionConfig, resolveRetentionConfig } from "./config";
import type { GitHubHandoffAdapter } from "./github-handoff";
import { GhCliDraftPullRequestAdapter } from "./github-handoff";
import { writeLiveEvidence } from "./live-evidence";
import { runOrchestratorPreflight, type PreflightTargetName } from "./preflight";
import { normalizeHandoffConfig, resolveTaskProfile } from "./profiles";
import { FileBackendProvider, SqliteBackendProvider, SupabaseBackendProvider, type BackendProvider } from "./backend";
import { createSupabaseDocumentStoreFromEnv, type RemoteDocumentStore } from "./supabase";

type ProviderMap<T> = Record<PlannerProviderKind, T | null>;
type ExecutorProviderMap = Record<ExecutorProviderKind, ExecutionProvider | null>;

export type OrchestratorDependencies = {
  storage: StorageProvider;
  backend: BackendProvider;
  plannerProviders: ProviderMap<PlannerProvider>;
  reviewerProviders: ProviderMap<ReviewerProvider>;
  executorProviders: ExecutorProviderMap;
  githubAdapter: GitHubStatusAdapter | null;
  githubHandoffAdapter: GitHubHandoffAdapter | null;
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
    livePassStatus: "not_run",
    workspaceStatus: "unknown",
    exportArtifactPaths: [],
    handoffStatus: "not_ready",
    prDraftStatus: "not_ready",
    handoffArtifactPaths: [],
    artifactPruneResult: null,
    cleanupDecision: null,
    auditTrailPath: null,
    liveEvidencePath: null,
    githubHandoffResultPath: null,
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

function applyPreflightResult(state: OrchestratorState, preflight: PreflightResult, now: Date) {
  return orchestratorStateSchema.parse({
    ...state,
    lastPreflightResult: preflight,
    lastBlockedReasons: preflight.blockedReasons.map((reason) => blockedReasonSchema.parse(reason)),
    updatedAt: now.toISOString(),
  });
}

async function runStatePreflight(
  state: OrchestratorState,
  dependencies: OrchestratorDependencies,
  now: Date,
  options?: { enabled?: boolean },
) {
  const preflight = await runOrchestratorPreflight({
    repoPath: state.task.repoPath,
    workspaceRoot: state.task.workspaceRoot ?? path.join(state.task.repoPath, ".tmp", "orchestrator-workspaces"),
    state,
    enabled: options?.enabled,
  });
  const updated = applyPreflightResult(state, preflight, now);
  await dependencies.storage.saveState(updated);
  return {
    state: updated,
    preflight,
  };
}

function findTargetBlockedReason(preflight: PreflightResult, target: PreflightTargetName) {
  return preflight.targets.find((item) => item.target === target && item.status !== "ready");
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
  allowedFiles?: string[];
  forbiddenFiles?: string[];
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
  promotionConfig?: Partial<ReturnType<typeof resolvePromotionConfig>>;
  retentionConfig?: Partial<ReturnType<typeof resolveRetentionConfig>>;
  profileId?: string | null;
  profileName?: string | null;
  repoType?: string | null;
  commandAllowList?: string[];
  handoffConfig?: {
    githubHandoffEnabled?: boolean;
    publishBranch?: boolean;
    createBranch?: boolean;
  };
  backendType?: BackendType;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const profile = resolveTaskProfile({
    profileId: params.profileId,
    repoPath: params.repoPath,
    overrides: {
      name: params.profileName ?? undefined,
      repoType: params.repoType ?? undefined,
      allowedFiles: params.allowedFiles,
      forbiddenFiles: params.forbiddenFiles,
      commandAllowList: params.commandAllowList,
      approvalDefaults:
        params.autoMode === undefined && params.approvalMode === undefined
          ? undefined
          : {
              autoMode: params.autoMode ?? false,
              approvalMode: params.approvalMode ?? "human_approval",
            },
      promotionDefaults: params.promotionConfig,
      retentionDefaults: params.retentionConfig,
      handoffDefaults: params.handoffConfig,
    },
  });
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
        profileId: profile.id,
        profileName: profile.name,
        repoType: profile.repoType,
        userGoal: params.userGoal,
        repoPath: params.repoPath,
        repoName: params.repoName,
        allowedFiles: profile.allowedFiles,
        forbiddenFiles: profile.forbiddenFiles,
        commandAllowList: profile.commandAllowList,
        acceptanceGates: [...ORCHESTRATOR_ACCEPTANCE_COMMANDS],
        maxIterations: params.maxIterations ?? 5,
        maxConsecutiveFailures: params.maxConsecutiveFailures ?? 2,
        autoMode: params.autoMode ?? profile.approvalDefaults.autoMode,
        approvalMode: params.approvalMode ?? profile.approvalDefaults.approvalMode,
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
        promotionConfig: resolvePromotionConfig({ promotionConfig: params.promotionConfig ?? profile.promotionDefaults }),
        retentionConfig: resolveRetentionConfig({
          retentionConfig: params.retentionConfig ?? profile.retentionDefaults,
          artifactRetentionSuccess: 3,
          artifactRetentionFailure: 5,
        }),
        handoffConfig: normalizeHandoffConfig(params.handoffConfig ?? profile.handoffDefaults),
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
      livePassStatus: "not_run",
      backendType: params.backendType ?? "file",
      backendHealthStatus: "unknown",
      sourceEventType: "none",
      sourceEventId: null,
      sourceEventSummary: null,
      webhookEventType: "none",
      webhookDeliveryId: null,
      webhookSignatureStatus: "not_checked",
      inboundEventId: null,
      inboundDeliveryId: null,
      inboundCorrelationId: null,
      actorIdentity: null,
      actorAuthorizationStatus: "not_checked",
      actorPolicyConfigVersion: null,
      replayProtectionStatus: "not_checked",
      inboundAuditStatus: "not_recorded",
      runtimeHealthStatus: "unknown",
      runtimeReadinessStatus: "unknown",
      parsedCommand: null,
      commandRoutingStatus: "not_applicable",
      commandRoutingDecision: null,
      idempotencyKey: null,
      idempotencyStatus: "not_checked",
      duplicateOfStateId: null,
      triggerPolicyId: null,
      queueStatus: "not_queued",
      workerStatus: "idle",
      cancellationStatus: "none",
      pauseStatus: "none",
      workerId: null,
      leaseOwner: null,
      lastHeartbeatAt: null,
      lastLeaseRenewalAt: null,
      daemonHeartbeatAt: null,
      supervisionStatus: "inactive",
      lastRecoveryDecision: null,
      recoveryAttemptCount: 0,
      retryCount: 0,
      queuedAt: null,
      startedAt: null,
      finishedAt: null,
      exportArtifactPaths: [],
      handoffStatus: "not_ready",
      prDraftStatus: "not_ready",
      handoffArtifactPaths: [],
      lastArtifactPruneResult: null,
      lastLiveSmokeResult: null,
      lastLiveAcceptanceResult: null,
      lastBackendLiveSmokeResult: null,
      lastBackendHealthSummary: null,
      transferStatus: "not_run",
      lastTransferSummary: null,
      repairStatus: "not_run",
      lastRepairDecision: null,
      lastCleanupDecision: null,
      lastPrDraftMetadata: null,
      lastGitHubHandoffResult: null,
      lastLiveEvidence: null,
      liveStatusReportReadiness: "unknown",
      liveStatusReportStatus: "unknown",
      lastStatusReportPermissionStatus: "unknown",
      lastStatusReportReadinessStatus: "unknown",
      statusReportStatus: "not_run",
      statusReportCorrelationId: null,
      lastStatusReportAction: "none",
      lastStatusReportTargetStrategy: "unknown",
      lastStatusReportTarget: null,
      lastStatusReportFailureReason: null,
      lastStatusReportSummary: null,
      reportDeliveryAttempts: [],
      lastReportDeliveryAuditId: null,
      profileGovernanceStatus: "unknown",
      profileGovernanceReason: null,
      profileGovernanceSuggestedNextAction: null,
      bundleGovernanceStatus: "unknown",
      bundleGovernanceReason: null,
      bundleGovernanceSuggestedNextAction: null,
      lastSandboxAuditId: null,
      lastSandboxGuardrailsStatus: "unknown",
      lastSandboxGuardrailsReason: null,
      lastSandboxGuardrailsSuggestedNextAction: null,
      recentSandboxAuditSummaries: [],
      sandboxBundleId: null,
      sandboxBundleOverrideFields: [],
      lastSandboxDiffSummary: [],
      lastSandboxImportExportStatus: "not_run",
      lastSandboxImportExportSummary: null,
      lastSandboxReviewStatus: "not_run",
      lastSandboxReviewSummary: null,
      lastSandboxApplyStatus: "not_run",
      lastSandboxApplySummary: null,
      lastBatchChangeStatus: "not_run",
      lastBatchImpactSummary: null,
      lastBatchAffectedProfiles: [],
      lastBatchBlockedProfiles: [],
      lastRestorePointId: null,
      lastRestorePointSummary: null,
      currentRestorePointCount: 0,
      currentValidRestorePointCount: 0,
      lastRollbackStatus: "not_run",
      lastRollbackImpactSummary: null,
      lastRollbackAuditId: null,
      rollbackGovernanceStatus: "unknown",
      rollbackGovernanceReason: null,
      rollbackGovernanceSuggestedNextAction: null,
      lastBatchRecoveryStatus: "not_run",
      lastBatchRecoverySummary: null,
      restorePointRetentionStatus: "not_run",
      lastRestorePointPruneSummary: null,
      lastSandboxHistorySummary: null,
      lastSandboxCompareSummary: null,
      lastRecoveryIncidentSummary: null,
      lastRestorePointLookupStatus: "not_run",
      lastRestorePointCompareStatus: "not_run",
      lastIncidentType: "none",
      lastIncidentSeverity: null,
      lastIncidentSummary: null,
      lastOperatorAction: "none",
      lastOperatorActionStatus: "not_run",
      lastEscalationSummary: null,
      lastGovernanceStatus: null,
      lastIncidentPolicy: null,
      lastOperatorHandoffSummary: null,
      lastResolutionReadiness: null,
      lastResolutionEvidenceSummary: null,
      lastClosureGatingDecision: null,
      lastResolutionAuditLog: null,
      lastCloseoutSummary: null,
      lastCloseoutChecklist: null,
      lastResolutionAuditHistory: null,
      lastCloseoutReviewSummary: null,
      lastCloseoutReviewQueue: null,
      lastCloseoutReviewAction: null,
      lastCloseoutDispositionSummary: null,
      lastCloseoutReviewLifecycle: null,
      lastCloseoutReviewAuditTrail: null,
      lastCloseoutReviewHistory: null,
      lastCloseoutReviewResolutionSummary: null,
      authSmokeStatus: "not_run",
      authSmokeSuccessStatus: "not_run",
      authSmokeMode: "none",
      authSmokeTarget: null,
      authSmokePermissionResult: "unknown",
      authSmokeFailureReason: null,
      selectedSandboxProfileId: null,
      sandboxProfileSelectionMode: "unknown",
      sandboxProfileSelectionReason: null,
      sandboxProfileId: null,
      sandboxProfileStatus: "unknown",
      sandboxTargetProfileId: null,
      sandboxTargetConfigVersion: null,
      targetSelectionStatus: "unknown",
      lastAuthSmokeTarget: null,
      lastAuthSmokeAction: "none",
      lastAuthSmokeSuccessAt: null,
      lastAuthSmokeEvidencePath: null,
      lastLiveSmokeEvidencePath: null,
      lastLiveSmokeSummary: null,
      lastLiveSmokeTarget: null,
      lastLiveAuthEvidence: null,
      lastGitHubAuthSmokeResult: null,
      lastPreflightResult: null,
      lastBlockedReasons: [],
      lastAuditTrail: null,
      lastHandoffPackagePath: null,
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
        commandAllowList: state.task.commandAllowList,
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
    handoffStatus: "exported",
    handoffArtifactPaths: [exportBundle.patchExportPath, exportBundle.manifestPath],
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
      handoffStatus: "exported",
      handoffArtifactPaths: [exportBundle.patchExportPath, exportBundle.manifestPath],
      stateAfter: nextStatus,
    },
    now,
  );
  await dependencies.storage.saveState(approved);
  approved = await persistAuditTrail(approved, dependencies, now);
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
  rejected = await persistAuditTrail(rejected, dependencies, now);
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
  const now = (dependencies.now ?? (() => new Date()))();
  const { state: preflightState, preflight } = await runStatePreflight(state, dependencies, now);
  if (findTargetBlockedReason(preflight, "promotion")) {
    throw new Error(findTargetBlockedReason(preflight, "promotion")?.summary ?? "Promotion is blocked.");
  }
  const issues = validatePublishPreconditions(preflightState, {
    applyWorkspace: options?.applyWorkspace,
    createBranch: options?.createBranch,
  });
  if (issues.length > 0) {
    throw new Error(`Patch promotion preconditions failed: ${issues.join(" | ")}`);
  }

  const branchPrep = await preparePromotionBranch({
    state: preflightState,
    createBranch: options?.createBranch ?? true,
  });

  const baseReport = preflightState.lastExecutionReport;
  if (!baseReport) {
    throw new Error("Promotion requires an execution report.");
  }
  let report = baseReport;
  if (options?.applyWorkspace) {
    const promotion = await promotePatchFromState({
      state: preflightState,
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
    ...preflightState,
    status:
      baseReport.shouldCloseSlice && preflightState.lastReviewVerdict?.verdict === "accept"
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
    baseReport.iterationNumber,
    {
      executionReport: report,
      patchStatus: options?.applyWorkspace ? "applied" : "promoted",
      promotionStatus: "promoted",
      stateAfter: promoted.status,
    },
    now,
  );
  await dependencies.storage.saveState(promoted);
  promoted = await persistAuditTrail(promoted, dependencies, now);
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
  updated = await persistAuditTrail(updated, dependencies, new Date(decision.cleanedAt));
  return {
    state: updated,
    result: decision,
  };
}

async function persistAuditTrail(
  state: OrchestratorState,
  dependencies: OrchestratorDependencies,
  now: Date,
) {
  const auditRoot = path.join(state.task.repoPath, ".tmp", "orchestrator-audit");
  const { auditTrail, auditPath } = await writeIterationAuditTrail({
    state,
    outputRoot: auditRoot,
  });
  let updated = orchestratorStateSchema.parse({
    ...state,
    lastAuditTrail: auditTrailSchema.parse(auditTrail),
    updatedAt: now.toISOString(),
  });
  if (updated.iterationHistory.length > 0) {
    const lastIteration = updated.iterationHistory[updated.iterationHistory.length - 1];
    updated = upsertIterationRecord(
      updated,
      lastIteration.iterationNumber,
      {
        auditTrailPath: auditPath,
      },
      now,
    );
  }
  await dependencies.storage.saveState(updated);
  return updated;
}

function createGatedLiveResult(params: {
  target: "live_smoke" | "live_acceptance" | "live_pass";
  preflight: PreflightResult;
  model?: string | null;
}) {
  const target = findTargetBlockedReason(params.preflight, params.target);
  const blocked = target?.blockedReasons[0] ?? params.preflight.blockedReasons[0] ?? null;
  const status = target?.status === "skipped" ? "skipped" : "blocked";
  return liveSmokeResultSchema.parse({
    status,
    reason: blocked?.summary ?? `${params.target} is not ready.`,
    provider: "openai_responses",
    model: params.model ?? null,
    summary: target?.summary ?? params.preflight.summary,
    reportPath: null,
    diffPath: null,
    transcriptSummaryPath: null,
    toolLogPath: null,
    commandLogPath: null,
    ranAt: new Date().toISOString(),
  });
}

export async function runLiveSmoke(params: {
  repoPath: string;
  workspaceRoot?: string;
  outputRoot?: string;
  model?: string;
  openaiClient?: OpenAIResponsesClient | null;
  enabled?: boolean;
}) {
  const preflight = await runOrchestratorPreflight({
    repoPath: params.repoPath,
    workspaceRoot: params.workspaceRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-workspaces"),
    enabled: params.enabled ?? true,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    },
  });
  if (findTargetBlockedReason(preflight, "live_smoke")) {
    return createGatedLiveResult({
      target: "live_smoke",
      preflight,
      model: params.model ?? null,
    });
  }
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
  if (params.stateId && params.dependencies) {
    const state = await params.dependencies.storage.loadState(params.stateId);
    if (!state) throw new Error(`Orchestrator state ${params.stateId} was not found.`);
    const { state: preflightState, preflight } = await runStatePreflight(
      state,
      params.dependencies,
      (params.dependencies.now ?? (() => new Date()))(),
      { enabled: params.enabled ?? true },
    );
    if (findTargetBlockedReason(preflight, "live_acceptance")) {
      const result = createGatedLiveResult({
        target: "live_acceptance",
        preflight,
        model: params.model ?? null,
      });
      const updated = orchestratorStateSchema.parse({
        ...preflightState,
        liveAcceptanceStatus: result.status,
        lastLiveSmokeResult: result,
        lastLiveAcceptanceResult: result,
        updatedAt: result.ranAt,
      });
      await params.dependencies.storage.saveState(updated);
      await persistAuditTrail(updated, params.dependencies, new Date(result.ranAt));
      return result;
    }
  }
  const startedAt = new Date().toISOString();
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
    const evidenceRoot = path.join(params.repoPath, ".tmp", "orchestrator-live-evidence");
    const evidence = await writeLiveEvidence({
      stateId: state.id,
      iterationNumber: Math.max(
        state.iterationNumber,
        state.iterationHistory.length > 0
          ? (state.iterationHistory[state.iterationHistory.length - 1]?.iterationNumber ?? 1)
          : 1,
      ),
      outputRoot: evidenceRoot,
      result,
      startedAt,
      endedAt: result.ranAt,
    });
    let updated = orchestratorStateSchema.parse({
      ...state,
      liveAcceptanceStatus: result.status,
      livePassStatus: result.status === "passed" ? "passed" : state.livePassStatus,
      lastLiveSmokeResult: result,
      lastLiveAcceptanceResult: result,
      lastLiveEvidence: liveEvidenceSchema.parse(evidence.evidence),
      updatedAt: result.ranAt,
    });
    if (state.iterationHistory.length > 0) {
      const lastIteration = state.iterationHistory[state.iterationHistory.length - 1];
      updated = upsertIterationRecord(
        updated,
        lastIteration.iterationNumber,
        {
          liveAcceptanceStatus: result.status,
          livePassStatus: result.status === "passed" ? "passed" : updated.livePassStatus,
          liveEvidencePath: evidence.evidencePath,
        },
        new Date(result.ranAt),
      );
    }
    await params.dependencies.storage.saveState(updated);
    updated = await persistAuditTrail(updated, params.dependencies, new Date(result.ranAt));
    return result;
  }

  return result;
}

export async function runLivePass(params: {
  stateId?: string;
  dependencies?: OrchestratorDependencies;
  repoPath: string;
  workspaceRoot?: string;
  outputRoot?: string;
  model?: string;
  openaiClient?: OpenAIResponsesClient | null;
  enabled?: boolean;
}) {
  if (params.stateId && params.dependencies) {
    const state = await params.dependencies.storage.loadState(params.stateId);
    if (!state) throw new Error(`Orchestrator state ${params.stateId} was not found.`);
    const { state: preflightState, preflight } = await runStatePreflight(
      state,
      params.dependencies,
      (params.dependencies.now ?? (() => new Date()))(),
      { enabled: params.enabled ?? true },
    );
    if (findTargetBlockedReason(preflight, "live_pass")) {
      const result = createGatedLiveResult({
        target: "live_pass",
        preflight,
        model: params.model ?? null,
      });
      const updated = orchestratorStateSchema.parse({
        ...preflightState,
        livePassStatus: result.status,
        lastLiveSmokeResult: result,
        lastLiveAcceptanceResult: result,
        updatedAt: result.ranAt,
      });
      await params.dependencies.storage.saveState(updated);
      await persistAuditTrail(updated, params.dependencies, new Date(result.ranAt));
      return result;
    }
  }
  const result = await runLiveAcceptance(params);
  if (params.stateId && params.dependencies) {
    const state = await params.dependencies.storage.loadState(params.stateId);
    if (!state) throw new Error(`Orchestrator state ${params.stateId} was not found.`);
    let updated = orchestratorStateSchema.parse({
      ...state,
      livePassStatus: result.status,
      updatedAt: result.ranAt,
    });
    if (updated.iterationHistory.length > 0) {
      const lastIteration = updated.iterationHistory[updated.iterationHistory.length - 1];
      updated = upsertIterationRecord(
        updated,
        lastIteration.iterationNumber,
        {
          livePassStatus: result.status,
        },
        new Date(result.ranAt),
      );
    }
    await params.dependencies.storage.saveState(updated);
    await persistAuditTrail(updated, params.dependencies, new Date(result.ranAt));
  }
  return result;
}

export async function prepareHandoff(
  stateId: string,
  dependencies: OrchestratorDependencies,
  options?: { publishBranch?: boolean; createBranch?: boolean; githubHandoffEnabled?: boolean },
) {
  const state = await dependencies.storage.loadState(stateId);
  if (!state) throw new Error(`Orchestrator state ${stateId} was not found.`);
  const now = (dependencies.now ?? (() => new Date()))();
  const { state: preflightState, preflight } = await runStatePreflight(state, dependencies, now);
  const resolvedHandoffConfig = normalizeHandoffConfig(preflightState.task.handoffConfig);
  const githubHandoffEnabled = options?.githubHandoffEnabled ?? resolvedHandoffConfig.githubHandoffEnabled;
  if (githubHandoffEnabled && findTargetBlockedReason(preflight, "github_handoff")) {
    throw new Error(findTargetBlockedReason(preflight, "github_handoff")?.summary ?? "GitHub handoff is blocked.");
  }
  const outputRoot = path.join(state.task.repoPath, ".tmp", "orchestrator-handoff");
  const handoff = await createHandoffPackage({
    state: preflightState,
    outputRoot,
    publishBranch: options?.publishBranch ?? resolvedHandoffConfig.publishBranch,
    createBranch: options?.createBranch ?? resolvedHandoffConfig.createBranch,
    githubHandoffEnabled,
  });
  let githubHandoffResult: GitHubHandoffResult | null =
    handoff.prDraftPath && handoff.branchName
      ? {
          status: githubHandoffEnabled ? "payload_only" : "skipped",
          provider: dependencies.githubHandoffAdapter?.kind ?? "github_handoff_unavailable",
          targetBranch: handoff.branchName,
          draftUrl: null,
          summary: handoff.githubHandoffReason,
          requestPayloadPath: handoff.prDraftPath,
          ranAt: new Date().toISOString(),
        }
      : null;
  if (handoff.prDraftPath && handoff.branchName && githubHandoffEnabled && dependencies.githubHandoffAdapter) {
    const prDraftMetadata = prDraftMetadataSchema.parse(JSON.parse(await readFile(handoff.prDraftPath, "utf8")));
    githubHandoffResult = await dependencies.githubHandoffAdapter.createDraftPullRequest({
      repoPath: preflightState.task.repoPath,
      title: prDraftMetadata.title,
      body: prDraftMetadata.body,
      headBranch: handoff.branchName,
      baseBranch: resolvePromotionConfig(preflightState.task).baseBranch,
      payloadRoot: outputRoot,
      stateId: preflightState.id,
      iterationNumber: preflightState.lastExecutionReport?.iterationNumber ?? Math.max(preflightState.iterationNumber, 1),
    });
  }

  let updated = orchestratorStateSchema.parse({
    ...preflightState,
    handoffStatus: handoff.status,
    prDraftStatus: handoff.prDraftPath
      ? githubHandoffResult?.status === "draft_created"
        ? "payload_ready"
        : githubHandoffResult?.status === "failed"
          ? "failed"
          : githubHandoffResult?.status === "skipped"
            ? "metadata_ready"
            : githubHandoffResult?.status === "payload_only" || handoff.githubHandoffStatus === "payload_ready"
              ? "payload_ready"
              : "metadata_ready"
      : handoff.githubHandoffStatus === "skipped"
        ? "skipped"
        : "failed",
    handoffArtifactPaths: handoff.artifactPaths,
    lastHandoffPackagePath: handoff.handoffPackagePath,
    lastPrDraftMetadata: handoff.prDraftPath
      ? prDraftMetadataSchema.parse(JSON.parse(await readFile(handoff.prDraftPath, "utf8")))
      : null,
    lastGitHubHandoffResult: githubHandoffResult ? githubHandoffResultSchema.parse(githubHandoffResult) : null,
    promotionStatus:
      handoff.status === "branch_published"
        ? "promoted"
        : handoff.status === "handoff_ready"
          ? "branch_ready"
          : preflightState.promotionStatus,
    patchStatus:
      handoff.status === "branch_published"
        ? "promoted"
        : handoff.status === "handoff_ready"
          ? "branch_ready"
          : preflightState.patchStatus,
    stopReason: handoff.issues.length > 0 ? handoff.issues.join(" | ") : null,
    updatedAt: now.toISOString(),
  });
  if (updated.iterationHistory.length > 0) {
    const lastIteration = updated.iterationHistory[updated.iterationHistory.length - 1];
    updated = upsertIterationRecord(
      updated,
      lastIteration.iterationNumber,
      {
        handoffStatus: handoff.status,
        prDraftStatus: handoff.prDraftPath
          ? githubHandoffResult?.status === "draft_created"
            ? "payload_ready"
            : githubHandoffResult?.status === "failed"
              ? "failed"
              : githubHandoffResult?.status === "skipped"
                ? "metadata_ready"
                : githubHandoffResult?.status === "payload_only" || handoff.githubHandoffStatus === "payload_ready"
                  ? "payload_ready"
                  : "metadata_ready"
          : handoff.githubHandoffStatus === "skipped"
            ? "skipped"
            : "failed",
        handoffArtifactPaths: handoff.artifactPaths,
        githubHandoffResultPath: githubHandoffResult?.requestPayloadPath ?? null,
        patchStatus:
          handoff.status === "branch_published"
            ? "promoted"
            : handoff.status === "handoff_ready"
              ? "branch_ready"
              : updated.patchStatus,
        promotionStatus:
          handoff.status === "branch_published"
            ? "promoted"
            : handoff.status === "handoff_ready"
              ? "branch_ready"
              : updated.promotionStatus,
      },
      now,
    );
  }
  await dependencies.storage.saveState(updated);
  updated = await persistAuditTrail(updated, dependencies, now);
  return {
    state: updated,
    result: handoff,
  };
}

export function createDefaultDependencies(params: {
  repoPath: string;
  storageRoot?: string;
  backendType?: BackendType;
  backendFallbackType?: BackendType | "blocked";
  backendRoot?: string;
  executorMode?: ExecutorProviderKind;
  mockCiStatus?: CIStatusSummary;
  openaiClient?: OpenAIResponsesClient | null;
  workspaceRoot?: string;
  supabaseStore?: RemoteDocumentStore | null;
}) {
  const requestedBackend = params.backendType ?? "file";
  const fallbackBackend = params.backendFallbackType ?? "blocked";
  const backendRoot = params.backendRoot ?? params.storageRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-state");
  const supabaseStore = requestedBackend === "supabase" ? (params.supabaseStore ?? createSupabaseDocumentStoreFromEnv()) : null;

  let storage: StorageProvider;
  let backend: BackendProvider;
  if (requestedBackend === "sqlite") {
    storage = new FileStorage(params.storageRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-state"));
    backend = new SqliteBackendProvider({
      rootDir: backendRoot,
    });
  } else if (requestedBackend === "supabase") {
    if (supabaseStore) {
      storage = new SupabaseStorage(supabaseStore);
      backend = new SupabaseBackendProvider({
        store: supabaseStore,
      });
    } else if (fallbackBackend !== "blocked") {
      storage = new FileStorage(params.storageRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-state"));
      backend =
        fallbackBackend === "sqlite"
          ? new SqliteBackendProvider({
              rootDir: backendRoot,
            })
          : new FileBackendProvider({
              rootDir: backendRoot,
              storage,
            });
    } else {
      throw new Error(
        "Supabase backend requires ORCHESTRATOR_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY.",
      );
    }
  } else {
    storage = new FileStorage(params.storageRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-state"));
    backend = new FileBackendProvider({
      rootDir: backendRoot,
      storage,
    });
  }
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
  const githubHandoffAdapter = new GhCliDraftPullRequestAdapter({
    enabled: process.env.ORCHESTRATOR_GITHUB_HANDOFF === "true",
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
  });
  return {
    storage,
    backend,
    plannerProviders,
    reviewerProviders,
    executorProviders,
    githubAdapter,
    githubHandoffAdapter,
    workspaceManager,
  } satisfies OrchestratorDependencies;
}
