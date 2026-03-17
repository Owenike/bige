import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  approvePendingPatch,
  approvePendingPlan,
  cleanupStateWorkspaces,
  createDefaultDependencies,
  createInitialState,
  planOrchestratorIteration,
  prepareHandoff,
  promoteApprovedPatch,
  pruneStateArtifacts,
  rejectPendingPatch,
  rejectPendingPlan,
  runLiveAcceptance,
  runLivePass,
  runLiveSmoke,
  runOrchestratorLoop,
  runOrchestratorOnce,
} from "./orchestrator";
import {
  orchestratorStateSchema,
  type BackendType,
  type ExecutionMode,
  type ExecutorFallbackMode,
  type ExecutorProviderKind,
  type OrchestratorState,
  type PlannerProviderKind,
} from "./schemas";
import { FileSystemWorkspaceManager } from "./workspace";
import { runOrchestratorPreflight, formatPreflightSummary } from "./preflight";
import { buildDiagnosticsSummary, formatDiagnosticsSummary } from "./diagnostics";
import { applyQueueItemToState, enqueueStateRun, formatQueueSummary, listQueueRuns, requeueRun, requestCancelRun, requestPauseRun } from "./queue";
import { getWorkerStatus, runQueueWorker } from "./worker";
import { runSupabaseBackendLiveSmoke } from "./supabase-live";
import { exportBackendSnapshot, importBackendSnapshot } from "./transfer";
import { inspectBackendHealth, repairBackendHealth } from "./health";
import { ingestGitHubEvent } from "./github-events";
import {
  GhCliStatusReportingAdapter,
  applyStatusReportToState,
  inspectGitHubReportingOperatorSummary,
  reportStateStatus,
  runGitHubLiveCommentSmoke,
  runGitHubReportPermissionSmoke,
} from "./status-reporting";
import { formatReportDeliveryAttempts } from "./reporting-audit";
import { runGitHubLiveAuthSmoke } from "./github-live-auth";
import { selectGitHubLiveSmokeTarget } from "./github-live-targets";
import { describeGitHubSandboxTargetRegistry, loadGitHubSandboxTargetRegistry, resolveGitHubSandboxTarget } from "./github-sandbox-targets";
import { formatSandboxProfileList, formatSandboxProfileValidation, showSandboxProfile, validateSandboxProfile } from "./sandbox-profile-ops";
import { createSandboxProfile, deleteSandboxProfile, setDefaultSandboxProfile, updateSandboxProfile } from "./sandbox-profile-lifecycle";
import { runLiveAuthOperatorFlow } from "./live-auth-operator";
import { formatSandboxAuditTrail, listSandboxAuditRecords } from "./sandbox-audit";
import { evaluateSandboxGuardrails, evaluateSandboxProfileGovernance, formatSandboxGuardrailsSummary, formatSandboxGovernanceSummary, inspectSandboxGovernance } from "./sandbox-governance";
import { evaluateSandboxBundleGovernance, formatSandboxBundleGovernanceSummary, inspectSandboxBundleGovernance } from "./sandbox-bundle-governance";
import { applySandboxPolicyBundle, formatSandboxPolicyBundle, formatSandboxPolicyBundleList, showSandboxPolicyBundle } from "./sandbox-policy-bundles";
import { exportSandboxProfiles, importSandboxProfiles } from "./sandbox-import-export";
import { applySandboxRegistryChange, buildSandboxRegistryDiff, reviewSandboxRegistryChange } from "./sandbox-change-review";
import { runSandboxBatchChange } from "./sandbox-batch-change";
import { runSandboxBatchRecovery, summarizeSandboxBatchRecovery } from "./sandbox-batch-recovery";
import { compareSandboxRestorePoints, formatSandboxCompare } from "./sandbox-compare";
import { formatSandboxHistory, querySandboxHistory } from "./sandbox-history";
import { formatSandboxImpactSummary } from "./sandbox-impact-summary";
import { classifySandboxRecoveryIncidents, formatSandboxIncidentGovernance } from "./sandbox-incident-governance";
import { formatSandboxIncidentPolicy, resolveSandboxIncidentPolicy } from "./sandbox-incident-policy";
import { buildSandboxEscalationSummary, formatSandboxEscalationSummary } from "./sandbox-escalation";
import { buildSandboxGovernanceStatus, formatSandboxGovernanceStatus } from "./sandbox-governance-status";
import { buildSandboxResolutionReadiness, formatSandboxResolutionReadiness } from "./sandbox-resolution-readiness";
import { buildSandboxResolutionEvidenceSummary, formatSandboxResolutionEvidenceSummary } from "./sandbox-resolution-evidence";
import { buildSandboxClosureGatingDecision, formatSandboxClosureGatingDecision } from "./sandbox-closure-gating";
import {
  appendSandboxResolutionAuditLog,
  formatSandboxResolutionAuditLogs,
  listSandboxResolutionAuditLogs,
} from "./sandbox-resolution-audit";
import { buildSandboxCloseoutSummary, formatSandboxCloseoutSummary } from "./sandbox-closeout-summary";
import {
  buildSandboxCloseoutOperatorChecklist,
  formatSandboxCloseoutOperatorChecklist,
} from "./sandbox-closeout-checklist";
import {
  buildSandboxResolutionAuditHistory,
  formatSandboxResolutionAuditHistory,
} from "./sandbox-resolution-audit-history";
import {
  listSandboxCloseoutReviewActions,
  formatSandboxCloseoutReviewActionResult,
  runSandboxCloseoutReviewAction,
} from "./sandbox-closeout-review-actions";
import {
  buildSandboxCloseoutDispositionSummary,
  formatSandboxCloseoutDispositionSummary,
} from "./sandbox-closeout-disposition-summary";
import {
  buildSandboxCloseoutReviewSummary,
  formatSandboxCloseoutReviewSummary,
} from "./sandbox-closeout-review-summary";
import {
  buildSandboxCloseoutReviewQueue,
  formatSandboxCloseoutReviewQueue,
} from "./sandbox-closeout-review-queue";
import {
  buildSandboxCloseoutReviewLifecycle,
  formatSandboxCloseoutReviewLifecycle,
} from "./sandbox-closeout-review-lifecycle";
import {
  appendSandboxCloseoutReviewAuditTrail,
  formatSandboxCloseoutReviewAuditTrail,
  listSandboxCloseoutReviewAuditTrail,
} from "./sandbox-closeout-review-audit-trail";
import {
  buildSandboxCloseoutReviewHistory,
  formatSandboxCloseoutReviewHistory,
} from "./sandbox-closeout-review-history";
import {
  buildSandboxCloseoutReviewResolutionSummary,
  formatSandboxCloseoutReviewResolutionSummary,
} from "./sandbox-closeout-review-resolution-summary";
import {
  appendSandboxCloseoutSettlementAudit,
  formatSandboxCloseoutSettlementAudits,
  listSandboxCloseoutSettlementAudits,
} from "./sandbox-closeout-settlement-audit";
import {
  appendSandboxCloseoutCompletionAudit,
  formatSandboxCloseoutCompletionAudits,
  listSandboxCloseoutCompletionAudits,
} from "./sandbox-closeout-completion-audit";
import {
  buildSandboxCloseoutFollowupSummary,
  formatSandboxCloseoutFollowupSummary,
} from "./sandbox-closeout-followup-summary";
import {
  buildSandboxCloseoutFollowupQueue,
  formatSandboxCloseoutFollowupQueue,
} from "./sandbox-closeout-followup-queue";
import {
  buildSandboxCloseoutCompletionSummary,
  formatSandboxCloseoutCompletionSummary,
} from "./sandbox-closeout-completion-summary";
import {
  buildSandboxCloseoutCompletionQueue,
  formatSandboxCloseoutCompletionQueue,
} from "./sandbox-closeout-completion-queue";
import {
  buildSandboxCloseoutCompletionHistory,
  formatSandboxCloseoutCompletionHistory,
} from "./sandbox-closeout-completion-history";
import {
  formatSandboxCloseoutCompletionActionResult,
  listSandboxCloseoutCompletionActions,
  runSandboxCloseoutCompletionAction,
} from "./sandbox-closeout-completion-actions";
import {
  buildSandboxCloseoutCompletionDispositionSummary,
  formatSandboxCloseoutCompletionDispositionSummary,
} from "./sandbox-closeout-completion-disposition-summary";
import {
  buildSandboxCloseoutCompletionLifecycle,
  formatSandboxCloseoutCompletionLifecycle,
} from "./sandbox-closeout-completion-lifecycle";
import {
  appendSandboxCloseoutCompletionDecisionAudit,
  formatSandboxCloseoutCompletionDecisionAudit,
  listSandboxCloseoutCompletionDecisionAudit,
} from "./sandbox-closeout-completion-decision-audit";
import {
  buildSandboxCloseoutCompletionDecisionHistory,
  formatSandboxCloseoutCompletionDecisionHistory,
} from "./sandbox-closeout-completion-decision-history";
import {
  buildSandboxCloseoutCompletionFinalizationSummary,
  formatSandboxCloseoutCompletionFinalizationSummary,
} from "./sandbox-closeout-completion-finalization-summary";
import {
  buildSandboxCloseoutFinalizationAuditHistory,
  formatSandboxCloseoutFinalizationAuditHistory,
} from "./sandbox-closeout-finalization-audit-history";
import {
  buildSandboxCloseoutFinalizationStabilitySummary,
  formatSandboxCloseoutFinalizationStabilitySummary,
} from "./sandbox-closeout-finalization-stability-summary";
import {
  buildSandboxCloseoutPostFinalizationFollowupQueue,
  formatSandboxCloseoutPostFinalizationFollowupQueue,
} from "./sandbox-closeout-post-finalization-followup-queue";
import {
  buildSandboxCloseoutStabilityDrift,
  formatSandboxCloseoutStabilityDrift,
} from "./sandbox-closeout-stability-drift";
import {
  buildSandboxCloseoutReopenRecurrence,
  formatSandboxCloseoutReopenRecurrence,
} from "./sandbox-closeout-reopen-recurrence";
import {
  buildSandboxCloseoutStabilityWatchlist,
  formatSandboxCloseoutStabilityWatchlist,
} from "./sandbox-closeout-stability-watchlist";
import {
  buildSandboxCloseoutStabilityRecurrenceAudit,
  formatSandboxCloseoutStabilityRecurrenceAudit,
} from "./sandbox-closeout-stability-recurrence-audit";
import {
  buildSandboxCloseoutWatchlistResolutionSummary,
  formatSandboxCloseoutWatchlistResolutionSummary,
} from "./sandbox-closeout-watchlist-resolution-summary";
import {
  buildSandboxCloseoutWatchlistLifecycle,
  formatSandboxCloseoutWatchlistLifecycle,
} from "./sandbox-closeout-watchlist-lifecycle";
import {
  buildSandboxCloseoutWatchlistExitAudit,
  formatSandboxCloseoutWatchlistExitAudit,
} from "./sandbox-closeout-watchlist-exit-audit";
import {
  buildSandboxCloseoutWatchlistReAddHistory,
  formatSandboxCloseoutWatchlistReAddHistory,
} from "./sandbox-closeout-watchlist-readd-history";
import {
  buildSandboxCloseoutStabilityRecoverySummary,
  formatSandboxCloseoutStabilityRecoverySummary,
} from "./sandbox-closeout-stability-recovery-summary";
import {
  buildSandboxCloseoutRecoveryConfidence,
  formatSandboxCloseoutRecoveryConfidence,
} from "./sandbox-closeout-recovery-confidence";
import {
  buildSandboxCloseoutRecoveryRegressionAudit,
  formatSandboxCloseoutRecoveryRegressionAudit,
} from "./sandbox-closeout-recovery-regression-audit";
import {
  buildSandboxCloseoutRecoveredMonitoringQueue,
  formatSandboxCloseoutRecoveredMonitoringQueue,
} from "./sandbox-closeout-recovered-monitoring-queue";
import {
  buildSandboxCloseoutRecoveryConfidenceTrend,
  formatSandboxCloseoutRecoveryConfidenceTrend,
} from "./sandbox-closeout-recovery-confidence-trend";
import {
  buildSandboxCloseoutRegressionResolutionSummary,
  formatSandboxCloseoutRegressionResolutionSummary,
} from "./sandbox-closeout-regression-resolution-summary";
import {
  buildSandboxCloseoutRecoveredMonitoringExitAudit,
  formatSandboxCloseoutRecoveredMonitoringExitAudit,
} from "./sandbox-closeout-recovered-monitoring-exit-audit";
import {
  buildSandboxCloseoutRecoveryClearanceAudit,
  formatSandboxCloseoutRecoveryClearanceAudit,
} from "./sandbox-closeout-recovery-clearance-audit";
import {
  buildSandboxCloseoutRecoveryClearanceHistory,
  formatSandboxCloseoutRecoveryClearanceHistory,
} from "./sandbox-closeout-recovery-clearance-history";
import {
  buildSandboxCloseoutRecoveredExitHistory,
  formatSandboxCloseoutRecoveredExitHistory,
} from "./sandbox-closeout-recovered-exit-history";
import {
  buildSandboxCloseoutRecoveredLifecycle,
  formatSandboxCloseoutRecoveredLifecycle,
} from "./sandbox-closeout-recovered-lifecycle";
import {
  buildSandboxCloseoutRecoveredLifecycleHistory,
  formatSandboxCloseoutRecoveredLifecycleHistory,
} from "./sandbox-closeout-recovered-lifecycle-history";
import {
  buildSandboxCloseoutRecoveredReentryAudit,
  formatSandboxCloseoutRecoveredReentryAudit,
} from "./sandbox-closeout-recovered-reentry-audit";
import {
  buildSandboxCloseoutRecoveryRetirementAudit,
  formatSandboxCloseoutRecoveryRetirementAudit,
} from "./sandbox-closeout-recovery-retirement-audit";
import {
  buildSandboxCloseoutRecoveredRetirementSummary,
  formatSandboxCloseoutRecoveredRetirementSummary,
} from "./sandbox-closeout-recovered-retirement-summary";
import {
  buildSandboxCloseoutRecoveryRetirementQueue,
  formatSandboxCloseoutRecoveryRetirementQueue,
} from "./sandbox-closeout-recovery-retirement-queue";
import {
  buildSandboxCloseoutRecoveryRetirementHistory,
  formatSandboxCloseoutRecoveryRetirementHistory,
} from "./sandbox-closeout-recovery-retirement-history";
import {
  buildSandboxCloseoutRetirementExitCriteria,
  formatSandboxCloseoutRetirementExitCriteria,
} from "./sandbox-closeout-retirement-exit-criteria";
import {
  buildSandboxCloseoutRetiredCaseAuditHistory,
  formatSandboxCloseoutRetiredCaseAuditHistory,
} from "./sandbox-closeout-retired-case-audit-history";
import {
  buildSandboxCloseoutCompletionResolutionSummary,
  formatSandboxCloseoutCompletionResolutionSummary,
} from "./sandbox-closeout-completion-resolution-summary";
import {
  buildSandboxCloseoutCompletionCarryForwardQueue,
  formatSandboxCloseoutCompletionCarryForwardQueue,
} from "./sandbox-closeout-completion-carry-forward-queue";
import { buildSandboxOperatorHandoffSummary, formatSandboxOperatorHandoffSummary } from "./sandbox-operator-handoff";
import { formatSandboxOperatorActionResult, runSandboxOperatorAction } from "./sandbox-operator-actions";
import { listSandboxRestorePoints } from "./sandbox-restore-points";
import { buildSandboxRecoveryDiagnostics, formatSandboxRecoveryDiagnostics } from "./sandbox-recovery-diagnostics";
import { runSandboxRollback } from "./sandbox-rollback";
import { evaluateSandboxRollbackGovernance, formatSandboxRollbackGovernanceSummary } from "./sandbox-rollback-governance";
import {
  formatSandboxRestorePointList,
  formatSandboxRestoreRetentionSummary,
  inspectSandboxRestorePointRetention,
  pruneSandboxRestorePoints,
} from "./sandbox-restore-retention";
import { ingestGitHubWebhook } from "./webhook";
import { formatWebhookHostingConfig, loadWebhookHostingConfig } from "./runtime-config";
import { formatWebhookShutdownSummary, startWebhookHosting } from "./webhook-hosting";
import { resolveActorAuthorization } from "./actor-policy";
import { describeActorPolicyConfig, loadActorPolicyConfig } from "./actor-policy-config";
import { formatInboundAuditSummary, listInboundAuditRecords } from "./inbound-audit";
import { evaluateWebhookRuntime, formatWebhookRuntimeSummary } from "./webhook-runtime";
import { ingestGptCodeReportFromFile } from "./gpt-code-report-bridge";

async function resolveRunId(params: {
  stateId: string;
  dependencies: ReturnType<typeof createDefaultDependencies>;
  explicitRunId?: string;
}) {
  if (params.explicitRunId) {
    return params.explicitRunId;
  }
  const queue = await listQueueRuns(params.dependencies.backend);
  const match = queue.find((item) => item.stateId === params.stateId && ["queued", "running", "paused", "blocked", "failed"].includes(item.status));
  if (!match) {
    throw new Error(`No queue run found for state ${params.stateId}.`);
  }
  return match.id;
}

function formatRunSummary(run: {
  id: string;
  status: string;
  stateId: string;
  workerId: string | null;
  attemptCount: number;
  reason: string | null;
}) {
  return [
    `Run: ${run.id}`,
    `State: ${run.stateId}`,
    `Status: ${run.status}`,
    `Worker: ${run.workerId ?? "none"}`,
    `Attempts: ${run.attemptCount}`,
    `Reason: ${run.reason ?? "none"}`,
  ].join("\n");
}

function formatWorkerSummary(summary: {
  workerId: string;
  polls: number;
  processed: number;
  recovered: number;
  finalStatuses: string[];
  queueSize: number;
  backendType: string;
  daemon: boolean;
  workerStatus: string;
  supervisionStatus: string;
  lastError: string | null;
  heartbeatStatus: string | null;
}) {
  return [
    `Worker: ${summary.workerId}`,
    `Backend: ${summary.backendType}`,
    `Daemon mode: ${summary.daemon}`,
    `Worker status: ${summary.workerStatus}`,
    `Supervision: ${summary.supervisionStatus}`,
    `Polls: ${summary.polls}`,
    `Processed: ${summary.processed}`,
    `Recovered stale runs: ${summary.recovered}`,
    `Final statuses: ${summary.finalStatuses.join(", ") || "none"}`,
    `Queue size: ${summary.queueSize}`,
    `Heartbeat: ${summary.heartbeatStatus ?? "none"}`,
    `Last error: ${summary.lastError ?? "none"}`,
  ].join("\n");
}

function formatBackendStatus(summary: {
  backendType: string;
  status: string;
  inspection: {
    queueDepth: number;
    runningCount: number;
    queuedCount: number;
    pausedCount: number;
    blockedCount: number;
    staleLeaseCount: number;
    workerCount: number;
    activeWorkers: string[];
  };
  details: string[];
  migrationPath: string | null;
}) {
  return [
    `Backend: ${summary.backendType}`,
    `Status: ${summary.status}`,
    `Queue depth: ${summary.inspection.queueDepth}`,
    `Running: ${summary.inspection.runningCount}`,
    `Queued: ${summary.inspection.queuedCount}`,
    `Paused: ${summary.inspection.pausedCount}`,
    `Blocked: ${summary.inspection.blockedCount}`,
    `Stale leases: ${summary.inspection.staleLeaseCount}`,
    `Workers: ${summary.inspection.workerCount}`,
    `Active workers: ${summary.inspection.activeWorkers.join(", ") || "none"}`,
    `Details: ${summary.details.join(" | ") || "none"}`,
    `Migration path: ${summary.migrationPath ?? "none"}`,
  ].join("\n");
}

function formatBackendHealth(summary: {
  backendType: string;
  status: string;
  queueDepth: number;
  activeLeaseCount: number;
  staleLeaseCount: number;
  orphanRunCount: number;
  pendingApprovalCount: number;
  pendingPromotionCount: number;
  recoverableAnomalyCount: number;
  summary: string;
}) {
  return [
    `Backend: ${summary.backendType}`,
    `Health: ${summary.status}`,
    `Queue depth: ${summary.queueDepth}`,
    `Active leases: ${summary.activeLeaseCount}`,
    `Stale leases: ${summary.staleLeaseCount}`,
    `Orphan runs: ${summary.orphanRunCount}`,
    `Pending approval: ${summary.pendingApprovalCount}`,
    `Pending promotion: ${summary.pendingPromotionCount}`,
    `Recoverable anomalies: ${summary.recoverableAnomalyCount}`,
    `Summary: ${summary.summary}`,
  ].join("\n");
}

function formatTransferSummary(summary: {
  status: string;
  sourceBackend: string;
  targetBackend: string;
  exportedStateCount: number;
  importedStateCount: number;
  queueItemCount: number;
  workerCount: number;
  snapshotPath: string | null;
  notes: string[];
  conflicts: string[];
}) {
  return [
    `Transfer status: ${summary.status}`,
    `Source backend: ${summary.sourceBackend}`,
    `Target backend: ${summary.targetBackend}`,
    `Exported states: ${summary.exportedStateCount}`,
    `Imported states: ${summary.importedStateCount}`,
    `Queue items: ${summary.queueItemCount}`,
    `Workers: ${summary.workerCount}`,
    `Snapshot path: ${summary.snapshotPath ?? "none"}`,
    `Notes: ${summary.notes.join(" | ") || "none"}`,
    `Conflicts: ${summary.conflicts.join(" | ") || "none"}`,
  ].join("\n");
}

function formatRepairSummary(summary: {
  status: string;
  staleRequeuedCount: number;
  orphanBlockedCount: number;
  manualRequiredReasons: string[];
  summary: string;
}) {
  return [
    `Repair status: ${summary.status}`,
    `Stale requeued: ${summary.staleRequeuedCount}`,
    `Orphan blocked: ${summary.orphanBlockedCount}`,
    `Manual required: ${summary.manualRequiredReasons.join(" | ") || "none"}`,
    `Summary: ${summary.summary}`,
  ].join("\n");
}

function formatSandboxLifecycleSummary(summary: {
  action: string;
  status: string;
  profileId: string | null;
  defaultProfileId: string | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  path: string | null;
  auditId: string | null;
  governanceStatus: string;
  governanceReason: string | null;
}) {
  return [
    `Sandbox action: ${summary.action}`,
    `Status: ${summary.status}`,
    `Profile: ${summary.profileId ?? "none"}`,
    `Default profile: ${summary.defaultProfileId ?? "none"}`,
    `Config path: ${summary.path ?? "none"}`,
    `Audit: ${summary.auditId ?? "none"}`,
    `Governance: ${summary.governanceStatus} / ${summary.governanceReason ?? "none"}`,
    `Summary: ${summary.summary}`,
    `Failure: ${summary.failureReason ?? "none"}`,
    `Next action: ${summary.suggestedNextAction}`,
  ].join("\n");
}

function parseArgs(argv: string[]) {
  const [command = "help", ...rest] = argv;
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key.startsWith("--")) continue;
    options.set(key.slice(2), value ?? "true");
  }
  return {
    command,
    options,
  };
}

function normalizeCliValue(value: string) {
  return value.replace(/\^/g, "").trim();
}

function getOption(options: Map<string, string>, key: string, fallback: string) {
  return normalizeCliValue(options.get(key) ?? fallback);
}

async function loadSandboxRegistryFromOptions(options: Map<string, string>) {
  return loadGitHubSandboxTargetRegistry({
    configPath: options.get("sandbox-config") ?? null,
  });
}

function summarizeSandboxImportExport(result: {
  status: string;
  mode: string;
  affectedProfileIds: string[];
  diffSummary: string[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  outputPath: string | null;
  restorePointId?: string | null;
  restorePointSummary?: string | null;
}) {
  return [
    `Sandbox import/export: ${result.status} / ${result.mode}`,
    `Affected profiles: ${result.affectedProfileIds.join(", ") || "none"}`,
    `Diff: ${result.diffSummary.join(" | ") || "none"}`,
    `Restore point: ${result.restorePointId ?? "none"} / ${result.restorePointSummary ?? "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
    `Output: ${result.outputPath ?? "none"}`,
  ].join("\n");
}

function summarizeSandboxReview(result: {
  status: string;
  affectedProfileIds: string[];
  diffSummary: string[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  governanceStatus: string;
  guardrailsStatus: string;
  auditId: string | null;
}) {
  return [
    `Sandbox review: ${result.status}`,
    `Affected profiles: ${result.affectedProfileIds.join(", ") || "none"}`,
    `Governance: ${result.governanceStatus}`,
    `Guardrails: ${result.guardrailsStatus}`,
    `Diff: ${result.diffSummary.join(" | ") || "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
    `Audit: ${result.auditId ?? "none"}`,
  ].join("\n");
}

function summarizeSandboxBatchChange(result: {
  status: string;
  mode: string;
  affectedProfileIds: string[];
  blockedProfileIds: string[];
  manualRequiredProfileIds: string[];
  diffSummary: string[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  impactSummary: {
    summaryText: string;
  };
  restorePointId?: string | null;
  restorePointSummary?: string | null;
}) {
  return [
    `Sandbox batch change: ${result.status} / ${result.mode}`,
    `Affected profiles: ${result.affectedProfileIds.join(", ") || "none"}`,
    `Blocked profiles: ${result.blockedProfileIds.join(", ") || "none"}`,
    `Manual required profiles: ${result.manualRequiredProfileIds.join(", ") || "none"}`,
    `Impact: ${result.impactSummary.summaryText}`,
    `Restore point: ${result.restorePointId ?? "none"} / ${result.restorePointSummary ?? "none"}`,
    `Diff: ${result.diffSummary.join(" | ") || "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
  ].join("\n");
}

function summarizeSandboxRestorePoints(result: {
  restorePointsPath: string;
  records: Array<{
    id: string;
    createdAt: string;
    source: string;
    affectedProfileIds: string[];
    previousDefaultProfileId: string | null;
    reason: string;
  }>;
}) {
  return [
    `Sandbox restore points path: ${result.restorePointsPath}`,
    `Restore points: ${result.records.length}`,
    ...result.records.map(
      (record) =>
        `- ${record.createdAt} ${record.source} profiles=${record.affectedProfileIds.join(",") || "none"} default=${record.previousDefaultProfileId ?? "none"} reason=${record.reason}`,
    ),
  ].join("\n");
}

function summarizeSandboxRollback(result: {
  status: string;
  mode: string;
  restorePointId: string | null;
  affectedProfileIds: string[];
  blockedProfileIds: string[];
  manualRequiredProfileIds: string[];
  diffSummary: string[];
  impactSummary: {
    summaryText: string;
  };
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  auditId: string | null;
}) {
  return [
    `Sandbox rollback: ${result.status} / ${result.mode}`,
    `Restore point: ${result.restorePointId ?? "none"}`,
    `Affected profiles: ${result.affectedProfileIds.join(", ") || "none"}`,
    `Blocked profiles: ${result.blockedProfileIds.join(", ") || "none"}`,
    `Manual required profiles: ${result.manualRequiredProfileIds.join(", ") || "none"}`,
    `Impact: ${result.impactSummary.summaryText}`,
    `Diff: ${result.diffSummary.join(" | ") || "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
    `Audit: ${result.auditId ?? "none"}`,
  ].join("\n");
}

async function resolveSandboxGovernanceArtifacts(params: {
  configPath: string;
  state: OrchestratorState;
  sandboxRegistry: Awaited<ReturnType<typeof loadSandboxRegistryFromOptions>>;
  limit?: number;
  recordCloseoutAudit?: boolean;
  recordCloseoutReviewAudit?: boolean;
  recordCloseoutSettlementAudit?: boolean;
  recordCloseoutCompletionAudit?: boolean;
  recordCloseoutCompletionDecisionAudit?: boolean;
  actorSource?: string;
  commandSource?: string | null;
}) {
  const incidents = await classifySandboxRecoveryIncidents({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const governanceStatus = await buildSandboxGovernanceStatus({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const incidentPolicy = resolveSandboxIncidentPolicy(incidents.latestIncident);
  const resolutionEvidenceSummary = await buildSandboxResolutionEvidenceSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const closureGatingDecision = await buildSandboxClosureGatingDecision({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const resolutionReadiness = await buildSandboxResolutionReadiness({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const escalation = await buildSandboxEscalationSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const resolutionAuditLog =
    params.recordCloseoutAudit && params.actorSource
      ? await appendSandboxResolutionAuditLog({
          configPath: params.configPath,
          actorSource: params.actorSource,
          commandSource: params.commandSource ?? null,
          resolutionEvidenceSnapshot: resolutionEvidenceSummary,
          closureGatingDecisionSnapshot: closureGatingDecision,
          resolutionReadinessSnapshot: resolutionReadiness,
        })
      : null;
  const closeoutSummary = await buildSandboxCloseoutSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    latestAuditLog: resolutionAuditLog,
  });
  const closeoutChecklist = await buildSandboxCloseoutOperatorChecklist({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const resolutionAuditHistory = await buildSandboxResolutionAuditHistory({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const closeoutReviewSummary = await buildSandboxCloseoutReviewSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    resolutionAuditHistory,
    closeoutSummary,
    closeoutChecklist,
  });
  const closeoutReviewAction =
    (await listSandboxCloseoutReviewActions({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ?? null;
  const closeoutReviewQueue = await buildSandboxCloseoutReviewQueue({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    resolutionAuditHistory,
    closeoutSummary,
    closeoutChecklist,
    latestReviewAction: closeoutReviewAction,
  });
  const closeoutDispositionSummary = await buildSandboxCloseoutDispositionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutSummary,
    closeoutChecklist,
    closeoutReviewSummary,
    closeoutReviewQueue,
    resolutionAuditHistory,
    resolutionEvidenceSummary,
    resolutionReadiness,
    closureGatingDecision,
    latestReviewAction: closeoutReviewAction,
  });
  const closeoutReviewLifecycle = await buildSandboxCloseoutReviewLifecycle({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutReviewSummary,
    closeoutReviewQueue,
    closeoutDispositionSummary,
    latestReviewAction: closeoutReviewAction,
  });
  const recordedCloseoutReviewAuditTrail =
    params.recordCloseoutReviewAudit &&
    params.actorSource &&
    closeoutReviewAction !== null
      ? await appendSandboxCloseoutReviewAuditTrail({
          configPath: params.configPath,
          actorSource: params.actorSource,
          commandSource: params.commandSource ?? null,
          reviewAction: closeoutReviewAction,
          dispositionSummary: closeoutDispositionSummary,
          reviewLifecycle: closeoutReviewLifecycle,
          reviewQueue: closeoutReviewQueue,
          reviewSummary: closeoutReviewSummary,
        })
      : null;
  const closeoutReviewAuditTrail =
    recordedCloseoutReviewAuditTrail ??
    (await listSandboxCloseoutReviewAuditTrail({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;
  const closeoutReviewHistory = await buildSandboxCloseoutReviewHistory({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const closeoutReviewResolutionSummary = await buildSandboxCloseoutReviewResolutionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutDispositionSummary,
    closeoutReviewLifecycle,
    closeoutReviewQueue,
    closeoutReviewHistory,
  });
  const closeoutFollowupSummary = await buildSandboxCloseoutFollowupSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutDispositionSummary,
    closeoutReviewLifecycle,
    closeoutReviewQueue,
    closeoutReviewResolutionSummary,
    resolutionEvidenceSummary,
    closureGatingDecision,
  });
  const recordedCloseoutSettlementAudit =
    params.recordCloseoutSettlementAudit && params.actorSource
      ? await appendSandboxCloseoutSettlementAudit({
          configPath: params.configPath,
          actorSource: params.actorSource,
          commandSource: params.commandSource ?? null,
          reviewResolutionSummarySnapshot: closeoutReviewResolutionSummary,
          reviewQueueSnapshot: closeoutReviewQueue,
          followupSummarySnapshot: closeoutFollowupSummary,
          latestIncidentType: resolutionReadiness.latestIncidentType,
          latestIncidentSeverity: resolutionReadiness.latestIncidentSeverity,
          latestIncidentSummary: resolutionReadiness.latestIncidentSummary,
        })
      : null;
  const closeoutSettlementAudit =
    recordedCloseoutSettlementAudit ??
    (await listSandboxCloseoutSettlementAudits({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;
  const closeoutFollowupSummaryWithAudit = await buildSandboxCloseoutFollowupSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutDispositionSummary,
    closeoutReviewLifecycle,
    closeoutReviewQueue,
    closeoutReviewResolutionSummary,
    resolutionEvidenceSummary,
    closureGatingDecision,
    latestSettlementAudit: closeoutSettlementAudit,
  });
  const closeoutFollowupQueue = await buildSandboxCloseoutFollowupQueue({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
    closeoutReviewResolutionSummary,
    closeoutReviewQueue,
    latestSettlementAudit: closeoutSettlementAudit,
  });
  const closeoutCompletionSummary = await buildSandboxCloseoutCompletionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutDispositionSummary,
    closeoutReviewLifecycle,
    closeoutReviewResolutionSummary,
    closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
    closeoutFollowupQueue,
    resolutionEvidenceSummary,
    closureGatingDecision,
    latestSettlementAudit: closeoutSettlementAudit,
  });
  const recordedCloseoutCompletionAudit =
    params.recordCloseoutCompletionAudit &&
    params.actorSource &&
    closeoutSettlementAudit !== null
      ? await appendSandboxCloseoutCompletionAudit({
          configPath: params.configPath,
          actorSource: params.actorSource,
          commandSource: params.commandSource ?? null,
          settlementAuditSnapshot: closeoutSettlementAudit,
          followupSummarySnapshot: closeoutFollowupSummaryWithAudit,
          followupQueueSnapshot: closeoutFollowupQueue,
          latestIncidentType: resolutionReadiness.latestIncidentType,
          latestIncidentSeverity: resolutionReadiness.latestIncidentSeverity,
          latestIncidentSummary: resolutionReadiness.latestIncidentSummary,
        })
      : null;
  const closeoutCompletionAudit =
    recordedCloseoutCompletionAudit ??
    (await listSandboxCloseoutCompletionAudits({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;
  const closeoutCompletionSummaryWithAudit = await buildSandboxCloseoutCompletionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutDispositionSummary,
    closeoutReviewLifecycle,
    closeoutReviewResolutionSummary,
    closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
    closeoutFollowupQueue,
    resolutionEvidenceSummary,
    closureGatingDecision,
    latestSettlementAudit: closeoutSettlementAudit,
    latestCompletionAudit: closeoutCompletionAudit,
  });
  const closeoutCompletionQueue = await buildSandboxCloseoutCompletionQueue({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutCompletionSummary: closeoutCompletionSummaryWithAudit,
    closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
    closeoutFollowupQueue,
    latestSettlementAudit: closeoutSettlementAudit,
    latestCompletionAudit: closeoutCompletionAudit,
  });
  const closeoutCompletionHistory = await buildSandboxCloseoutCompletionHistory({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  const closeoutCompletionResolutionSummary =
    await buildSandboxCloseoutCompletionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutCompletionHistory,
      closeoutCompletionSummary: closeoutCompletionSummaryWithAudit,
      closeoutCompletionQueue,
      closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
      closeoutFollowupQueue,
      latestSettlementAudit: closeoutSettlementAudit,
      latestCompletionAudit: closeoutCompletionAudit,
    });
  const closeoutCompletionCarryForwardQueue =
    await buildSandboxCloseoutCompletionCarryForwardQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutCompletionHistory,
      closeoutCompletionResolutionSummary,
      closeoutCompletionQueue,
      closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
      closeoutFollowupQueue,
    });
  const closeoutCompletionAction =
    (await listSandboxCloseoutCompletionActions({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ?? null;
  const closeoutCompletionDispositionSummary =
    await buildSandboxCloseoutCompletionDispositionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutCompletionHistory,
      closeoutCompletionResolutionSummary,
      closeoutCompletionCarryForwardQueue,
      closeoutCompletionSummary: closeoutCompletionSummaryWithAudit,
      closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
      latestSettlementAudit: closeoutSettlementAudit,
      latestCompletionAction: closeoutCompletionAction,
    });
  const closeoutCompletionLifecycle = await buildSandboxCloseoutCompletionLifecycle({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutCompletionHistory,
    closeoutCompletionResolutionSummary,
    closeoutCompletionCarryForwardQueue,
    closeoutCompletionDispositionSummary,
    latestCompletionAction: closeoutCompletionAction,
  });
  const finalizedCloseoutCompletionCarryForwardQueue =
    await buildSandboxCloseoutCompletionCarryForwardQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutCompletionHistory,
      closeoutCompletionResolutionSummary,
      closeoutCompletionQueue,
      closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
      closeoutFollowupQueue,
      closeoutCompletionDispositionSummary,
      closeoutCompletionLifecycle,
    });
  const recordedCloseoutCompletionDecisionAudit =
    params.recordCloseoutCompletionDecisionAudit &&
    params.actorSource &&
    closeoutCompletionAction !== null
      ? await appendSandboxCloseoutCompletionDecisionAudit({
          configPath: params.configPath,
          actorSource: params.actorSource,
          commandSource: params.commandSource ?? null,
          completionAction: closeoutCompletionAction,
          dispositionSummary: closeoutCompletionDispositionSummary,
          completionLifecycle: closeoutCompletionLifecycle,
          completionCarryForwardQueue: finalizedCloseoutCompletionCarryForwardQueue,
          completionResolutionSummary: closeoutCompletionResolutionSummary,
          latestIncidentType: resolutionReadiness.latestIncidentType,
          latestIncidentSeverity: resolutionReadiness.latestIncidentSeverity,
          latestIncidentSummary: resolutionReadiness.latestIncidentSummary,
        })
      : null;
  const closeoutCompletionDecisionAudit =
    recordedCloseoutCompletionDecisionAudit ??
    (await listSandboxCloseoutCompletionDecisionAudit({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;
  const closeoutCompletionDecisionHistory =
    await buildSandboxCloseoutCompletionDecisionHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
    });
  const closeoutCompletionFinalizationSummary =
    await buildSandboxCloseoutCompletionFinalizationSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutCompletionDecisionAudit,
      closeoutCompletionDecisionHistory,
      closeoutCompletionDispositionSummary,
      closeoutCompletionLifecycle,
      closeoutCompletionCarryForwardQueue: finalizedCloseoutCompletionCarryForwardQueue,
      closeoutCompletionResolutionSummary,
    });
  const closeoutFinalizationAuditHistory =
    await buildSandboxCloseoutFinalizationAuditHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
    });
  const closeoutFinalizationStabilitySummary =
    await buildSandboxCloseoutFinalizationStabilitySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutFinalizationAuditHistory,
      closeoutCompletionFinalizationSummary,
      closeoutCompletionCarryForwardQueue: finalizedCloseoutCompletionCarryForwardQueue,
      closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
      closeoutCompletionDecisionAudit,
    });
  const closeoutPostFinalizationFollowupQueue =
    await buildSandboxCloseoutPostFinalizationFollowupQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutFinalizationAuditHistory,
      closeoutFinalizationStabilitySummary,
      closeoutCompletionFinalizationSummary,
      closeoutCompletionCarryForwardQueue: finalizedCloseoutCompletionCarryForwardQueue,
      closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
    });
  const closeoutStabilityDrift = await buildSandboxCloseoutStabilityDrift({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutFinalizationAuditHistory,
    closeoutFinalizationStabilitySummary,
    closeoutPostFinalizationFollowupQueue,
  });
  const closeoutReopenRecurrence = await buildSandboxCloseoutReopenRecurrence({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutFinalizationAuditHistory,
    closeoutFinalizationStabilitySummary,
    closeoutPostFinalizationFollowupQueue,
  });
  const closeoutStabilityWatchlist = await buildSandboxCloseoutStabilityWatchlist({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
    closeoutStabilityDrift,
    closeoutReopenRecurrence,
    closeoutFinalizationStabilitySummary,
    closeoutPostFinalizationFollowupQueue,
  });
  const closeoutStabilityRecurrenceAudit =
    await buildSandboxCloseoutStabilityRecurrenceAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutFinalizationAuditHistory,
    });
  const closeoutWatchlistResolutionSummary =
    await buildSandboxCloseoutWatchlistResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutFinalizationStabilitySummary,
      closeoutPostFinalizationFollowupQueue,
    });
  const closeoutWatchlistLifecycle =
    await buildSandboxCloseoutWatchlistLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutWatchlistResolutionSummary,
    });
  const closeoutWatchlistExitAudit =
    await buildSandboxCloseoutWatchlistExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutFinalizationAuditHistory,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutWatchlistResolutionSummary,
      closeoutWatchlistLifecycle,
      closeoutPostFinalizationFollowupQueue,
    });
  const closeoutWatchlistReAddHistory =
    await buildSandboxCloseoutWatchlistReAddHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutFinalizationAuditHistory,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutWatchlistLifecycle,
      closeoutWatchlistExitAudit,
    });
  const closeoutStabilityRecoverySummary =
    await buildSandboxCloseoutStabilityRecoverySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutWatchlistResolutionSummary,
      closeoutWatchlistLifecycle,
      closeoutPostFinalizationFollowupQueue,
    });
  const closeoutRecoveryConfidence =
    await buildSandboxCloseoutRecoveryConfidence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutStabilityRecoverySummary,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutPostFinalizationFollowupQueue,
    });
  const closeoutRecoveryRegressionAudit =
    await buildSandboxCloseoutRecoveryRegressionAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryConfidence,
      closeoutStabilityRecoverySummary,
      closeoutWatchlistReAddHistory,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
    });
  const closeoutRecoveredMonitoringQueue =
    await buildSandboxCloseoutRecoveredMonitoringQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryConfidence,
      closeoutRecoveryRegressionAudit,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutStabilityRecoverySummary,
      closeoutPostFinalizationFollowupQueue,
    });
  const closeoutRecoveryConfidenceTrend =
    await buildSandboxCloseoutRecoveryConfidenceTrend({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryConfidence,
      closeoutRecoveryRegressionAudit,
      closeoutRecoveredMonitoringQueue,
      closeoutWatchlistReAddHistory,
    });
  const closeoutRegressionResolutionSummary =
    await buildSandboxCloseoutRegressionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryRegressionAudit,
      closeoutRecoveryConfidence,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutRecoveredMonitoringQueue,
    });
  const closeoutRecoveredMonitoringExitAudit =
    await buildSandboxCloseoutRecoveredMonitoringExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringQueue,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
    });
  const closeoutRecoveryClearanceAudit =
    await buildSandboxCloseoutRecoveryClearanceAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutStabilityRecoverySummary,
    });
  const closeoutRecoveredExitHistory =
    await buildSandboxCloseoutRecoveredExitHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveredMonitoringExitAudit,
      closeoutRecoveryClearanceAudit,
      closeoutRegressionResolutionSummary,
      closeoutWatchlistReAddHistory,
    });
  const closeoutRecoveredLifecycle =
    await buildSandboxCloseoutRecoveredLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryClearanceAudit,
      closeoutRecoveredExitHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringExitAudit,
    });
  const closeoutRecoveryClearanceHistory =
    await buildSandboxCloseoutRecoveryClearanceHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryClearanceAudit,
      closeoutRecoveredExitHistory,
      closeoutRecoveredLifecycle,
    });
  const closeoutRecoveredReentryAudit =
    await buildSandboxCloseoutRecoveredReentryAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveredExitHistory,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredLifecycle,
    });
  const closeoutRecoveredLifecycleHistory =
    await buildSandboxCloseoutRecoveredLifecycleHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveredLifecycle,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredReentryAudit,
      closeoutRecoveryRegressionAudit,
      closeoutRecoveredMonitoringExitAudit,
    });
  const closeoutRecoveryRetirementAudit =
    await buildSandboxCloseoutRecoveryRetirementAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryClearanceAudit,
      closeoutRecoveredExitHistory,
      closeoutRecoveredLifecycle,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringExitAudit,
    });
  const closeoutRecoveredRetirementSummary =
    await buildSandboxCloseoutRecoveredRetirementSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryRetirementAudit,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredReentryAudit,
      closeoutRecoveredLifecycleHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
    });
  const closeoutRecoveryRetirementQueue =
    await buildSandboxCloseoutRecoveryRetirementQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryRetirementAudit,
      closeoutRecoveredRetirementSummary,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredLifecycleHistory,
    });
  const closeoutRecoveryRetirementHistory =
    await buildSandboxCloseoutRecoveryRetirementHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryRetirementAudit,
      closeoutRecoveredReentryAudit,
      closeoutRecoveredLifecycle,
      closeoutWatchlistReAddHistory,
    });
  const closeoutRetirementExitCriteria =
    await buildSandboxCloseoutRetirementExitCriteria({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryRetirementAudit,
      closeoutRecoveredRetirementSummary,
      closeoutRecoveryRetirementQueue,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredLifecycleHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
    });
  const closeoutRetiredCaseAuditHistory =
    await buildSandboxCloseoutRetiredCaseAuditHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.sandboxRegistry,
      limit: params.limit,
      closeoutRecoveryRetirementHistory,
      closeoutRecoveredExitHistory,
      closeoutRecoveredLifecycle,
      closeoutRecoveryRegressionAudit,
      closeoutWatchlistReAddHistory,
    });
  const handoffSummary = await buildSandboxOperatorHandoffSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    limit: params.limit,
  });
  return {
    incidents,
    governanceStatus,
    incidentPolicy,
    handoffSummary,
    resolutionEvidenceSummary,
    closureGatingDecision,
    resolutionReadiness,
    escalation,
    resolutionAuditLog,
    closeoutSummary,
    closeoutChecklist,
    resolutionAuditHistory,
    closeoutReviewSummary,
    closeoutReviewQueue,
    closeoutReviewAction,
    closeoutDispositionSummary,
    closeoutReviewLifecycle,
    closeoutReviewAuditTrail,
    closeoutReviewHistory,
    closeoutReviewResolutionSummary,
    closeoutSettlementAudit,
    closeoutFollowupSummary: closeoutFollowupSummaryWithAudit,
    closeoutFollowupQueue,
    closeoutCompletionAudit,
    closeoutCompletionSummary: closeoutCompletionSummaryWithAudit,
    closeoutCompletionQueue,
    closeoutCompletionHistory,
    closeoutCompletionResolutionSummary,
    closeoutCompletionCarryForwardQueue: finalizedCloseoutCompletionCarryForwardQueue,
    closeoutCompletionAction,
    closeoutCompletionDispositionSummary,
    closeoutCompletionLifecycle,
    closeoutCompletionDecisionAudit,
    closeoutCompletionDecisionHistory,
    closeoutCompletionFinalizationSummary,
    closeoutFinalizationAuditHistory,
    closeoutFinalizationStabilitySummary,
    closeoutPostFinalizationFollowupQueue,
    closeoutStabilityDrift,
    closeoutReopenRecurrence,
    closeoutStabilityWatchlist,
    closeoutStabilityRecurrenceAudit,
    closeoutWatchlistResolutionSummary,
    closeoutWatchlistLifecycle,
    closeoutWatchlistExitAudit,
    closeoutWatchlistReAddHistory,
    closeoutStabilityRecoverySummary,
    closeoutRecoveryConfidence,
    closeoutRecoveryRegressionAudit,
    closeoutRecoveredMonitoringQueue,
    closeoutRecoveryConfidenceTrend,
    closeoutRegressionResolutionSummary,
    closeoutRecoveredMonitoringExitAudit,
    closeoutRecoveryClearanceAudit,
    closeoutRecoveryClearanceHistory,
    closeoutRecoveredExitHistory,
    closeoutRecoveredLifecycle,
    closeoutRecoveredReentryAudit,
    closeoutRecoveredLifecycleHistory,
    closeoutRecoveryRetirementAudit,
    closeoutRecoveredRetirementSummary,
    closeoutRecoveryRetirementQueue,
    closeoutRecoveryRetirementHistory,
    closeoutRetirementExitCriteria,
    closeoutRetiredCaseAuditHistory,
  };
}

function buildSandboxGovernanceStatePatch(params: {
  governanceStatus: Awaited<ReturnType<typeof buildSandboxGovernanceStatus>>;
  incidentPolicy: ReturnType<typeof resolveSandboxIncidentPolicy>;
  handoffSummary: Awaited<ReturnType<typeof buildSandboxOperatorHandoffSummary>>;
  resolutionEvidenceSummary: Awaited<ReturnType<typeof buildSandboxResolutionEvidenceSummary>>;
  closureGatingDecision: Awaited<ReturnType<typeof buildSandboxClosureGatingDecision>>;
  resolutionReadiness: Awaited<ReturnType<typeof buildSandboxResolutionReadiness>>;
  escalation: Awaited<ReturnType<typeof buildSandboxEscalationSummary>>;
  resolutionAuditLog?: Awaited<ReturnType<typeof appendSandboxResolutionAuditLog>> | null;
  closeoutSummary?: Awaited<ReturnType<typeof buildSandboxCloseoutSummary>>;
  closeoutChecklist?: Awaited<ReturnType<typeof buildSandboxCloseoutOperatorChecklist>>;
  resolutionAuditHistory?: Awaited<ReturnType<typeof buildSandboxResolutionAuditHistory>>;
  closeoutReviewSummary?: Awaited<ReturnType<typeof buildSandboxCloseoutReviewSummary>>;
  closeoutReviewQueue?: Awaited<ReturnType<typeof buildSandboxCloseoutReviewQueue>>;
  closeoutReviewAction?: Awaited<ReturnType<typeof listSandboxCloseoutReviewActions>>["records"][0] | null;
  closeoutDispositionSummary?: Awaited<ReturnType<typeof buildSandboxCloseoutDispositionSummary>>;
  closeoutReviewLifecycle?: Awaited<ReturnType<typeof buildSandboxCloseoutReviewLifecycle>>;
  closeoutReviewAuditTrail?: Awaited<ReturnType<typeof appendSandboxCloseoutReviewAuditTrail>> | null;
  closeoutReviewHistory?: Awaited<ReturnType<typeof buildSandboxCloseoutReviewHistory>>;
  closeoutReviewResolutionSummary?: Awaited<ReturnType<typeof buildSandboxCloseoutReviewResolutionSummary>>;
  closeoutSettlementAudit?: Awaited<ReturnType<typeof appendSandboxCloseoutSettlementAudit>> | null;
  closeoutFollowupSummary?: Awaited<ReturnType<typeof buildSandboxCloseoutFollowupSummary>>;
  closeoutFollowupQueue?: Awaited<ReturnType<typeof buildSandboxCloseoutFollowupQueue>>;
  closeoutCompletionAudit?: Awaited<ReturnType<typeof appendSandboxCloseoutCompletionAudit>> | null;
  closeoutCompletionSummary?: Awaited<ReturnType<typeof buildSandboxCloseoutCompletionSummary>>;
  closeoutCompletionQueue?: Awaited<ReturnType<typeof buildSandboxCloseoutCompletionQueue>>;
  closeoutCompletionHistory?: Awaited<ReturnType<typeof buildSandboxCloseoutCompletionHistory>>;
  closeoutCompletionResolutionSummary?: Awaited<
    ReturnType<typeof buildSandboxCloseoutCompletionResolutionSummary>
  >;
  closeoutCompletionCarryForwardQueue?: Awaited<
    ReturnType<typeof buildSandboxCloseoutCompletionCarryForwardQueue>
  >;
  closeoutCompletionAction?: Awaited<
    ReturnType<typeof listSandboxCloseoutCompletionActions>
  >["records"][0] | null;
  closeoutCompletionDispositionSummary?: Awaited<
    ReturnType<typeof buildSandboxCloseoutCompletionDispositionSummary>
  >;
  closeoutCompletionLifecycle?: Awaited<
    ReturnType<typeof buildSandboxCloseoutCompletionLifecycle>
  >;
  closeoutCompletionDecisionAudit?: Awaited<
    ReturnType<typeof appendSandboxCloseoutCompletionDecisionAudit>
  > | null;
  closeoutCompletionDecisionHistory?: Awaited<
    ReturnType<typeof buildSandboxCloseoutCompletionDecisionHistory>
  >;
  closeoutCompletionFinalizationSummary?: Awaited<
    ReturnType<typeof buildSandboxCloseoutCompletionFinalizationSummary>
  >;
  closeoutFinalizationAuditHistory?: Awaited<
    ReturnType<typeof buildSandboxCloseoutFinalizationAuditHistory>
  >;
  closeoutFinalizationStabilitySummary?: Awaited<
    ReturnType<typeof buildSandboxCloseoutFinalizationStabilitySummary>
  >;
  closeoutPostFinalizationFollowupQueue?: Awaited<
    ReturnType<typeof buildSandboxCloseoutPostFinalizationFollowupQueue>
  >;
  closeoutStabilityDrift?: Awaited<
    ReturnType<typeof buildSandboxCloseoutStabilityDrift>
  >;
  closeoutReopenRecurrence?: Awaited<
    ReturnType<typeof buildSandboxCloseoutReopenRecurrence>
  >;
  closeoutStabilityWatchlist?: Awaited<
    ReturnType<typeof buildSandboxCloseoutStabilityWatchlist>
  >;
  closeoutStabilityRecurrenceAudit?: Awaited<
    ReturnType<typeof buildSandboxCloseoutStabilityRecurrenceAudit>
  >;
  closeoutWatchlistResolutionSummary?: Awaited<
    ReturnType<typeof buildSandboxCloseoutWatchlistResolutionSummary>
  >;
  closeoutWatchlistLifecycle?: Awaited<
    ReturnType<typeof buildSandboxCloseoutWatchlistLifecycle>
  >;
  closeoutWatchlistExitAudit?: Awaited<
    ReturnType<typeof buildSandboxCloseoutWatchlistExitAudit>
  >;
  closeoutWatchlistReAddHistory?: Awaited<
    ReturnType<typeof buildSandboxCloseoutWatchlistReAddHistory>
  >;
  closeoutStabilityRecoverySummary?: Awaited<
    ReturnType<typeof buildSandboxCloseoutStabilityRecoverySummary>
  >;
  closeoutRecoveryConfidence?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveryConfidence>
  >;
  closeoutRecoveryRegressionAudit?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveryRegressionAudit>
  >;
  closeoutRecoveredMonitoringQueue?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveredMonitoringQueue>
  >;
  closeoutRecoveryConfidenceTrend?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveryConfidenceTrend>
  >;
  closeoutRegressionResolutionSummary?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRegressionResolutionSummary>
  >;
  closeoutRecoveredMonitoringExitAudit?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveredMonitoringExitAudit>
  >;
  closeoutRecoveryClearanceAudit?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveryClearanceAudit>
  >;
  closeoutRecoveryClearanceHistory?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveryClearanceHistory>
  >;
  closeoutRecoveredExitHistory?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveredExitHistory>
  >;
  closeoutRecoveredLifecycle?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveredLifecycle>
  >;
  closeoutRecoveredReentryAudit?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveredReentryAudit>
  >;
  closeoutRecoveredLifecycleHistory?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveredLifecycleHistory>
  >;
  closeoutRecoveryRetirementAudit?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveryRetirementAudit>
  >;
  closeoutRecoveredRetirementSummary?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveredRetirementSummary>
  >;
  closeoutRecoveryRetirementQueue?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveryRetirementQueue>
  >;
  closeoutRecoveryRetirementHistory?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRecoveryRetirementHistory>
  >;
  closeoutRetirementExitCriteria?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRetirementExitCriteria>
  >;
  closeoutRetiredCaseAuditHistory?: Awaited<
    ReturnType<typeof buildSandboxCloseoutRetiredCaseAuditHistory>
  >;
}) {
  return {
    lastGovernanceStatus: params.governanceStatus,
    lastIncidentPolicy: params.incidentPolicy,
    lastOperatorHandoffSummary: params.handoffSummary,
    lastResolutionReadiness: params.resolutionReadiness,
    lastResolutionEvidenceSummary: params.resolutionEvidenceSummary,
    lastClosureGatingDecision: params.closureGatingDecision,
    ...(params.resolutionAuditLog ? { lastResolutionAuditLog: params.resolutionAuditLog } : {}),
    ...(params.closeoutSummary ? { lastCloseoutSummary: params.closeoutSummary } : {}),
    ...(params.closeoutChecklist ? { lastCloseoutChecklist: params.closeoutChecklist } : {}),
    ...(params.resolutionAuditHistory ? { lastResolutionAuditHistory: params.resolutionAuditHistory } : {}),
    ...(params.closeoutReviewSummary ? { lastCloseoutReviewSummary: params.closeoutReviewSummary } : {}),
    ...(params.closeoutReviewQueue ? { lastCloseoutReviewQueue: params.closeoutReviewQueue } : {}),
    ...(params.closeoutReviewAction ? { lastCloseoutReviewAction: params.closeoutReviewAction } : {}),
    ...(params.closeoutDispositionSummary ? { lastCloseoutDispositionSummary: params.closeoutDispositionSummary } : {}),
    ...(params.closeoutReviewLifecycle ? { lastCloseoutReviewLifecycle: params.closeoutReviewLifecycle } : {}),
    ...(params.closeoutReviewAuditTrail ? { lastCloseoutReviewAuditTrail: params.closeoutReviewAuditTrail } : {}),
    ...(params.closeoutReviewHistory ? { lastCloseoutReviewHistory: params.closeoutReviewHistory } : {}),
    ...(params.closeoutReviewResolutionSummary
      ? { lastCloseoutReviewResolutionSummary: params.closeoutReviewResolutionSummary }
      : {}),
    ...(params.closeoutSettlementAudit ? { lastCloseoutSettlementAudit: params.closeoutSettlementAudit } : {}),
    ...(params.closeoutFollowupSummary ? { lastCloseoutFollowupSummary: params.closeoutFollowupSummary } : {}),
    ...(params.closeoutFollowupQueue ? { lastCloseoutFollowupQueue: params.closeoutFollowupQueue } : {}),
    ...(params.closeoutCompletionAudit ? { lastCloseoutCompletionAudit: params.closeoutCompletionAudit } : {}),
    ...(params.closeoutCompletionSummary ? { lastCloseoutCompletionSummary: params.closeoutCompletionSummary } : {}),
    ...(params.closeoutCompletionQueue ? { lastCloseoutCompletionQueue: params.closeoutCompletionQueue } : {}),
    ...(params.closeoutCompletionHistory ? { lastCloseoutCompletionHistory: params.closeoutCompletionHistory } : {}),
    ...(params.closeoutCompletionResolutionSummary
      ? { lastCloseoutCompletionResolutionSummary: params.closeoutCompletionResolutionSummary }
      : {}),
    ...(params.closeoutCompletionCarryForwardQueue
      ? { lastCloseoutCompletionCarryForwardQueue: params.closeoutCompletionCarryForwardQueue }
      : {}),
    ...(params.closeoutCompletionAction
      ? { lastCloseoutCompletionAction: params.closeoutCompletionAction }
      : {}),
    ...(params.closeoutCompletionDispositionSummary
      ? {
          lastCloseoutCompletionDispositionSummary:
            params.closeoutCompletionDispositionSummary,
        }
      : {}),
    ...(params.closeoutCompletionLifecycle
      ? { lastCloseoutCompletionLifecycle: params.closeoutCompletionLifecycle }
      : {}),
    ...(params.closeoutCompletionDecisionAudit
      ? {
          lastCloseoutCompletionDecisionAudit:
            params.closeoutCompletionDecisionAudit,
        }
      : {}),
    ...(params.closeoutCompletionDecisionHistory
      ? {
          lastCloseoutCompletionDecisionHistory:
            params.closeoutCompletionDecisionHistory,
        }
      : {}),
    ...(params.closeoutCompletionFinalizationSummary
      ? {
          lastCloseoutCompletionFinalizationSummary:
            params.closeoutCompletionFinalizationSummary,
        }
      : {}),
    ...(params.closeoutFinalizationAuditHistory
      ? {
          lastCloseoutFinalizationAuditHistory:
            params.closeoutFinalizationAuditHistory,
        }
      : {}),
    ...(params.closeoutFinalizationStabilitySummary
      ? {
          lastCloseoutFinalizationStabilitySummary:
            params.closeoutFinalizationStabilitySummary,
        }
      : {}),
    ...(params.closeoutPostFinalizationFollowupQueue
      ? {
          lastCloseoutPostFinalizationFollowupQueue:
            params.closeoutPostFinalizationFollowupQueue,
        }
      : {}),
    ...(params.closeoutStabilityDrift
      ? { lastCloseoutStabilityDrift: params.closeoutStabilityDrift }
      : {}),
    ...(params.closeoutReopenRecurrence
      ? { lastCloseoutReopenRecurrence: params.closeoutReopenRecurrence }
      : {}),
    ...(params.closeoutStabilityWatchlist
      ? { lastCloseoutStabilityWatchlist: params.closeoutStabilityWatchlist }
      : {}),
    ...(params.closeoutStabilityRecurrenceAudit
      ? {
          lastCloseoutStabilityRecurrenceAudit:
            params.closeoutStabilityRecurrenceAudit,
        }
      : {}),
    ...(params.closeoutWatchlistResolutionSummary
      ? {
          lastCloseoutWatchlistResolutionSummary:
            params.closeoutWatchlistResolutionSummary,
        }
      : {}),
    ...(params.closeoutWatchlistLifecycle
      ? { lastCloseoutWatchlistLifecycle: params.closeoutWatchlistLifecycle }
      : {}),
    ...(params.closeoutWatchlistExitAudit
      ? { lastCloseoutWatchlistExitAudit: params.closeoutWatchlistExitAudit }
      : {}),
    ...(params.closeoutWatchlistReAddHistory
      ? {
          lastCloseoutWatchlistReaddHistory:
            params.closeoutWatchlistReAddHistory,
        }
      : {}),
    ...(params.closeoutStabilityRecoverySummary
      ? {
          lastCloseoutStabilityRecoverySummary:
            params.closeoutStabilityRecoverySummary,
        }
      : {}),
    ...(params.closeoutRecoveryConfidence
      ? { lastCloseoutRecoveryConfidence: params.closeoutRecoveryConfidence }
      : {}),
    ...(params.closeoutRecoveryRegressionAudit
      ? {
          lastCloseoutRecoveryRegressionAudit:
            params.closeoutRecoveryRegressionAudit,
        }
      : {}),
    ...(params.closeoutRecoveredMonitoringQueue
      ? {
          lastCloseoutRecoveredMonitoringQueue:
            params.closeoutRecoveredMonitoringQueue,
        }
      : {}),
    ...(params.closeoutRecoveryConfidenceTrend
      ? {
          lastCloseoutRecoveryConfidenceTrend:
            params.closeoutRecoveryConfidenceTrend,
        }
      : {}),
    ...(params.closeoutRegressionResolutionSummary
      ? {
          lastCloseoutRegressionResolutionSummary:
            params.closeoutRegressionResolutionSummary,
        }
      : {}),
    ...(params.closeoutRecoveredMonitoringExitAudit
      ? {
          lastCloseoutRecoveredMonitoringExitAudit:
            params.closeoutRecoveredMonitoringExitAudit,
        }
      : {}),
    ...(params.closeoutRecoveryClearanceAudit
      ? {
          lastCloseoutRecoveryClearanceAudit:
            params.closeoutRecoveryClearanceAudit,
        }
      : {}),
    ...(params.closeoutRecoveryClearanceHistory
      ? {
          lastCloseoutRecoveryClearanceHistory:
            params.closeoutRecoveryClearanceHistory,
        }
      : {}),
    ...(params.closeoutRecoveredExitHistory
      ? {
          lastCloseoutRecoveredExitHistory:
            params.closeoutRecoveredExitHistory,
        }
      : {}),
    ...(params.closeoutRecoveredLifecycle
      ? {
          lastCloseoutRecoveredLifecycle:
            params.closeoutRecoveredLifecycle,
        }
      : {}),
    ...(params.closeoutRecoveredReentryAudit
      ? {
          lastCloseoutRecoveredReentryAudit:
            params.closeoutRecoveredReentryAudit,
        }
      : {}),
    ...(params.closeoutRecoveredLifecycleHistory
      ? {
          lastCloseoutRecoveredLifecycleHistory:
            params.closeoutRecoveredLifecycleHistory,
        }
      : {}),
    ...(params.closeoutRecoveryRetirementAudit
      ? {
          lastCloseoutRecoveryRetirementAudit:
            params.closeoutRecoveryRetirementAudit,
        }
      : {}),
    ...(params.closeoutRecoveredRetirementSummary
      ? {
          lastCloseoutRecoveredRetirementSummary:
            params.closeoutRecoveredRetirementSummary,
        }
      : {}),
    ...(params.closeoutRecoveryRetirementQueue
      ? {
          lastCloseoutRecoveryRetirementQueue:
            params.closeoutRecoveryRetirementQueue,
        }
      : {}),
    ...(params.closeoutRecoveryRetirementHistory
      ? {
          lastCloseoutRecoveryRetirementHistory:
            params.closeoutRecoveryRetirementHistory,
        }
      : {}),
    ...(params.closeoutRetirementExitCriteria
      ? {
          lastCloseoutRetirementExitCriteria:
            params.closeoutRetirementExitCriteria,
        }
      : {}),
    ...(params.closeoutRetiredCaseAuditHistory
      ? {
          lastCloseoutRetiredCaseAuditHistory:
            params.closeoutRetiredCaseAuditHistory,
        }
      : {}),
    lastRecoveryIncidentSummary: params.resolutionEvidenceSummary.latestIncidentSummary ?? params.resolutionEvidenceSummary.summary,
    lastIncidentType: params.resolutionReadiness.latestIncidentType,
    lastIncidentSeverity: params.resolutionReadiness.latestIncidentSeverity,
    lastIncidentSummary: params.resolutionReadiness.latestIncidentSummary,
    lastOperatorAction: params.resolutionReadiness.latestOperatorAction,
    lastOperatorActionStatus: params.resolutionReadiness.latestOperatorActionStatus,
    lastEscalationSummary: params.escalation.summary,
  };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const repoPath = getOption(options, "repo", process.cwd());
  const stateId = getOption(options, "state-id", "default");
  const storageRoot = getOption(options, "storage-root", path.join(repoPath, ".tmp", "orchestrator-state"));
  const executorMode = getOption(options, "executor", "mock") as ExecutorProviderKind;
  const executionMode = getOption(options, "execution-mode", executorMode === "mock" ? "mock" : "dry_run") as ExecutionMode;
  const executorFallbackMode = getOption(options, "executor-fallback", "blocked") as ExecutorFallbackMode;
  const backendType = getOption(options, "backend-type", "file") as BackendType;
  const backendFallbackType = getOption(options, "backend-fallback", "blocked") as BackendType | "blocked";
  const workspaceRoot = getOption(options, "workspace-root", path.join(repoPath, ".tmp", "orchestrator-workspaces"));
  const liveSmokeEnabled = getOption(options, "live-smoke", "false") === "true";
  const applyWorkspace = getOption(options, "apply-workspace", "false") === "true";
  const createBranch = getOption(options, "create-branch", "true") === "true";
  const publishBranch = getOption(options, "publish-branch", "false") === "true";
  const githubHandoffEnabled = getOption(options, "github-handoff", "false") === "true";
  let dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    backendType,
    backendFallbackType,
    executorMode,
    workspaceRoot,
  });

  if (command === "init") {
    const state = createInitialState({
      id: stateId,
      repoPath,
      repoName: path.basename(repoPath),
      userGoal: getOption(options, "goal", "Establish orchestrator MVP"),
      objective: getOption(options, "objective", "Build orchestrator MVP loop"),
      subtasks: getOption(options, "subtasks", "schemas,policies,planner,reviewer,storage,executor,cli")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      allowedFiles: getOption(options, "allowed-files", "tools/orchestrator,docs/orchestrator-runbook.md,package.json,.github/workflows")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      forbiddenFiles: getOption(
        options,
        "forbidden-files",
        "app/api/platform/notifications,/api/jobs/run,components/notification-overview-dashboard.tsx,components/notification-overview-tenant-drilldown.tsx",
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      successCriteria: getOption(
        options,
        "success-criteria",
        "MVP loop runs,schemas validate,planner and reviewer produce outputs,mock executor works,local executor smoke test works",
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      profileId: options.get("profile") ?? "default",
      profileName: options.get("profile-name") ?? null,
      repoType: options.get("repo-type") ?? null,
      autoMode: getOption(options, "auto-mode", "false") === "true",
      approvalMode: getOption(options, "approval-mode", "human_approval") as "auto" | "human_approval",
      executorMode,
      executionMode,
      executorFallbackMode,
      workspaceRoot,
      commandAllowList: getOption(options, "command-allow-list", "node,npm,git")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      executorCommand: getOption(options, "local-command", "node,-e,console.log('local-executor-ok')")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      plannerProvider: getOption(options, "planner-provider", "rule_based") as PlannerProviderKind,
      reviewerProvider: getOption(options, "reviewer-provider", "rule_based") as PlannerProviderKind,
      promotionConfig: {
        branchNameTemplate: getOption(options, "promotion-branch-template", "orchestrator/{taskId}/iter-{iteration}"),
        baseBranch: getOption(options, "promotion-base-branch", "main"),
        allowPublish: getOption(options, "promotion-allow-publish", "false") === "true",
        approvalRequired: getOption(options, "promotion-approval-required", "true") === "true",
        allowApplyWorkspace: getOption(options, "promotion-allow-apply-workspace", "false") === "true",
        requirePatchExport: getOption(options, "promotion-require-patch-export", "true") === "true",
      },
      retentionConfig: {
        recentSuccessKeep: Number.parseInt(getOption(options, "retention-success-keep", "3"), 10),
        recentFailureKeep: Number.parseInt(getOption(options, "retention-failure-keep", "5"), 10),
        staleWorkspaceTtlMinutes: Number.parseInt(getOption(options, "retention-stale-workspace-ttl", "120"), 10),
        orphanArtifactTtlMinutes: Number.parseInt(getOption(options, "retention-orphan-artifact-ttl", "240"), 10),
        preserveApprovalPending: getOption(options, "retention-preserve-approval-pending", "true") === "true",
      },
      handoffConfig: {
        githubHandoffEnabled: getOption(options, "handoff-github-enabled", "false") === "true",
        publishBranch: getOption(options, "handoff-publish-branch", "false") === "true",
        createBranch: getOption(options, "handoff-create-branch", "true") === "true",
      },
      backendType,
    });
    await dependencies.storage.saveState(state);
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }

  if (command === "event:intake") {
    const payloadPath = options.get("payload");
    if (!payloadPath) {
      throw new Error("--payload is required for event:intake.");
    }
    const payload = JSON.parse(await readFile(path.resolve(payloadPath), "utf8")) as unknown;
    const intake = await ingestGitHubEvent({
      payload,
      dependencies,
      repoPath,
      replayOverride: getOption(options, "replay", "false") === "true",
      enqueue: getOption(options, "enqueue", "true") === "true",
    });
    let updatedState = intake.state;
    let statusReport = null;
    if (getOption(options, "report-status", "true") === "true") {
      statusReport = await reportStateStatus({
        state: intake.state,
        outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report")),
        adapter: new GhCliStatusReportingAdapter({
          enabled: getOption(options, "enabled", "true") === "true",
          token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
        }),
      });
      updatedState = applyStatusReportToState(intake.state, statusReport);
      await dependencies.storage.saveState(updatedState);
    }
    process.stdout.write(`${JSON.stringify({ ...intake, state: updatedState, statusReport }, null, 2)}\n`);
    return;
  }

  if (command === "webhook:intake") {
    const payloadPath = options.get("payload");
    const headersPath = options.get("headers");
    if (!payloadPath || !headersPath) {
      throw new Error("--payload and --headers are required for webhook:intake.");
    }
    const rawBody = await readFile(path.resolve(payloadPath), "utf8");
    const headers = JSON.parse(await readFile(path.resolve(headersPath), "utf8")) as Record<string, string | undefined>;
    const result = await ingestGitHubWebhook({
      rawBody,
      headers,
      secret: options.get("webhook-secret") ?? process.env.GITHUB_WEBHOOK_SECRET ?? null,
      dependencies,
      repoPath,
      enqueue: getOption(options, "enqueue", "true") === "true",
      replayOverride: getOption(options, "replay", "false") === "true",
      reportStatus: getOption(options, "report-status", "true") === "true",
      statusAdapter: new GhCliStatusReportingAdapter({
        enabled: getOption(options, "enabled", "true") === "true",
        token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      }),
      statusOutputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report")),
      auditOutputRoot: getOption(options, "audit-output-root", path.join(repoPath, ".tmp", "orchestrator-inbound")),
      actorPolicyConfigPath: options.get("actor-policy-config") ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "webhook:runtime") {
    const hostingConfig = loadWebhookHostingConfig({
      repoPath,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report")),
      options: {
        host: options.get("host"),
        port: options.get("port"),
        basePath: options.get("base-path"),
        webhookPath: options.get("webhook-path"),
        webhookSecret: options.get("webhook-secret") ?? process.env.GITHUB_WEBHOOK_SECRET ?? null,
        actorPolicyConfigPath: options.get("actor-policy-config") ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
        liveReportingEnabled: getOption(options, "enabled", "true") === "true",
      },
    });
    const summary = await evaluateWebhookRuntime({
      dependencies,
      webhookSecret: hostingConfig.webhookSecret,
      actorPolicyConfigPath: hostingConfig.actorPolicyConfigPath,
      liveReportingEnabled: hostingConfig.liveReportingEnabled,
      host: hostingConfig.host,
      port: hostingConfig.port,
      basePath: hostingConfig.basePath,
      webhookPath: hostingConfig.webhookPath,
    });
    process.stdout.write(
      `${formatWebhookHostingConfig(hostingConfig)}\n${formatWebhookRuntimeSummary(summary)}\n\n${JSON.stringify(summary, null, 2)}\n`,
    );
    return;
  }

  if (command === "webhook:serve") {
    const handle = await startWebhookHosting({
      repoPath,
      dependencies,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report")),
      options: {
        host: options.get("host"),
        port: options.get("port"),
        basePath: options.get("base-path"),
        webhookPath: options.get("webhook-path"),
        webhookSecret: options.get("webhook-secret") ?? process.env.GITHUB_WEBHOOK_SECRET ?? null,
        actorPolicyConfigPath: options.get("actor-policy-config") ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
        liveReportingEnabled: getOption(options, "enabled", "true") === "true",
        enqueue: getOption(options, "enqueue", "true") === "true",
        replayOverride: getOption(options, "replay", "false") === "true",
        reportStatus: getOption(options, "report-status", "true") === "true",
      },
    });
    process.stdout.write(`${handle.startupText}\n\n`);
    await new Promise<void>((resolve) => {
      process.once("SIGINT", async () => {
        const summary = await handle.shutdown("sigint");
        process.stdout.write(`${formatWebhookShutdownSummary(summary)}\n`);
        resolve();
      });
      process.once("SIGTERM", async () => {
        const summary = await handle.shutdown("sigterm");
        process.stdout.write(`${formatWebhookShutdownSummary(summary)}\n`);
        resolve();
      });
    });
    return;
  }

  if (command === "actor-policy:check") {
    const actor = options.get("actor") ?? "";
    const actorPolicy = await loadActorPolicyConfig({
      configPath: options.get("actor-policy-config") ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
    });
    const commandName = options.get("command");
    const decision = resolveActorAuthorization({
      actor: actor ? { login: actor, id: null, type: "User" } : null,
      command: commandName
        ? (commandName as "run" | "dry_run" | "status" | "retry" | "approve" | "reject")
        : null,
      executionMode: options.has("execution-mode")
        ? (getOption(options, "execution-mode", "dry_run") as ExecutionMode)
        : null,
      approvalRequired: getOption(options, "approval-required", "true") === "true",
      liveRequested: getOption(options, "live", "false") === "true",
      config: actorPolicy.config,
      configVersion: actorPolicy.version,
    });
    process.stdout.write(`${JSON.stringify({ actorPolicy: describeActorPolicyConfig(actorPolicy), decision }, null, 2)}\n`);
    return;
  }

  if (command === "inbound:list") {
    const records = await listInboundAuditRecords(dependencies.storage);
    process.stdout.write(
      `${records.map((record) => `${record.id} | ${record.eventType} | ${record.actorIdentity?.login ?? "none"} | ${record.summary}`).join("\n") || "No inbound audits recorded."}\n`,
    );
    return;
  }

  if (command === "inbound:inspect") {
    const inboundId = options.get("inbound-id");
    if (!inboundId) {
      throw new Error("--inbound-id is required for inbound:inspect.");
    }
    const record = await dependencies.storage.loadInboundAudit(inboundId);
    if (!record) {
      throw new Error(`Inbound audit ${inboundId} was not found.`);
    }
    process.stdout.write(`${formatInboundAuditSummary(record)}\n\n${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  const existingState = await dependencies.storage.loadState(stateId);
  if (!existingState) {
    throw new Error(`State ${stateId} was not found. Run init first.`);
  }
  if (existingState.backendType !== dependencies.backend.backendType) {
    dependencies = createDefaultDependencies({
      repoPath,
      storageRoot,
      backendType: existingState.backendType,
      backendFallbackType,
      executorMode,
      workspaceRoot,
    });
  }

  if (command === "plan") {
    const updated = await planOrchestratorIteration(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updated.plannerDecision, null, 2)}\n`);
    return;
  }

  if (command === "review") {
    process.stdout.write(`${JSON.stringify(existingState.lastReviewVerdict, null, 2)}\n`);
    return;
  }

  if (command === "report:intake") {
    const reportPath = options.get("report");
    if (!reportPath) {
      throw new Error("--report is required for report:intake.");
    }
    const result = await ingestGptCodeReportFromFile({
      stateId,
      reportPath,
      dependencies,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-report-bridge", stateId, "latest")),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "preflight") {
    const preflight = await runOrchestratorPreflight({
      repoPath,
      workspaceRoot,
      state: existingState,
    });
    process.stdout.write(`${formatPreflightSummary(preflight)}\n\n${JSON.stringify(preflight, null, 2)}\n`);
    return;
  }

  if (command === "status:report") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const result = await reportStateStatus({
      state: existingState,
      outputRoot,
      adapter: new GhCliStatusReportingAdapter({
        enabled: getOption(options, "enabled", "true") === "true",
        token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      }),
    });
    const updated = applyStatusReportToState(existingState, result);
    await dependencies.storage.saveState(updated);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "github-live-report:smoke") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runGitHubLiveCommentSmoke({
      state: existingState,
      outputRoot,
      adapter,
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "reporting:smoke") {
    const result = await runGitHubReportPermissionSmoke({
      state: existingState,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "reporting:permissions") {
    const result = await runGitHubReportPermissionSmoke({
      state: existingState,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    process.stdout.write(
      [
        `GitHub reporting permissions: ${result.status} / ${result.permissionStatus}`,
        `Target strategy: ${result.targetStrategy}`,
        `Target: ${result.targetKind}:${result.targetId ?? "none"}`,
        `Summary: ${result.summary}`,
        `Next action: ${result.suggestedNextAction}`,
        "",
        JSON.stringify(result, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "reporting:target-check") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const registryResolution = resolveGitHubSandboxTarget({
      state: existingState,
      loadedRegistry: sandboxRegistry,
      requestedProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
    });
    const result =
      registryResolution.status === "resolved"
        ? selectGitHubLiveSmokeTarget({
            state: existingState,
            requestedTarget: registryResolution.requestedTarget,
          })
        : null;
    process.stdout.write(
      [
        `Sandbox registry: ${describeGitHubSandboxTargetRegistry(sandboxRegistry)}`,
        `Registry resolution: ${registryResolution.status} / profile=${registryResolution.profileId ?? "none"} / source=${registryResolution.configSource}`,
        `Registry summary: ${registryResolution.summary}`,
        result
          ? `GitHub auth smoke target: ${result.status} / mode=${result.mode} / action=${result.attemptedAction} / target=${result.target.targetType ?? "none"} ${result.target.repository ?? "none"}#${result.target.targetNumber ?? "none"}`
          : "GitHub auth smoke target: unresolved",
        `Next action: ${result?.suggestedNextAction ?? registryResolution.suggestedNextAction}`,
        "",
        JSON.stringify({ sandboxRegistry, registryResolution, result }, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "sandbox:list") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    process.stdout.write(`${formatSandboxProfileList(sandboxRegistry)}\n\n${JSON.stringify(sandboxRegistry, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:bundle:list") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    process.stdout.write(`${formatSandboxPolicyBundleList(sandboxRegistry)}\n\n${JSON.stringify(sandboxRegistry.registry.bundles, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:bundle:show") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const bundle = showSandboxPolicyBundle(sandboxRegistry, options.get("sandbox-bundle") ?? null);
    process.stdout.write(`${formatSandboxPolicyBundle(bundle)}\n\n${JSON.stringify({ bundle, sandboxRegistry }, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:bundle:governance") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const bundleId = options.get("sandbox-bundle") ?? null;
    const decision = evaluateSandboxBundleGovernance({
      loadedRegistry: sandboxRegistry,
      bundleId,
      profileId: options.get("sandbox-profile") ?? null,
      intendedUse:
        (options.get("intended-use") as "apply" | "default" | "live_smoke" | undefined) ?? "apply",
    });
    const inspection = inspectSandboxBundleGovernance(sandboxRegistry);
    process.stdout.write(
      `${formatSandboxBundleGovernanceSummary(decision)}\nRegistry invalid bundles: ${inspection.invalidBundleIds.join(", ") || "none"}\nRegistry disabled bundles: ${inspection.disabledBundleIds.join(", ") || "none"}\n\n${JSON.stringify({ decision, inspection, sandboxRegistry }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:create") {
    const profileId = options.get("sandbox-profile");
    if (!profileId) {
      throw new Error("--sandbox-profile is required for sandbox:create.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const bundleId = options.get("sandbox-bundle") ?? null;
    const targetNumber = options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null;
    const bundleResult =
      bundleId !== null
        ? applySandboxPolicyBundle({
            loadedRegistry: sandboxRegistry,
            bundleId,
            overrides: {
              repository: options.get("target-repo") ?? undefined,
              targetType: options.has("target-type")
                ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
                : undefined,
              targetNumber: targetNumber ?? undefined,
              actionPolicy: options.get("action-policy") as "create_or_update" | "create_only" | "update_only" | undefined,
              enabled: options.has("enabled") ? getOption(options, "enabled", "true") === "true" : undefined,
              notes: options.get("notes") ?? undefined,
            },
          })
        : null;
    if (bundleId !== null) {
      const bundleGovernance = evaluateSandboxBundleGovernance({
        loadedRegistry: sandboxRegistry,
        bundleId,
        intendedUse: getOption(options, "set-default", "false") === "true" ? "default" : "apply",
      });
      if (bundleGovernance.status !== "ready") {
        process.stdout.write(`${formatSandboxBundleGovernanceSummary(bundleGovernance)}\n\n${JSON.stringify(bundleGovernance, null, 2)}\n`);
        return;
      }
    }
    if (bundleResult && bundleResult.status !== "resolved") {
      process.stdout.write(`${bundleResult.summary}\n\n${JSON.stringify(bundleResult, null, 2)}\n`);
      return;
    }
    const directRepository = options.get("target-repo");
    const directTargetType = options.get("target-type") as "issue" | "pull_request" | undefined;
    if (
      !bundleResult &&
      (!directRepository || !directTargetType || !targetNumber)
    ) {
      throw new Error("--target-repo, --target-type, and --target-number are required for sandbox:create unless --sandbox-bundle resolves them.");
    }
    const profile = bundleResult?.profile ?? {
      repository: directRepository!,
      targetType: directTargetType!,
      targetNumber: targetNumber!,
      actionPolicy: (options.get("action-policy") as "create_or_update" | "create_only" | "update_only" | undefined) ?? "create_or_update",
      enabled: getOption(options, "enabled", "true") === "true",
      notes: options.get("notes") ?? null,
    };
    const result = await createSandboxProfile({
      configPath: options.get("sandbox-config") ?? null,
      profileId,
      profile,
      setDefault: getOption(options, "set-default", "false") === "true",
    });
    process.stdout.write(`${formatSandboxLifecycleSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:update") {
    const profileId = options.get("sandbox-profile");
    if (!profileId) {
      throw new Error("--sandbox-profile is required for sandbox:update.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const existingProfile = sandboxRegistry.registry.profiles[profileId] ?? null;
    const changes: Record<string, unknown> = {};
    if (options.has("target-repo")) changes.repository = options.get("target-repo");
    if (options.has("target-type")) changes.targetType = getOption(options, "target-type", "issue");
    if (options.has("target-number")) changes.targetNumber = Number.parseInt(getOption(options, "target-number", "0"), 10);
    if (options.has("action-policy")) changes.actionPolicy = options.get("action-policy");
    if (options.has("enabled")) changes.enabled = getOption(options, "enabled", "true") === "true";
    if (options.has("notes")) changes.notes = options.get("notes");
    if (options.has("sandbox-bundle")) {
      const bundleGovernance = evaluateSandboxBundleGovernance({
        loadedRegistry: sandboxRegistry,
        bundleId: options.get("sandbox-bundle") ?? null,
        profileId,
        intendedUse: sandboxRegistry.registry.defaultProfileId === profileId ? "default" : "apply",
      });
      if (bundleGovernance.status !== "ready") {
        process.stdout.write(`${formatSandboxBundleGovernanceSummary(bundleGovernance)}\n\n${JSON.stringify(bundleGovernance, null, 2)}\n`);
        return;
      }
      const bundleResult = applySandboxPolicyBundle({
        loadedRegistry: sandboxRegistry,
        bundleId: options.get("sandbox-bundle") ?? null,
        existingProfile,
        overrides: changes,
      });
      if (bundleResult.status !== "resolved" || !bundleResult.profile) {
        process.stdout.write(`${bundleResult.summary}\n\n${JSON.stringify(bundleResult, null, 2)}\n`);
        return;
      }
      Object.assign(changes, bundleResult.profile);
    }
    const result = await updateSandboxProfile({
      configPath: options.get("sandbox-config") ?? null,
      profileId,
      changes,
    });
    process.stdout.write(`${formatSandboxLifecycleSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:delete") {
    const profileId = options.get("sandbox-profile");
    if (!profileId) {
      throw new Error("--sandbox-profile is required for sandbox:delete.");
    }
    const result = await deleteSandboxProfile({
      configPath: options.get("sandbox-config") ?? null,
      profileId,
    });
    process.stdout.write(`${formatSandboxLifecycleSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:set-default") {
    const profileId = options.get("sandbox-profile");
    if (!profileId) {
      throw new Error("--sandbox-profile is required for sandbox:set-default.");
    }
    const result = await setDefaultSandboxProfile({
      configPath: options.get("sandbox-config") ?? null,
      profileId,
    });
    process.stdout.write(`${formatSandboxLifecycleSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:show") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const profileId = options.get("sandbox-profile") ?? sandboxRegistry.registry.defaultProfileId ?? null;
    const profile = showSandboxProfile(sandboxRegistry, profileId);
    process.stdout.write(
      [
        `Sandbox profile: ${profileId ?? "none"}`,
        `Found: ${profile ? "yes" : "no"}`,
        profile
          ? `Target: ${profile.targetType} ${profile.repository}#${profile.targetNumber} (${profile.actionPolicy})`
          : "Target: none",
        `Bundle: ${profile?.bundleId ?? "none"} / overrides=${profile?.overrideFields.join(", ") || "none"}`,
        `Default profile: ${sandboxRegistry.registry.defaultProfileId ?? "none"}`,
        `Config: ${sandboxRegistry.source}/${sandboxRegistry.version} (${sandboxRegistry.path ?? "no-path"})`,
        "",
        JSON.stringify({ profile, sandboxRegistry }, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "sandbox:validate") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const validation = validateSandboxProfile({
      state: existingState,
      loadedRegistry: sandboxRegistry,
      profileId: options.get("sandbox-profile") ?? null,
    });
    process.stdout.write(`${formatSandboxProfileValidation(validation)}\n\n${JSON.stringify(validation, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required for sandbox:audit.");
    }
    const audit = await listSandboxAuditRecords({
      configPath,
      limit: options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10,
    });
    process.stdout.write(`${formatSandboxAuditTrail(audit.records)}\n\n${JSON.stringify(audit, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:restore-points" || command === "sandbox:restore-points:list") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required for sandbox:restore-points.");
    }
    const restorePoints = await listSandboxRestorePoints({
      configPath,
      limit: options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastSandboxHistorySummary: `Restore point lookup returned ${restorePoints.records.length} item(s).`,
      lastRestorePointLookupStatus: restorePoints.records.length > 0 ? "ready" : "manual_required",
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${summarizeSandboxRestorePoints(restorePoints)}\n\n${JSON.stringify(restorePoints, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:history" || command === "sandbox:rollback:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const kind =
      command === "sandbox:rollback:history"
        ? "rollback"
        : ((options.get("kind") as "all" | "restore_points" | "rollback" | "batch_recovery" | null) ?? "all");
    const result = await querySandboxHistory({
      configPath,
      kind,
      limit: options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastSandboxHistorySummary: result.summary,
      lastRestorePointLookupStatus: result.entries.length > 0 ? "ready" : "manual_required",
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${formatSandboxHistory(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:restore-points:prune") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required for sandbox:restore-points:prune.");
    }
    const result = await pruneSandboxRestorePoints({
      configPath,
      state: existingState,
      retainRecent: options.has("retain-recent") ? Number.parseInt(getOption(options, "retain-recent", "10"), 10) : undefined,
      maxAgeHours: options.has("max-age-hours") ? Number.parseInt(getOption(options, "max-age-hours", "0"), 10) : undefined,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      currentRestorePointCount: result.totalCount,
      currentValidRestorePointCount: result.validCount,
      restorePointRetentionStatus: result.status,
      lastRestorePointPruneSummary: result.summary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${formatSandboxRestoreRetentionSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:governance") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const profileId = options.get("sandbox-profile") ?? sandboxRegistry.registry.defaultProfileId ?? null;
    const decision = evaluateSandboxProfileGovernance({
      loadedRegistry: sandboxRegistry,
      profileId,
      requireDefaultSafePolicy: sandboxRegistry.registry.defaultProfileId === profileId,
    });
    const inspection = inspectSandboxGovernance(sandboxRegistry);
    process.stdout.write(
      `${formatSandboxGovernanceSummary(decision)}\nRegistry invalid profiles: ${inspection.invalidProfileIds.join(", ") || "none"}\nRegistry disabled profiles: ${inspection.disabledProfileIds.join(", ") || "none"}\n\n${JSON.stringify({ decision, inspection, sandboxRegistry }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:guardrails") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const registryResolution = resolveGitHubSandboxTarget({
      state: existingState,
      loadedRegistry: sandboxRegistry,
      requestedProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
    });
    const decision = evaluateSandboxGuardrails({
      state: existingState,
      loadedRegistry: sandboxRegistry,
      selectedProfileId: registryResolution.profileId,
      selectionMode: registryResolution.selectionMode,
      selectionReason: registryResolution.selectionReason,
    });
    process.stdout.write(
      `${formatSandboxGuardrailsSummary(decision)}\nSelection summary: ${registryResolution.summary}\n\n${JSON.stringify({ registryResolution, decision }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:export") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const outputPath = path.resolve(
      options.get("output") ??
        path.join(repoPath, ".tmp", "orchestrator-sandbox", options.get("sandbox-profile") ? `${options.get("sandbox-profile")}.json` : "sandbox-export.json"),
    );
    const result = await exportSandboxProfiles({
      loadedRegistry: sandboxRegistry,
      outputPath,
      profileId: options.get("sandbox-profile") ?? null,
      snapshot: getOption(options, "snapshot", "false") === "true",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastSandboxImportExportStatus: result.status,
      lastSandboxImportExportSummary: result.summary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${summarizeSandboxImportExport(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:import") {
    const configPath = options.get("sandbox-config");
    const inputPath = options.get("input");
    if (!configPath || !inputPath) {
      throw new Error("--sandbox-config and --input are required for sandbox:import.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const result = await importSandboxProfiles({
      configPath,
      inputPath,
      loadedRegistry: sandboxRegistry,
      state: existingState,
      mode: (options.get("mode") as "preview" | "apply" | undefined) ?? "preview",
      actorSource: `sandbox:import:${(options.get("mode") as "preview" | "apply" | undefined) ?? "preview"}`,
      commandSource: "cli",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastSandboxImportExportStatus: result.status,
      lastSandboxImportExportSummary: result.summary,
      lastSandboxDiffSummary: result.diffSummary,
      lastRestorePointId: result.mode === "apply" ? result.restorePointId ?? existingState.lastRestorePointId : existingState.lastRestorePointId,
      lastRestorePointSummary:
        result.mode === "apply" ? result.restorePointSummary ?? existingState.lastRestorePointSummary : existingState.lastRestorePointSummary,
      lastSandboxApplyStatus:
        result.mode === "apply" && result.status === "imported"
          ? "applied"
          : result.mode === "apply" && (result.status === "blocked" || result.status === "manual_required")
            ? result.status
            : existingState.lastSandboxApplyStatus,
      lastSandboxApplySummary: result.mode === "apply" ? result.summary : existingState.lastSandboxApplySummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${summarizeSandboxImportExport(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:diff" || command === "sandbox:review" || command === "sandbox:apply") {
    const configPath = options.get("sandbox-config");
    const inputPath = options.get("input");
    if (!configPath || !inputPath) {
      throw new Error("--sandbox-config and --input are required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const importPreview = await importSandboxProfiles({
      configPath,
      inputPath,
      loadedRegistry: sandboxRegistry,
      state: existingState,
      mode: "preview",
      actorSource: "sandbox:review",
      commandSource: "cli",
    });
    if (command === "sandbox:diff") {
      process.stdout.write(`${summarizeSandboxImportExport(importPreview)}\n\n${JSON.stringify(importPreview, null, 2)}\n`);
      return;
    }
    const proposedRegistry = importPreview.registry ?? sandboxRegistry.registry;
    const review = await reviewSandboxRegistryChange({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      proposedRegistry,
      actorSource: "sandbox:review",
      commandSource: "cli",
      recordAudit: command === "sandbox:review",
    });
    if (command === "sandbox:review") {
      const updatedState = orchestratorStateSchema.parse({
        ...existingState,
        lastSandboxDiffSummary: review.diffSummary,
        lastSandboxReviewStatus: review.status,
        lastSandboxReviewSummary: review.summary,
        updatedAt: new Date().toISOString(),
      });
      await dependencies.storage.saveState(updatedState);
      process.stdout.write(`${summarizeSandboxReview(review)}\n\n${JSON.stringify(review, null, 2)}\n`);
      return;
    }
    const applied = await applySandboxRegistryChange({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      proposedRegistry,
      actorSource: "sandbox:apply",
      commandSource: "cli",
      applySource: "apply",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastSandboxDiffSummary: applied.diffSummary,
      lastSandboxReviewStatus: applied.status === "ready" ? "ready" : applied.status,
      lastSandboxReviewSummary: applied.summary,
      lastSandboxApplyStatus:
        applied.status === "ready"
          ? "applied"
          : applied.status,
      lastSandboxApplySummary: applied.summary,
      lastRestorePointId: applied.restorePointId ?? existingState.lastRestorePointId,
      lastRestorePointSummary: applied.restorePointSummary ?? existingState.lastRestorePointSummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${summarizeSandboxReview(applied)}\n\n${JSON.stringify(applied, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:batch:preview" || command === "sandbox:batch:validate" || command === "sandbox:batch:apply") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const sandboxProfiles =
      (options.get("sandbox-profiles") ?? options.get("sandbox-profile") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const result = await runSandboxBatchChange({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      profileIds: sandboxProfiles,
      bundleId: options.get("sandbox-bundle") ?? null,
      changes: {
        repository: options.get("target-repo") ?? undefined,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : undefined,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : undefined,
        actionPolicy: options.has("action-policy")
          ? (options.get("action-policy") as "create_or_update" | "create_only" | "update_only")
          : undefined,
        enabled: options.has("enabled") ? getOption(options, "enabled", "true") === "true" : undefined,
        notes: options.has("notes") ? options.get("notes") ?? null : undefined,
      },
      mode:
        command === "sandbox:batch:preview"
          ? "preview"
          : command === "sandbox:batch:validate"
            ? "validate"
            : "apply",
      allowPartial: getOption(options, "allow-partial", "false") === "true",
      actorSource: command,
      commandSource: "cli",
    });
    const nextSandboxApplyStatus =
      command !== "sandbox:batch:apply"
        ? existingState.lastSandboxApplyStatus
        : result.status === "applied" || result.status === "partially_applied"
          ? "applied"
          : result.status === "blocked" || result.status === "manual_required"
            ? result.status
            : existingState.lastSandboxApplyStatus;
    const nextSandboxReviewStatus =
      command !== "sandbox:batch:validate"
        ? existingState.lastSandboxReviewStatus
        : result.status === "validated"
          ? "ready"
          : result.status === "blocked" || result.status === "manual_required"
            ? result.status
            : existingState.lastSandboxReviewStatus;
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      bundleGovernanceStatus: result.governanceStatus,
      bundleGovernanceReason:
        result.profileDecisions.find((item) => item.status !== "ready")?.failureReason ?? existingState.bundleGovernanceReason,
      lastSandboxDiffSummary: result.diffSummary,
      lastBatchChangeStatus: result.status,
      lastBatchImpactSummary: result.impactSummary.summaryText,
      lastBatchAffectedProfiles: result.affectedProfileIds,
      lastBatchBlockedProfiles: [...result.blockedProfileIds, ...result.manualRequiredProfileIds],
      lastRestorePointId: command === "sandbox:batch:apply" ? result.restorePointId ?? existingState.lastRestorePointId : existingState.lastRestorePointId,
      lastRestorePointSummary:
        command === "sandbox:batch:apply" ? result.restorePointSummary ?? existingState.lastRestorePointSummary : existingState.lastRestorePointSummary,
      lastSandboxApplyStatus: nextSandboxApplyStatus,
      lastSandboxApplySummary: command === "sandbox:batch:apply" ? result.summary : existingState.lastSandboxApplySummary,
      lastSandboxReviewStatus: nextSandboxReviewStatus,
      lastSandboxReviewSummary:
        command === "sandbox:batch:validate" ? result.summary : existingState.lastSandboxReviewSummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${summarizeSandboxBatchChange(result)}\n\n${formatSandboxImpactSummary(result.impactSummary)}\n\n${JSON.stringify(result, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:rollback:governance") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const restorePoints = await listSandboxRestorePoints({
      configPath,
      limit: 500,
    });
    const restorePoint =
      (options.get("restore-point-id")
        ? restorePoints.trail.records.find((record) => record.id === options.get("restore-point-id"))
        : restorePoints.records[0]) ?? null;
    const decision = await evaluateSandboxRollbackGovernance({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      restorePoint,
      actorSource: command,
      commandSource: "cli",
      maxAgeHours: options.has("max-age-hours") ? Number.parseInt(getOption(options, "max-age-hours", "0"), 10) : undefined,
    });
    const retention = await inspectSandboxRestorePointRetention({
      configPath,
      state: existingState,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastRestorePointId: decision.restorePointId ?? existingState.lastRestorePointId,
      currentRestorePointCount: retention.totalCount,
      currentValidRestorePointCount: retention.validCount,
      rollbackGovernanceStatus: decision.status,
      rollbackGovernanceReason: decision.reason?.code ?? null,
      rollbackGovernanceSuggestedNextAction: decision.suggestedNextAction,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxRollbackGovernanceSummary(decision)}\n\n${formatSandboxRestorePointList(restorePoints.records)}\n\n${JSON.stringify({ decision, retention }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:rollback:preview" || command === "sandbox:rollback:validate" || command === "sandbox:rollback:apply") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const result = await runSandboxRollback({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      restorePointId: options.get("restore-point-id") ?? null,
      mode:
        command === "sandbox:rollback:preview"
          ? "preview"
          : command === "sandbox:rollback:validate"
            ? "validate"
            : "apply",
      actorSource: command,
      commandSource: "cli",
    });
    const retention = await inspectSandboxRestorePointRetention({
      configPath,
      state: existingState,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastRestorePointId: result.restorePointId ?? existingState.lastRestorePointId,
      lastRestorePointSummary:
        result.restorePointId && result.status !== "no_op"
          ? `Rollback source restore point '${result.restorePointId}' selected for ${result.mode}.`
          : existingState.lastRestorePointSummary,
      lastRollbackStatus: result.status,
      lastRollbackImpactSummary: result.impactSummary.summaryText,
      lastRollbackAuditId: result.auditId,
      currentRestorePointCount: retention.totalCount,
      currentValidRestorePointCount: retention.validCount,
      rollbackGovernanceStatus:
        result.status === "blocked" || result.status === "manual_required"
          ? result.status
          : "ready",
      rollbackGovernanceReason:
        result.status === "blocked" || result.status === "manual_required"
          ? result.failureReason
          : existingState.rollbackGovernanceReason,
      rollbackGovernanceSuggestedNextAction: result.suggestedNextAction,
      lastSandboxDiffSummary: result.diffSummary,
      lastSandboxReviewStatus:
        result.mode === "validate" && result.status === "validated"
          ? "ready"
          : result.mode === "validate" && (result.status === "blocked" || result.status === "manual_required")
            ? result.status
            : existingState.lastSandboxReviewStatus,
      lastSandboxReviewSummary:
        result.mode === "validate" ? result.summary : existingState.lastSandboxReviewSummary,
      lastSandboxApplyStatus:
        result.mode === "apply" && result.status === "restored"
          ? "applied"
          : result.mode === "apply" && (result.status === "blocked" || result.status === "manual_required")
            ? result.status
            : existingState.lastSandboxApplyStatus,
      lastSandboxApplySummary:
        result.mode === "apply" ? result.summary : existingState.lastSandboxApplySummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${summarizeSandboxRollback(result)}\n\n${formatSandboxImpactSummary(result.impactSummary)}\n\n${JSON.stringify(result, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:batch-recovery:preview" || command === "sandbox:batch-recovery:validate" || command === "sandbox:batch-recovery:apply") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const restorePointIds = (options.get("restore-point-ids") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const sandboxProfiles = (options.get("sandbox-profiles") ?? options.get("sandbox-profile") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const result = await runSandboxBatchRecovery({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      restorePointIds,
      profileIds: sandboxProfiles,
      mode:
        command === "sandbox:batch-recovery:preview"
          ? "preview"
          : command === "sandbox:batch-recovery:validate"
            ? "validate"
            : "apply",
      allowPartial: getOption(options, "allow-partial", "false") === "true",
      actorSource: command,
      commandSource: "cli",
    });
    const retention = await inspectSandboxRestorePointRetention({
      configPath,
      state: existingState,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      currentRestorePointCount: retention.totalCount,
      currentValidRestorePointCount: retention.validCount,
      rollbackGovernanceStatus: result.governanceStatus,
      rollbackGovernanceReason:
        result.status === "blocked" || result.status === "manual_required" ? result.failureReason : existingState.rollbackGovernanceReason,
      rollbackGovernanceSuggestedNextAction: result.suggestedNextAction,
      lastBatchRecoveryStatus: result.status,
      lastBatchRecoverySummary: result.summary,
      lastRestorePointId:
        result.mode === "apply" ? result.restorePointId ?? existingState.lastRestorePointId : existingState.lastRestorePointId,
      lastRestorePointSummary:
        result.mode === "apply" ? result.restorePointSummary ?? existingState.lastRestorePointSummary : existingState.lastRestorePointSummary,
      lastRollbackStatus:
        result.mode === "apply"
          ? result.status
          : result.mode === "validate" && result.status === "validated"
            ? existingState.lastRollbackStatus
            : existingState.lastRollbackStatus,
      lastRollbackImpactSummary: result.impactSummary.summaryText,
      lastRollbackAuditId: result.auditId ?? existingState.lastRollbackAuditId,
      lastSandboxDiffSummary: result.diffSummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${summarizeSandboxBatchRecovery(result)}\n\n${formatSandboxImpactSummary(result.impactSummary)}\n\n${JSON.stringify(result, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:compare") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const result = await compareSandboxRestorePoints({
      configPath,
      loadedRegistry: sandboxRegistry,
      restorePointId: options.get("restore-point-id") ?? null,
      compareRestorePointId: options.get("compare-restore-point-id") ?? null,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastSandboxCompareSummary: result.summary,
      lastRestorePointCompareStatus: result.status,
      lastSandboxDiffSummary: result.diffSummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCompare(result)}\n\n${formatSandboxImpactSummary(result.impactSummary)}\n\n${JSON.stringify(result, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:incident:governance" || command === "sandbox:governance:status") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const result = await classifySandboxRecoveryIncidents({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      limit,
    });
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutReviewAudit: true,
      actorSource: command,
      commandSource: "cli",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxIncidentGovernance(result)}\n\n${formatSandboxGovernanceStatus(governance.governanceStatus)}\n\n${formatSandboxResolutionReadiness(governance.resolutionReadiness)}\n\n${JSON.stringify({ incidents: result, governance }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:incident:policy") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const incidents = await classifySandboxRecoveryIncidents({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      limit,
    });
    const selectedIncident =
      (options.get("incident-id")
        ? incidents.incidents.find((incident) => incident.id === options.get("incident-id"))
        : incidents.latestIncident) ?? null;
    const policy = resolveSandboxIncidentPolicy(selectedIncident);
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutReviewAudit: true,
      recordCloseoutSettlementAudit: true,
      actorSource: command,
      commandSource: "cli",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch({
        ...governance,
        incidentPolicy: policy,
      }),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${formatSandboxIncidentPolicy(policy)}\n\n${JSON.stringify(policy, null, 2)}\n`);
    return;
  }

  if (
    command === "sandbox:incident:acknowledge" ||
    command === "sandbox:incident:resolve" ||
    command === "sandbox:incident:escalate" ||
    command === "sandbox:incident:request-review" ||
    command === "sandbox:incident:rerun-preview" ||
    command === "sandbox:incident:rerun-validate" ||
    command === "sandbox:incident:rerun-apply"
  ) {
    const configPath = options.get("sandbox-config");
    const incidentId = options.get("incident-id") ?? null;
    if (!configPath || !incidentId) {
      throw new Error("--sandbox-config and --incident-id are required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const action =
      command === "sandbox:incident:acknowledge"
        ? "acknowledge"
        : command === "sandbox:incident:resolve"
          ? "mark_resolved"
          : command === "sandbox:incident:escalate"
            ? "escalate"
            : command === "sandbox:incident:request-review"
              ? "request_review"
              : command === "sandbox:incident:rerun-preview"
                ? "rerun_preview"
                : command === "sandbox:incident:rerun-validate"
                  ? "rerun_validate"
                  : "rerun_apply";
    const result = await runSandboxOperatorAction({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      incidentId,
      action,
      actorSource: command,
      commandSource: "cli",
    });
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      rollbackGovernanceStatus:
        result.rerunResult?.status === "blocked" || result.rerunResult?.status === "manual_required"
          ? result.rerunResult.status
          : existingState.rollbackGovernanceStatus,
      rollbackGovernanceReason:
        result.rerunResult?.status === "blocked" || result.rerunResult?.status === "manual_required"
          ? result.rerunResult.failureReason
          : existingState.rollbackGovernanceReason,
      rollbackGovernanceSuggestedNextAction:
        result.rerunResult?.suggestedNextAction ?? existingState.rollbackGovernanceSuggestedNextAction,
      lastRollbackStatus: result.rerunResult?.status ?? existingState.lastRollbackStatus,
      lastRollbackImpactSummary: result.rerunResult?.impactSummary.summaryText ?? existingState.lastRollbackImpactSummary,
      lastRollbackAuditId: result.rerunResult?.auditId ?? existingState.lastRollbackAuditId,
      lastSandboxDiffSummary: result.rerunResult?.diffSummary ?? existingState.lastSandboxDiffSummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxOperatorActionResult(result)}\n\n${formatSandboxGovernanceStatus(governance.governanceStatus)}\n\n${formatSandboxOperatorHandoffSummary(governance.handoffSummary)}\n\n${JSON.stringify({ result, governance }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:escalation:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const result = await buildSandboxEscalationSummary({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      limit: options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10,
    });
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit: options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxEscalationSummary(result)}\n\n${formatSandboxGovernanceStatus(governance.governanceStatus)}\n\n${JSON.stringify({ escalation: result, governance }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:operator:handoff") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutSettlementAudit: true,
      recordCloseoutCompletionAudit: true,
      actorSource: command,
      commandSource: "cli",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxOperatorHandoffSummary(governance.handoffSummary)}\n\n${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutFollowupSummary(governance.closeoutFollowupSummary)}\n\n${formatSandboxCloseoutReviewSummary(governance.closeoutReviewSummary)}\n\n${formatSandboxCloseoutSummary(governance.closeoutSummary)}\n\n${formatSandboxGovernanceStatus(governance.governanceStatus)}\n\n${JSON.stringify(governance.handoffSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:resolution:readiness") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutAudit: true,
      actorSource: "cli",
      commandSource: command,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxResolutionReadiness(governance.resolutionReadiness)}\n\n${formatSandboxCloseoutSummary(governance.closeoutSummary)}\n\n${formatSandboxClosureGatingDecision(governance.closureGatingDecision)}\n\n${JSON.stringify(governance.resolutionReadiness, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:resolution:evidence") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutSettlementAudit: true,
      recordCloseoutCompletionAudit: true,
      actorSource: command,
      commandSource: "cli",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxResolutionEvidenceSummary(governance.resolutionEvidenceSummary)}\n\n${formatSandboxCloseoutSummary(governance.closeoutSummary)}\n\n${formatSandboxOperatorHandoffSummary(governance.handoffSummary)}\n\n${JSON.stringify(governance.resolutionEvidenceSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:incident:closure-check") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutAudit: true,
      actorSource: "cli",
      commandSource: command,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxClosureGatingDecision(governance.closureGatingDecision)}\n\n${formatSandboxCloseoutOperatorChecklist(governance.closeoutChecklist)}\n\n${formatSandboxResolutionReadiness(governance.resolutionReadiness)}\n\n${JSON.stringify(governance.closureGatingDecision, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:resolution:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const result = await listSandboxResolutionAuditLogs({
      configPath,
      limit,
    });
    process.stdout.write(
      `${formatSandboxResolutionAuditLogs({ records: result.records })}\n\n${JSON.stringify(result, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutAudit: true,
      actorSource: "cli",
      commandSource: command,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutSummary(governance.closeoutSummary)}\n\n${formatSandboxCloseoutReviewSummary(governance.closeoutReviewSummary)}\n\n${formatSandboxResolutionAuditLogs({ records: governance.resolutionAuditLog ? [governance.resolutionAuditLog] : [] })}\n\n${JSON.stringify(governance.closeoutSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:checklist") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutAudit: true,
      actorSource: "cli",
      commandSource: command,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutOperatorChecklist(governance.closeoutChecklist)}\n\n${formatSandboxCloseoutReviewQueue(governance.closeoutReviewQueue)}\n\n${formatSandboxCloseoutSummary(governance.closeoutSummary)}\n\n${JSON.stringify(governance.closeoutChecklist, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:resolution:audit:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutCompletionDecisionAudit: true,
      actorSource: "cli",
      commandSource: command,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxResolutionAuditHistory(governance.resolutionAuditHistory)}\n\n${JSON.stringify(governance.resolutionAuditHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:review:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutReviewSummary(governance.closeoutReviewSummary)}\n\n${formatSandboxCloseoutSummary(governance.closeoutSummary)}\n\n${JSON.stringify(governance.closeoutReviewSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:review:queue") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutReviewQueue(governance.closeoutReviewQueue)}\n\n${formatSandboxCloseoutReviewSummary(governance.closeoutReviewSummary)}\n\n${JSON.stringify(governance.closeoutReviewQueue, null, 2)}\n`,
    );
    return;
  }

  if (
    command === "sandbox:closeout:review:approve" ||
    command === "sandbox:closeout:review:reject" ||
    command === "sandbox:closeout:review:followup" ||
    command === "sandbox:closeout:review:defer" ||
    command === "sandbox:closeout:review:reopen"
  ) {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const action =
      command === "sandbox:closeout:review:approve"
        ? "approve_closeout"
        : command === "sandbox:closeout:review:reject"
          ? "reject_closeout"
          : command === "sandbox:closeout:review:followup"
            ? "request_followup"
            : command === "sandbox:closeout:review:defer"
              ? "defer_review"
              : "reopen_review";
    const result = await runSandboxCloseoutReviewAction({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      action,
      actorSource: command,
      commandSource: "cli",
      reason: options.get("reason") ?? null,
      note: options.get("note") ?? null,
      auditId: options.get("audit-id") ?? null,
      limit,
    });
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutReviewActionResult(result)}\n\n${formatSandboxCloseoutDispositionSummary(governance.closeoutDispositionSummary)}\n\n${formatSandboxCloseoutReviewLifecycle(governance.closeoutReviewLifecycle)}\n\n${formatSandboxCloseoutReviewAuditTrail({ records: governance.closeoutReviewAuditTrail ? [governance.closeoutReviewAuditTrail] : [] })}\n\n${formatSandboxCloseoutReviewResolutionSummary(governance.closeoutReviewResolutionSummary)}\n\n${formatSandboxCloseoutSettlementAudits({ records: governance.closeoutSettlementAudit ? [governance.closeoutSettlementAudit] : [] })}\n\n${formatSandboxCloseoutCompletionAudits({ records: governance.closeoutCompletionAudit ? [governance.closeoutCompletionAudit] : [] })}\n\n${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutCompletionQueue(governance.closeoutCompletionQueue)}\n\n${formatSandboxCloseoutFollowupSummary(governance.closeoutFollowupSummary)}\n\n${formatSandboxCloseoutFollowupQueue(governance.closeoutFollowupQueue)}\n\n${formatSandboxCloseoutReviewQueue(governance.closeoutReviewQueue)}\n\n${JSON.stringify({ result, governance }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:disposition:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutDispositionSummary(governance.closeoutDispositionSummary)}\n\n${formatSandboxCloseoutReviewSummary(governance.closeoutReviewSummary)}\n\n${JSON.stringify(governance.closeoutDispositionSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:review:lifecycle") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutReviewLifecycle(governance.closeoutReviewLifecycle)}\n\n${formatSandboxCloseoutDispositionSummary(governance.closeoutDispositionSummary)}\n\n${formatSandboxCloseoutReviewQueue(governance.closeoutReviewQueue)}\n\n${JSON.stringify(governance.closeoutReviewLifecycle, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:review:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const auditTrail = await listSandboxCloseoutReviewAuditTrail({
      configPath,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutReviewAuditTrail({ records: auditTrail.records })}\n\n${formatSandboxCloseoutDispositionSummary(governance.closeoutDispositionSummary)}\n\n${JSON.stringify({ latest: governance.closeoutReviewAuditTrail, records: auditTrail.records }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:review:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutReviewHistory(governance.closeoutReviewHistory)}\n\n${formatSandboxCloseoutReviewQueue(governance.closeoutReviewQueue)}\n\n${JSON.stringify(governance.closeoutReviewHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:review:resolution") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutReviewResolutionSummary(governance.closeoutReviewResolutionSummary)}\n\n${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutFollowupSummary(governance.closeoutFollowupSummary)}\n\n${formatSandboxCloseoutReviewLifecycle(governance.closeoutReviewLifecycle)}\n\n${formatSandboxCloseoutDispositionSummary(governance.closeoutDispositionSummary)}\n\n${JSON.stringify(governance.closeoutReviewResolutionSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:settlement:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutSettlementAudit: true,
      recordCloseoutCompletionAudit: true,
      actorSource: "cli",
      commandSource: command,
    });
    const auditTrail = await listSandboxCloseoutSettlementAudits({
      configPath,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutSettlementAudits({ records: auditTrail.records })}\n\n${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutFollowupSummary(governance.closeoutFollowupSummary)}\n\n${formatSandboxCloseoutReviewResolutionSummary(governance.closeoutReviewResolutionSummary)}\n\n${JSON.stringify({ latest: governance.closeoutSettlementAudit, records: auditTrail.records }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:followup:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutFollowupSummary(governance.closeoutFollowupSummary)}\n\n${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutReviewResolutionSummary(governance.closeoutReviewResolutionSummary)}\n\n${formatSandboxCloseoutReviewQueue(governance.closeoutReviewQueue)}\n\n${JSON.stringify(governance.closeoutFollowupSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:followup:queue") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutFollowupQueue(governance.closeoutFollowupQueue)}\n\n${formatSandboxCloseoutCompletionQueue(governance.closeoutCompletionQueue)}\n\n${formatSandboxCloseoutFollowupSummary(governance.closeoutFollowupSummary)}\n\n${JSON.stringify(governance.closeoutFollowupQueue, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
      recordCloseoutSettlementAudit: true,
      recordCloseoutCompletionAudit: true,
      actorSource: "cli",
      commandSource: command,
    });
    const auditTrail = await listSandboxCloseoutCompletionAudits({
      configPath,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionAudits({ records: auditTrail.records })}\n\n${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutFollowupSummary(governance.closeoutFollowupSummary)}\n\n${JSON.stringify({ latest: governance.closeoutCompletionAudit, records: auditTrail.records }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutFollowupSummary(governance.closeoutFollowupSummary)}\n\n${formatSandboxCloseoutReviewResolutionSummary(governance.closeoutReviewResolutionSummary)}\n\n${JSON.stringify(governance.closeoutCompletionSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:queue") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionQueue(governance.closeoutCompletionQueue)}\n\n${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutFollowupQueue(governance.closeoutFollowupQueue)}\n\n${JSON.stringify(governance.closeoutCompletionQueue, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionHistory(governance.closeoutCompletionHistory)}\n\n${formatSandboxCloseoutCompletionResolutionSummary(governance.closeoutCompletionResolutionSummary)}\n\n${formatSandboxCloseoutCompletionCarryForwardQueue(governance.closeoutCompletionCarryForwardQueue)}\n\n${JSON.stringify(governance.closeoutCompletionHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:resolution") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionResolutionSummary(governance.closeoutCompletionResolutionSummary)}\n\n${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutCompletionHistory(governance.closeoutCompletionHistory)}\n\n${JSON.stringify(governance.closeoutCompletionResolutionSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:carry-forward") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionCarryForwardQueue(governance.closeoutCompletionCarryForwardQueue)}\n\n${formatSandboxCloseoutCompletionResolutionSummary(governance.closeoutCompletionResolutionSummary)}\n\n${formatSandboxCloseoutCompletionQueue(governance.closeoutCompletionQueue)}\n\n${JSON.stringify(governance.closeoutCompletionCarryForwardQueue, null, 2)}\n`,
    );
    return;
  }

  if (
    command === "sandbox:closeout:completion:confirm-review" ||
    command === "sandbox:closeout:completion:confirm-closeout" ||
    command === "sandbox:closeout:completion:keep-carry-forward" ||
    command === "sandbox:closeout:completion:reopen"
  ) {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const action =
      command === "sandbox:closeout:completion:confirm-review"
        ? "confirm_review_complete"
        : command === "sandbox:closeout:completion:confirm-closeout"
          ? "confirm_closeout_complete"
          : command === "sandbox:closeout:completion:keep-carry-forward"
            ? "keep_carry_forward"
            : "reopen_completion";
    const result = await runSandboxCloseoutCompletionAction({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      action,
      actorSource: "cli",
      commandSource: command,
      reason: options.get("reason") ?? null,
      note: options.get("note") ?? null,
      completionAuditId: options.get("completion-audit-id") ?? null,
      limit,
    });
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch({
        ...governance,
        closeoutCompletionAction: result.completionAction,
      }),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionActionResult(result)}\n\n${formatSandboxCloseoutCompletionDispositionSummary(governance.closeoutCompletionDispositionSummary)}\n\n${formatSandboxCloseoutCompletionLifecycle(governance.closeoutCompletionLifecycle)}\n\n${formatSandboxCloseoutCompletionFinalizationSummary(governance.closeoutCompletionFinalizationSummary)}\n\n${JSON.stringify(result, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:disposition:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionDispositionSummary(governance.closeoutCompletionDispositionSummary)}\n\n${formatSandboxCloseoutCompletionResolutionSummary(governance.closeoutCompletionResolutionSummary)}\n\n${formatSandboxCloseoutCompletionCarryForwardQueue(governance.closeoutCompletionCarryForwardQueue)}\n\n${JSON.stringify(governance.closeoutCompletionDispositionSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:lifecycle") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionLifecycle(governance.closeoutCompletionLifecycle)}\n\n${formatSandboxCloseoutCompletionDispositionSummary(governance.closeoutCompletionDispositionSummary)}\n\n${formatSandboxCloseoutCompletionCarryForwardQueue(governance.closeoutCompletionCarryForwardQueue)}\n\n${JSON.stringify(governance.closeoutCompletionLifecycle, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:decision:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionDecisionAudit({ records: governance.closeoutCompletionDecisionAudit ? [governance.closeoutCompletionDecisionAudit] : [] })}\n\n${formatSandboxCloseoutCompletionFinalizationSummary(governance.closeoutCompletionFinalizationSummary)}\n\n${JSON.stringify(governance.closeoutCompletionDecisionAudit, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:decision:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionDecisionHistory(governance.closeoutCompletionDecisionHistory)}\n\n${formatSandboxCloseoutCompletionFinalizationSummary(governance.closeoutCompletionFinalizationSummary)}\n\n${JSON.stringify(governance.closeoutCompletionDecisionHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:completion:finalization:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutCompletionFinalizationSummary(governance.closeoutCompletionFinalizationSummary)}\n\n${formatSandboxCloseoutCompletionDecisionHistory(governance.closeoutCompletionDecisionHistory)}\n\n${formatSandboxCloseoutCompletionCarryForwardQueue(governance.closeoutCompletionCarryForwardQueue)}\n\n${JSON.stringify(governance.closeoutCompletionFinalizationSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:finalization:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutFinalizationAuditHistory(governance.closeoutFinalizationAuditHistory)}\n\n${formatSandboxCloseoutFinalizationStabilitySummary(governance.closeoutFinalizationStabilitySummary)}\n\n${JSON.stringify(governance.closeoutFinalizationAuditHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:finalization:stability") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutFinalizationStabilitySummary(governance.closeoutFinalizationStabilitySummary)}\n\n${formatSandboxCloseoutFinalizationAuditHistory(governance.closeoutFinalizationAuditHistory)}\n\n${formatSandboxCloseoutPostFinalizationFollowupQueue(governance.closeoutPostFinalizationFollowupQueue)}\n\n${JSON.stringify(governance.closeoutFinalizationStabilitySummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:post-finalization:followup:queue") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutPostFinalizationFollowupQueue(governance.closeoutPostFinalizationFollowupQueue)}\n\n${formatSandboxCloseoutFinalizationStabilitySummary(governance.closeoutFinalizationStabilitySummary)}\n\n${formatSandboxCloseoutFinalizationAuditHistory(governance.closeoutFinalizationAuditHistory)}\n\n${JSON.stringify(governance.closeoutPostFinalizationFollowupQueue, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:stability:drift") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutStabilityDrift(governance.closeoutStabilityDrift)}\n\n${formatSandboxCloseoutFinalizationStabilitySummary(governance.closeoutFinalizationStabilitySummary)}\n\n${formatSandboxCloseoutPostFinalizationFollowupQueue(governance.closeoutPostFinalizationFollowupQueue)}\n\n${JSON.stringify(governance.closeoutStabilityDrift, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:reopen:recurrence") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutReopenRecurrence(governance.closeoutReopenRecurrence)}\n\n${formatSandboxCloseoutFinalizationAuditHistory(governance.closeoutFinalizationAuditHistory)}\n\n${formatSandboxCloseoutFinalizationStabilitySummary(governance.closeoutFinalizationStabilitySummary)}\n\n${JSON.stringify(governance.closeoutReopenRecurrence, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:stability:watchlist") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutStabilityWatchlist(governance.closeoutStabilityWatchlist)}\n\n${formatSandboxCloseoutStabilityDrift(governance.closeoutStabilityDrift)}\n\n${formatSandboxCloseoutReopenRecurrence(governance.closeoutReopenRecurrence)}\n\n${JSON.stringify(governance.closeoutStabilityWatchlist, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:stability:recurrence:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutStabilityRecurrenceAudit(governance.closeoutStabilityRecurrenceAudit)}\n\n${formatSandboxCloseoutStabilityDrift(governance.closeoutStabilityDrift)}\n\n${formatSandboxCloseoutReopenRecurrence(governance.closeoutReopenRecurrence)}\n\n${formatSandboxCloseoutStabilityWatchlist(governance.closeoutStabilityWatchlist)}\n\n${JSON.stringify(governance.closeoutStabilityRecurrenceAudit, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:watchlist:resolution") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutWatchlistResolutionSummary(governance.closeoutWatchlistResolutionSummary)}\n\n${formatSandboxCloseoutStabilityWatchlist(governance.closeoutStabilityWatchlist)}\n\n${formatSandboxCloseoutFinalizationStabilitySummary(governance.closeoutFinalizationStabilitySummary)}\n\n${formatSandboxCloseoutPostFinalizationFollowupQueue(governance.closeoutPostFinalizationFollowupQueue)}\n\n${JSON.stringify(governance.closeoutWatchlistResolutionSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:watchlist:lifecycle") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutWatchlistLifecycle(governance.closeoutWatchlistLifecycle)}\n\n${formatSandboxCloseoutWatchlistResolutionSummary(governance.closeoutWatchlistResolutionSummary)}\n\n${formatSandboxCloseoutStabilityWatchlist(governance.closeoutStabilityWatchlist)}\n\n${JSON.stringify(governance.closeoutWatchlistLifecycle, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:watchlist:exit:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutWatchlistExitAudit(governance.closeoutWatchlistExitAudit)}\n\n${formatSandboxCloseoutWatchlistResolutionSummary(governance.closeoutWatchlistResolutionSummary)}\n\n${formatSandboxCloseoutWatchlistLifecycle(governance.closeoutWatchlistLifecycle)}\n\n${JSON.stringify(governance.closeoutWatchlistExitAudit, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:watchlist:readd:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutWatchlistReAddHistory(governance.closeoutWatchlistReAddHistory)}\n\n${formatSandboxCloseoutWatchlistExitAudit(governance.closeoutWatchlistExitAudit)}\n\n${formatSandboxCloseoutWatchlistLifecycle(governance.closeoutWatchlistLifecycle)}\n\n${JSON.stringify(governance.closeoutWatchlistReAddHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:stability:recovery:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutStabilityRecoverySummary(governance.closeoutStabilityRecoverySummary)}\n\n${formatSandboxCloseoutWatchlistExitAudit(governance.closeoutWatchlistExitAudit)}\n\n${formatSandboxCloseoutWatchlistReAddHistory(governance.closeoutWatchlistReAddHistory)}\n\n${JSON.stringify(governance.closeoutStabilityRecoverySummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovery:confidence") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveryConfidence(governance.closeoutRecoveryConfidence)}\n\n${formatSandboxCloseoutStabilityRecoverySummary(governance.closeoutStabilityRecoverySummary)}\n\n${formatSandboxCloseoutWatchlistExitAudit(governance.closeoutWatchlistExitAudit)}\n\n${JSON.stringify(governance.closeoutRecoveryConfidence, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovery:regression:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveryRegressionAudit(governance.closeoutRecoveryRegressionAudit)}\n\n${formatSandboxCloseoutRecoveryConfidence(governance.closeoutRecoveryConfidence)}\n\n${formatSandboxCloseoutWatchlistReAddHistory(governance.closeoutWatchlistReAddHistory)}\n\n${JSON.stringify(governance.closeoutRecoveryRegressionAudit, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovered:monitoring:queue") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveredMonitoringQueue(governance.closeoutRecoveredMonitoringQueue)}\n\n${formatSandboxCloseoutRecoveryConfidence(governance.closeoutRecoveryConfidence)}\n\n${formatSandboxCloseoutRecoveryRegressionAudit(governance.closeoutRecoveryRegressionAudit)}\n\n${JSON.stringify(governance.closeoutRecoveredMonitoringQueue, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovery:confidence:trend") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveryConfidenceTrend(governance.closeoutRecoveryConfidenceTrend)}\n\n${formatSandboxCloseoutRecoveryConfidence(governance.closeoutRecoveryConfidence)}\n\n${formatSandboxCloseoutRecoveredMonitoringQueue(governance.closeoutRecoveredMonitoringQueue)}\n\n${JSON.stringify(governance.closeoutRecoveryConfidenceTrend, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:regression:resolution") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRegressionResolutionSummary(governance.closeoutRegressionResolutionSummary)}\n\n${formatSandboxCloseoutRecoveryRegressionAudit(governance.closeoutRecoveryRegressionAudit)}\n\n${formatSandboxCloseoutRecoveredMonitoringQueue(governance.closeoutRecoveredMonitoringQueue)}\n\n${JSON.stringify(governance.closeoutRegressionResolutionSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovered:monitoring:exit:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveredMonitoringExitAudit(governance.closeoutRecoveredMonitoringExitAudit)}\n\n${formatSandboxCloseoutRegressionResolutionSummary(governance.closeoutRegressionResolutionSummary)}\n\n${formatSandboxCloseoutRecoveryConfidenceTrend(governance.closeoutRecoveryConfidenceTrend)}\n\n${JSON.stringify(governance.closeoutRecoveredMonitoringExitAudit, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovery:clearance:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveryClearanceAudit(governance.closeoutRecoveryClearanceAudit)}\n\n${formatSandboxCloseoutRecoveredMonitoringExitAudit(governance.closeoutRecoveredMonitoringExitAudit)}\n\n${formatSandboxCloseoutRegressionResolutionSummary(governance.closeoutRegressionResolutionSummary)}\n\n${JSON.stringify(governance.closeoutRecoveryClearanceAudit, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovered:exit:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveredExitHistory(governance.closeoutRecoveredExitHistory)}\n\n${formatSandboxCloseoutRecoveryClearanceAudit(governance.closeoutRecoveryClearanceAudit)}\n\n${formatSandboxCloseoutRegressionResolutionSummary(governance.closeoutRegressionResolutionSummary)}\n\n${JSON.stringify(governance.closeoutRecoveredExitHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovered:lifecycle") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveredLifecycle(governance.closeoutRecoveredLifecycle)}\n\n${formatSandboxCloseoutRecoveredExitHistory(governance.closeoutRecoveredExitHistory)}\n\n${formatSandboxCloseoutRecoveryClearanceAudit(governance.closeoutRecoveryClearanceAudit)}\n\n${JSON.stringify(governance.closeoutRecoveredLifecycle, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovery:clearance:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveryClearanceHistory(governance.closeoutRecoveryClearanceHistory)}\n\n${formatSandboxCloseoutRecoveryClearanceAudit(governance.closeoutRecoveryClearanceAudit)}\n\n${formatSandboxCloseoutRecoveredExitHistory(governance.closeoutRecoveredExitHistory)}\n\n${JSON.stringify(governance.closeoutRecoveryClearanceHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovered:reentry:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveredReentryAudit(governance.closeoutRecoveredReentryAudit)}\n\n${formatSandboxCloseoutRecoveredExitHistory(governance.closeoutRecoveredExitHistory)}\n\n${formatSandboxCloseoutRecoveryClearanceHistory(governance.closeoutRecoveryClearanceHistory)}\n\n${JSON.stringify(governance.closeoutRecoveredReentryAudit, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovered:lifecycle:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveredLifecycleHistory(governance.closeoutRecoveredLifecycleHistory)}\n\n${formatSandboxCloseoutRecoveredLifecycle(governance.closeoutRecoveredLifecycle)}\n\n${formatSandboxCloseoutRecoveredReentryAudit(governance.closeoutRecoveredReentryAudit)}\n\n${JSON.stringify(governance.closeoutRecoveredLifecycleHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovery:retirement:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveryRetirementAudit(governance.closeoutRecoveryRetirementAudit)}\n\n${formatSandboxCloseoutRecoveredRetirementSummary(governance.closeoutRecoveredRetirementSummary)}\n\n${formatSandboxCloseoutRecoveredLifecycle(governance.closeoutRecoveredLifecycle)}\n\n${JSON.stringify(governance.closeoutRecoveryRetirementAudit, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovered:retirement:summary") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveredRetirementSummary(governance.closeoutRecoveredRetirementSummary)}\n\n${formatSandboxCloseoutRecoveryRetirementAudit(governance.closeoutRecoveryRetirementAudit)}\n\n${formatSandboxCloseoutRecoveryRetirementQueue(governance.closeoutRecoveryRetirementQueue)}\n\n${JSON.stringify(governance.closeoutRecoveredRetirementSummary, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovery:retirement:queue") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveryRetirementQueue(governance.closeoutRecoveryRetirementQueue)}\n\n${formatSandboxCloseoutRecoveredRetirementSummary(governance.closeoutRecoveredRetirementSummary)}\n\n${formatSandboxCloseoutRecoveryRetirementAudit(governance.closeoutRecoveryRetirementAudit)}\n\n${JSON.stringify(governance.closeoutRecoveryRetirementQueue, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:recovery:retirement:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRecoveryRetirementHistory(governance.closeoutRecoveryRetirementHistory)}\n\n${formatSandboxCloseoutRetirementExitCriteria(governance.closeoutRetirementExitCriteria)}\n\n${formatSandboxCloseoutRecoveryRetirementQueue(governance.closeoutRecoveryRetirementQueue)}\n\n${JSON.stringify(governance.closeoutRecoveryRetirementHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:retirement:exit:criteria") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRetirementExitCriteria(governance.closeoutRetirementExitCriteria)}\n\n${formatSandboxCloseoutRecoveredRetirementSummary(governance.closeoutRecoveredRetirementSummary)}\n\n${formatSandboxCloseoutRecoveryRetirementAudit(governance.closeoutRecoveryRetirementAudit)}\n\n${JSON.stringify(governance.closeoutRetirementExitCriteria, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:closeout:retired-case:audit:history") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const limit = options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10;
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxCloseoutRetiredCaseAuditHistory(governance.closeoutRetiredCaseAuditHistory)}\n\n${formatSandboxCloseoutRecoveryRetirementHistory(governance.closeoutRecoveryRetirementHistory)}\n\n${formatSandboxCloseoutRecoveredLifecycle(governance.closeoutRecoveredLifecycle)}\n\n${JSON.stringify(governance.closeoutRetiredCaseAuditHistory, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:recovery:diagnostics") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const result = await buildSandboxRecoveryDiagnostics({
      configPath,
      state: existingState,
      limit: options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10,
    });
    const governance = await resolveSandboxGovernanceArtifacts({
      configPath,
      state: existingState,
      sandboxRegistry,
      limit: options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10,
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      ...buildSandboxGovernanceStatePatch(governance),
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${formatSandboxRecoveryDiagnostics(result)}\n\n${formatSandboxGovernanceStatus(governance.governanceStatus)}\n\n${formatSandboxResolutionAuditHistory(governance.resolutionAuditHistory)}\n\n${formatSandboxResolutionEvidenceSummary(governance.resolutionEvidenceSummary)}\n\n${formatSandboxResolutionReadiness(governance.resolutionReadiness)}\n\n${formatSandboxClosureGatingDecision(governance.closureGatingDecision)}\n\n${formatSandboxCloseoutSummary(governance.closeoutSummary)}\n\n${formatSandboxCloseoutReviewSummary(governance.closeoutReviewSummary)}\n\n${formatSandboxCloseoutCompletionAudits({ records: governance.closeoutCompletionAudit ? [governance.closeoutCompletionAudit] : [] })}\n\n${formatSandboxCloseoutCompletionSummary(governance.closeoutCompletionSummary)}\n\n${formatSandboxCloseoutCompletionQueue(governance.closeoutCompletionQueue)}\n\n${formatSandboxCloseoutCompletionHistory(governance.closeoutCompletionHistory)}\n\n${formatSandboxCloseoutCompletionResolutionSummary(governance.closeoutCompletionResolutionSummary)}\n\n${formatSandboxCloseoutCompletionCarryForwardQueue(governance.closeoutCompletionCarryForwardQueue)}\n\n${formatSandboxCloseoutCompletionDispositionSummary(governance.closeoutCompletionDispositionSummary)}\n\n${formatSandboxCloseoutCompletionLifecycle(governance.closeoutCompletionLifecycle)}\n\n${formatSandboxCloseoutCompletionDecisionAudit({ records: governance.closeoutCompletionDecisionAudit ? [governance.closeoutCompletionDecisionAudit] : [] })}\n\n${formatSandboxCloseoutCompletionDecisionHistory(governance.closeoutCompletionDecisionHistory)}\n\n${formatSandboxCloseoutCompletionFinalizationSummary(governance.closeoutCompletionFinalizationSummary)}\n\n${formatSandboxCloseoutFinalizationAuditHistory(governance.closeoutFinalizationAuditHistory)}\n\n${formatSandboxCloseoutFinalizationStabilitySummary(governance.closeoutFinalizationStabilitySummary)}\n\n${formatSandboxCloseoutPostFinalizationFollowupQueue(governance.closeoutPostFinalizationFollowupQueue)}\n\n${formatSandboxCloseoutStabilityDrift(governance.closeoutStabilityDrift)}\n\n${formatSandboxCloseoutReopenRecurrence(governance.closeoutReopenRecurrence)}\n\n${formatSandboxCloseoutStabilityWatchlist(governance.closeoutStabilityWatchlist)}\n\n${formatSandboxCloseoutStabilityRecurrenceAudit(governance.closeoutStabilityRecurrenceAudit)}\n\n${formatSandboxCloseoutWatchlistResolutionSummary(governance.closeoutWatchlistResolutionSummary)}\n\n${formatSandboxCloseoutWatchlistLifecycle(governance.closeoutWatchlistLifecycle)}\n\n${formatSandboxCloseoutWatchlistExitAudit(governance.closeoutWatchlistExitAudit)}\n\n${formatSandboxCloseoutWatchlistReAddHistory(governance.closeoutWatchlistReAddHistory)}\n\n${formatSandboxCloseoutStabilityRecoverySummary(governance.closeoutStabilityRecoverySummary)}\n\n${formatSandboxCloseoutFollowupSummary(governance.closeoutFollowupSummary)}\n\n${formatSandboxCloseoutFollowupQueue(governance.closeoutFollowupQueue)}\n\n${formatSandboxCloseoutReviewQueue(governance.closeoutReviewQueue)}\n\n${formatSandboxCloseoutOperatorChecklist(governance.closeoutChecklist)}\n\n${formatSandboxIncidentPolicy(governance.incidentPolicy)}\n\n${formatSandboxOperatorHandoffSummary(governance.handoffSummary)}\n\n${JSON.stringify({ result, governance }, null, 2)}\n`,
    );
    return;
  }

  if (command === "reporting:auth-smoke") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runGitHubLiveAuthSmoke({
      state: existingState,
      outputRoot,
      adapter,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      sandboxRegistry,
      sandboxProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(
      [
        `GitHub auth smoke: ${result.result.status} / ${result.result.permissionResult}`,
        `Mode: ${result.result.mode}`,
        `Action: ${result.result.attemptedAction}`,
        `Target: ${result.result.target.targetType ?? "none"} ${result.result.target.repository ?? "none"}#${result.result.target.targetNumber ?? "none"}`,
        `Sandbox profile: ${result.state.sandboxTargetProfileId ?? "none"} / config=${result.state.sandboxTargetConfigVersion ?? "none"}`,
        `Summary: ${result.result.summary}`,
        `Next action: ${result.result.suggestedNextAction}`,
        `Evidence: ${result.evidencePath}`,
        "",
        JSON.stringify(result, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "reporting:precheck") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runLiveAuthOperatorFlow({
      state: existingState,
      outputRoot,
      adapter,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      sandboxRegistry,
      sandboxProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
      execute: false,
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(`${result.summaryText}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "reporting:run-live-smoke") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runLiveAuthOperatorFlow({
      state: existingState,
      outputRoot,
      adapter,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      sandboxRegistry,
      sandboxProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
      execute: true,
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(`${result.summaryText}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "reporting:live-success-smoke") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runGitHubLiveAuthSmoke({
      state: existingState,
      outputRoot,
      adapter,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      sandboxRegistry,
      sandboxProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(
      [
        `GitHub live success smoke: ${result.result.status} / ${result.result.permissionResult}`,
        `Action: ${result.result.attemptedAction}`,
        `Provider: ${result.result.providerUsed}`,
        `Sandbox profile: ${result.state.sandboxProfileId ?? result.state.sandboxTargetProfileId ?? "none"} / status=${result.state.sandboxProfileStatus} / config=${result.state.sandboxTargetConfigVersion ?? "none"}`,
        `Target: ${result.result.target.targetType ?? "none"} ${result.result.target.repository ?? "none"}#${result.result.target.targetNumber ?? "none"}`,
        `Last success at: ${result.state.lastAuthSmokeSuccessAt ?? "none"}`,
        `Summary: ${result.result.summary}`,
        `Next action: ${result.result.suggestedNextAction}`,
        `Evidence: ${result.evidencePath}`,
        "",
        JSON.stringify(result, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "reporting:status") {
    const summary = await inspectGitHubReportingOperatorSummary({
      state: existingState,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    process.stdout.write(`${summary.summaryText}\n\n${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (command === "reporting:audit") {
    process.stdout.write(`${formatReportDeliveryAttempts(existingState.reportDeliveryAttempts)}\n\n${JSON.stringify(existingState.reportDeliveryAttempts, null, 2)}\n`);
    return;
  }

  if (command === "status" || command === "inspect" || command === "diagnostics") {
    const diagnostics = buildDiagnosticsSummary(existingState);
    process.stdout.write(`${formatDiagnosticsSummary(diagnostics)}\n`);
    return;
  }

  if (command === "queue:enqueue") {
    const result = await enqueueStateRun({
      backend: dependencies.backend,
      state: existingState,
      priority: Number.parseInt(getOption(options, "priority", "0"), 10),
      scheduledAt: options.get("scheduled-at"),
      requestedBy: options.get("requested-by") ?? "operator",
    });
    const updatedState = orchestratorStateSchema.parse(
      applyQueueItemToState(existingState, result.item, new Date()),
    );
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${formatRunSummary(result.item)}\n${result.deduped ? "\nDeduped existing queued/running item.\n" : ""}`);
    return;
  }

  if (command === "queue:list") {
    const queue = await listQueueRuns(dependencies.backend);
    process.stdout.write(`${formatQueueSummary(queue)}\n`);
    return;
  }

  if (command === "worker:once") {
    const summary = await runQueueWorker({
      workerId: getOption(options, "worker-id", "worker-once"),
      dependencies,
      continuous: false,
      leaseMs: Number.parseInt(getOption(options, "lease-ms", "60000"), 10),
    });
    process.stdout.write(`${formatWorkerSummary(summary)}\n`);
    return;
  }

  if (command === "worker:run") {
    const summary = await runQueueWorker({
      workerId: getOption(options, "worker-id", "worker-loop"),
      dependencies,
      continuous: true,
      daemon: true,
      pollIntervalMs: Number.parseInt(getOption(options, "poll-ms", "1000"), 10),
      maxPolls: Number.parseInt(getOption(options, "max-polls", "10"), 10),
      maxIdleCycles: Number.parseInt(getOption(options, "max-idle-cycles", "3"), 10),
      leaseMs: Number.parseInt(getOption(options, "lease-ms", "60000"), 10),
    });
    process.stdout.write(`${formatWorkerSummary(summary)}\n`);
    return;
  }

  if (command === "worker:status") {
    const summary = await getWorkerStatus(dependencies, options.get("worker-id"));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (command === "backend:inspect") {
    const inspection = await dependencies.backend.inspect();
    process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
    return;
  }

  if (command === "backend:status") {
    const status = await dependencies.backend.status();
    process.stdout.write(`${formatBackendStatus(status)}\n\n${JSON.stringify(status, null, 2)}\n`);
    return;
  }

  if (command === "backend:live-smoke") {
    const result = await runSupabaseBackendLiveSmoke({
      repoPath,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-backend-live")),
      enabled: getOption(options, "enabled", "true") === "true",
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        backendHealthStatus:
          result.status === "passed"
            ? "ready"
            : result.status === "manual_required"
              ? "manual_required"
              : result.status === "skipped"
                ? "skipped"
                : "blocked",
        lastBackendLiveSmokeResult: result,
        updatedAt: result.ranAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:health") {
    const result = await inspectBackendHealth({
      dependencies,
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        backendHealthStatus: result.status,
        lastBackendHealthSummary: result,
        updatedAt: result.inspectedAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${formatBackendHealth(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:repair") {
    const result = await repairBackendHealth({
      dependencies,
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        repairStatus: result.status,
        lastRepairDecision: result,
        updatedAt: result.ranAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${formatRepairSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:export") {
    const result = await exportBackendSnapshot({
      dependencies,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-backend-transfer")),
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        transferStatus: result.status,
        lastTransferSummary: result,
        updatedAt: result.createdAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${formatTransferSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:import") {
    const snapshotPath = options.get("snapshot");
    if (!snapshotPath) {
      throw new Error("--snapshot is required for backend:import.");
    }
    const result = await importBackendSnapshot({
      dependencies,
      snapshotPath: path.resolve(snapshotPath),
      targetBackendType: dependencies.backend.backendType,
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        transferStatus: result.status,
        lastTransferSummary: result,
        updatedAt: result.createdAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${formatTransferSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:init") {
    const result = await dependencies.backend.initialize();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:migrate") {
    const result = await dependencies.backend.migrate();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "run:cancel") {
    const runId = await resolveRunId({
      stateId,
      dependencies,
      explicitRunId: options.get("run-id"),
    });
    const updatedRun = await requestCancelRun(dependencies.backend, runId, options.get("reason"));
    if (updatedRun) {
      const updatedState = orchestratorStateSchema.parse(applyQueueItemToState(existingState, updatedRun, new Date()));
      await dependencies.storage.saveState(updatedState);
    }
    process.stdout.write(updatedRun ? `${formatRunSummary(updatedRun)}\n` : "Run not found.\n");
    return;
  }

  if (command === "run:pause") {
    const runId = await resolveRunId({
      stateId,
      dependencies,
      explicitRunId: options.get("run-id"),
    });
    const updatedRun = await requestPauseRun(dependencies.backend, runId, options.get("reason"));
    if (updatedRun) {
      const updatedState = orchestratorStateSchema.parse(applyQueueItemToState(existingState, updatedRun, new Date()));
      await dependencies.storage.saveState(updatedState);
    }
    process.stdout.write(updatedRun ? `${formatRunSummary(updatedRun)}\n` : "Run not found.\n");
    return;
  }

  if (command === "run:resume" || command === "run:requeue") {
    const runId = await resolveRunId({
      stateId,
      dependencies,
      explicitRunId: options.get("run-id"),
    });
    const updatedRun = await requeueRun(dependencies.backend, runId, options.get("reason"));
    if (updatedRun) {
      const updatedState = orchestratorStateSchema.parse(applyQueueItemToState(existingState, updatedRun, new Date()));
      await dependencies.storage.saveState(updatedState);
    }
    process.stdout.write(updatedRun ? `${formatRunSummary(updatedRun)}\n` : "Run not found.\n");
    return;
  }

  if (command === "approve") {
    const updatedState = await approvePendingPlan(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "reject") {
    const updatedState = await rejectPendingPlan(stateId, dependencies, options.get("reason"));
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "approve-patch") {
    const updatedState = await approvePendingPatch(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "promote-patch") {
    const updatedState = await promoteApprovedPatch(stateId, dependencies, {
      applyWorkspace,
      createBranch,
    });
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "reject-patch") {
    const updatedState = await rejectPendingPatch(stateId, dependencies, options.get("reason"));
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "run-once" || command === "resume" || command === "dry-run") {
    const updatedState = await runOrchestratorOnce(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "run-loop") {
    const updatedState = await runOrchestratorLoop(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "workspace:cleanup") {
    const manager = new FileSystemWorkspaceManager(workspaceRoot);
    await manager.cleanupWorkspace(stateId);
    process.stdout.write(`${JSON.stringify({ cleaned: true, workspaceRoot, stateId }, null, 2)}\n`);
    return;
  }

  if (command === "cleanup") {
    const result = await cleanupStateWorkspaces(stateId, dependencies, {
      staleMinutes: options.has("stale-minutes") ? Number.parseInt(getOption(options, "stale-minutes", "120"), 10) : undefined,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "artifacts:prune") {
    const result = await pruneStateArtifacts(stateId, dependencies, {
      retainRecentSuccess: options.has("retain-success") ? Number.parseInt(getOption(options, "retain-success", "3"), 10) : undefined,
      retainRecentFailure: options.has("retain-failure") ? Number.parseInt(getOption(options, "retain-failure", "5"), 10) : undefined,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "live-smoke") {
    const result = await runLiveSmoke({
      repoPath,
      workspaceRoot,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-live-smoke")),
      model: options.get("model"),
      enabled: liveSmokeEnabled || getOption(options, "enabled", "true") === "true",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "live-acceptance") {
    const result = await runLiveAcceptance({
      stateId,
      dependencies,
      repoPath,
      workspaceRoot,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-live-acceptance")),
      model: options.get("model"),
      enabled: liveSmokeEnabled || getOption(options, "enabled", "true") === "true",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "live-pass") {
    const result = await runLivePass({
      stateId,
      dependencies,
      repoPath,
      workspaceRoot,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-live-pass")),
      model: options.get("model"),
      enabled: liveSmokeEnabled || getOption(options, "enabled", "true") === "true",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "handoff") {
    const result = await prepareHandoff(stateId, dependencies, {
      publishBranch,
      createBranch,
      githubHandoffEnabled,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      "Usage:",
      "  node cli.js init --state-id default --goal \"...\"",
      "  node cli.js plan --state-id default",
      "  node cli.js event:intake --payload path/to/event.json --enqueue true --report-status true",
      "  node cli.js webhook:intake --payload path/to/payload.json --headers path/to/headers.json --enqueue true",
      "  node cli.js webhook:runtime --host 127.0.0.1 --port 8787 --base-path /hooks --webhook-path /github",
      "  node cli.js webhook:serve --host 127.0.0.1 --port 8787 --base-path /hooks --webhook-path /github",
      "  node cli.js actor-policy:check --actor orchestrator-admin --command run",
      "  node cli.js inbound:list",
      "  node cli.js inbound:inspect --inbound-id delivery-123",
      "  node cli.js status:report --state-id default",
      "  node cli.js github-live-report:smoke --state-id default",
      "  node cli.js reporting:smoke --state-id default",
      "  node cli.js reporting:permissions --state-id default",
      "  node cli.js sandbox:create --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --target-repo example/bige --target-type issue --target-number 101 --set-default true",
      "  node cli.js sandbox:update --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --enabled true --notes \"safe smoke target\"",
      "  node cli.js sandbox:delete --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:set-default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:target-check --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:list --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:bundle:list --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:bundle:show --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-bundle create-only",
      "  node cli.js sandbox:bundle:governance --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-bundle create-only --sandbox-profile default",
      "  node cli.js sandbox:show --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:validate --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:governance --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:restore-points --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:restore-points:list --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:rollback:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:compare --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...",
      "  node cli.js sandbox:governance:status --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:incident:governance --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:incident:policy --sandbox-config .tmp/orchestrator-sandbox.json --incident-id sandbox-incident:...",
      "  node cli.js sandbox:resolution:readiness --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:resolution:evidence --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:resolution:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:resolution:audit:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:incident:closure-check --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:checklist --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:review:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:review:queue --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:review:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:review:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:review:resolution --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:settlement:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:followup:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:followup:queue --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:queue --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:resolution --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:carry-forward --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:confirm-review --sandbox-config .tmp/orchestrator-sandbox.json --completion-audit-id sandbox-closeout-completion:...",
      "  node cli.js sandbox:closeout:completion:confirm-closeout --sandbox-config .tmp/orchestrator-sandbox.json --completion-audit-id sandbox-closeout-completion:...",
      "  node cli.js sandbox:closeout:completion:keep-carry-forward --sandbox-config .tmp/orchestrator-sandbox.json --reason \"follow-up still open\"",
      "  node cli.js sandbox:closeout:completion:reopen --sandbox-config .tmp/orchestrator-sandbox.json --reason \"completion reverted\"",
      "  node cli.js sandbox:closeout:completion:disposition:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:lifecycle --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:decision:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:decision:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:completion:finalization:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:finalization:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:finalization:stability --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:post-finalization:followup:queue --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:stability:drift --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:reopen:recurrence --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:stability:watchlist --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:stability:recurrence:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:watchlist:resolution --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:watchlist:lifecycle --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:watchlist:exit:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:watchlist:readd:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:stability:recovery:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovery:confidence --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovery:regression:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovered:monitoring:queue --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovery:confidence:trend --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:regression:resolution --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovered:monitoring:exit:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovery:clearance:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovery:clearance:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovered:exit:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovered:reentry:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovered:lifecycle --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovered:lifecycle:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovery:retirement:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovered:retirement:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovery:retirement:queue --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:recovery:retirement:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:retirement:exit:criteria --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:retired-case:audit:history --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:review:approve --sandbox-config .tmp/orchestrator-sandbox.json --audit-id sandbox-resolution-audit:... --reason \"closure evidence is sufficient\"",
      "  node cli.js sandbox:closeout:review:reject --sandbox-config .tmp/orchestrator-sandbox.json --reason \"blocked reasons remain\"",
      "  node cli.js sandbox:closeout:review:followup --sandbox-config .tmp/orchestrator-sandbox.json --note \"collect rerun validate evidence\"",
      "  node cli.js sandbox:closeout:review:defer --sandbox-config .tmp/orchestrator-sandbox.json --note \"handoff to next operator\"",
      "  node cli.js sandbox:closeout:review:reopen --sandbox-config .tmp/orchestrator-sandbox.json --reason \"new blocked pattern observed\"",
      "  node cli.js sandbox:closeout:disposition:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:closeout:review:lifecycle --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:incident:acknowledge --sandbox-config .tmp/orchestrator-sandbox.json --incident-id sandbox-incident:...",
      "  node cli.js sandbox:incident:resolve --sandbox-config .tmp/orchestrator-sandbox.json --incident-id sandbox-incident:...",
      "  node cli.js sandbox:incident:escalate --sandbox-config .tmp/orchestrator-sandbox.json --incident-id sandbox-incident:...",
      "  node cli.js sandbox:incident:request-review --sandbox-config .tmp/orchestrator-sandbox.json --incident-id sandbox-incident:...",
      "  node cli.js sandbox:incident:rerun-preview --sandbox-config .tmp/orchestrator-sandbox.json --incident-id sandbox-incident:...",
      "  node cli.js sandbox:incident:rerun-validate --sandbox-config .tmp/orchestrator-sandbox.json --incident-id sandbox-incident:...",
      "  node cli.js sandbox:incident:rerun-apply --sandbox-config .tmp/orchestrator-sandbox.json --incident-id sandbox-incident:...",
      "  node cli.js sandbox:escalation:summary --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:operator:handoff --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:guardrails --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:export --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --output .tmp/sandbox-default.json",
      "  node cli.js sandbox:import --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json --mode preview",
      "  node cli.js sandbox:diff --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json",
      "  node cli.js sandbox:review --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json",
      "  node cli.js sandbox:apply --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json",
      "  node cli.js sandbox:batch:preview --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only",
      "  node cli.js sandbox:batch:validate --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only",
      "  node cli.js sandbox:batch:apply --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only --allow-partial false",
      "  node cli.js sandbox:rollback:preview --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...",
      "  node cli.js sandbox:rollback:validate --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...",
      "  node cli.js sandbox:rollback:apply --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...",
      "  node cli.js reporting:precheck --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:auth-smoke --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:run-live-smoke --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:live-success-smoke --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:status --state-id default",
      "  node cli.js reporting:audit --state-id default",
      "  node cli.js queue:enqueue --state-id default --priority 10",
      "  node cli.js queue:list",
      "  node cli.js run-once --state-id default --executor openai_responses --execution-mode dry_run",
      "  node cli.js run-loop --state-id default --executor mock",
      "  node cli.js worker:once --worker-id worker-1",
      "  node cli.js worker:run --worker-id worker-1 --poll-ms 1000 --max-polls 10",
      "  node cli.js worker:status --worker-id worker-1",
      "  node cli.js backend:init --backend-type supabase",
      "  node cli.js backend:migrate --backend-type supabase",
      "  node cli.js backend:status --backend-type sqlite",
      "  node cli.js backend:live-smoke --backend-type supabase",
      "  node cli.js backend:health --backend-type supabase",
      "  node cli.js backend:repair --backend-type supabase",
      "  node cli.js backend:export --backend-type file",
      "  node cli.js backend:import --backend-type supabase --snapshot path/to/export.json",
      "  node cli.js backend:inspect",
      "  node cli.js run:pause --state-id default",
      "  node cli.js run:resume --state-id default",
      "  node cli.js run:cancel --state-id default",
      "  node cli.js run:requeue --state-id default",
      "  node cli.js approve --state-id default",
      "  node cli.js reject --state-id default --reason \"...\"",
      "  node cli.js approve-patch --state-id default",
      "  node cli.js promote-patch --state-id default --create-branch true --apply-workspace false",
      "  node cli.js reject-patch --state-id default --reason \"...\"",
      "  node cli.js handoff --state-id default --publish-branch false --github-handoff false",
      "  node cli.js preflight --state-id default",
      "  node cli.js inspect --state-id default",
      "  node cli.js diagnostics --state-id default",
      "  node cli.js report:intake --state-id default --report path/to/gpt-code-report.md",
      "  node cli.js resume --state-id default",
      "  node cli.js workspace:cleanup --state-id default --workspace-root .tmp/orchestrator-workspaces",
      "  node cli.js cleanup --state-id default --stale-minutes 120",
      "  node cli.js artifacts:prune --state-id default --retain-success 3 --retain-failure 5",
      "  node cli.js live-smoke --enabled true --workspace-root .tmp/orchestrator-workspaces",
      "  node cli.js live-acceptance --state-id default --enabled true",
      "  node cli.js live-pass --state-id default --enabled true",
      "  node cli.js review --state-id default",
      "  node cli.js dry-run --state-id default --executor mock",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
