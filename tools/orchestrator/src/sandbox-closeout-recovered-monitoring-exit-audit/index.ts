import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredMonitoringQueue,
  type SandboxCloseoutRecoveredMonitoringQueue,
} from "../sandbox-closeout-recovered-monitoring-queue";
import {
  buildSandboxCloseoutRecoveryConfidenceTrend,
  type SandboxCloseoutRecoveryConfidenceTrend,
} from "../sandbox-closeout-recovery-confidence-trend";
import {
  buildSandboxCloseoutRegressionResolutionSummary,
  type SandboxCloseoutRegressionResolutionSummary,
} from "../sandbox-closeout-regression-resolution-summary";
import {
  buildSandboxCloseoutWatchlistExitAudit,
  type SandboxCloseoutWatchlistExitAudit,
} from "../sandbox-closeout-watchlist-exit-audit";
import {
  buildSandboxCloseoutWatchlistReAddHistory,
  type SandboxCloseoutWatchlistReAddHistory,
} from "../sandbox-closeout-watchlist-readd-history";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveredMonitoringExitAudit = {
  latestRecoveryConfidenceStatus:
    SandboxCloseoutRecoveryConfidenceTrend["latestRecoveryConfidenceLevel"];
  latestRegressionResolutionStatus:
    SandboxCloseoutRegressionResolutionSummary["regressionResolutionStatus"];
  latestMonitoringQueueStatus:
    SandboxCloseoutRecoveredMonitoringQueue["queueStatus"];
  monitoringExitStatus:
    | "monitoring_exit_allowed"
    | "monitoring_exit_blocked"
    | "monitoring_exit_blocked_by_confidence"
    | "monitoring_exit_blocked_by_regression"
    | "monitoring_exit_blocked_by_reopenable_risk";
  monitoringExitAllowed: boolean;
  monitoringExitSupportingReasons: string[];
  monitoringExitBlockedReasons: string[];
  caseLeavesMonitoringQueue: boolean;
  caseRemainsMonitored: boolean;
  caseRecoveredButStillReopenable: boolean;
  caseRecoveredAndMonitoringComplete: boolean;
  recommendedNextOperatorStep: string;
  auditedAt: string | null;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveredMonitoringExitAudit(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryConfidenceTrend?: SandboxCloseoutRecoveryConfidenceTrend;
  closeoutRegressionResolutionSummary?: SandboxCloseoutRegressionResolutionSummary;
  closeoutRecoveredMonitoringQueue?: SandboxCloseoutRecoveredMonitoringQueue;
  closeoutWatchlistExitAudit?: SandboxCloseoutWatchlistExitAudit;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutWatchlistExitAudit =
    params.closeoutWatchlistExitAudit ??
    (await buildSandboxCloseoutWatchlistExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutWatchlistReAddHistory =
    params.closeoutWatchlistReAddHistory ??
    (await buildSandboxCloseoutWatchlistReAddHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutWatchlistExitAudit,
    }));
  const closeoutRecoveryConfidenceTrend =
    params.closeoutRecoveryConfidenceTrend ??
    (await buildSandboxCloseoutRecoveryConfidenceTrend({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutWatchlistReAddHistory,
    }));
  const closeoutRegressionResolutionSummary =
    params.closeoutRegressionResolutionSummary ??
    (await buildSandboxCloseoutRegressionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
    }));
  const closeoutRecoveredMonitoringQueue =
    params.closeoutRecoveredMonitoringQueue ??
    (await buildSandboxCloseoutRecoveredMonitoringQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(
    params.state.lastIncidentSeverity ?? "",
  );
  const caseRecoveredButStillReopenable =
    closeoutWatchlistExitAudit.caseRemainsReopenable;
  const monitoringOnlyBecauseOfObservationWindow =
    closeoutRecoveredMonitoringQueue.queueStatus === "recent_watchlist_exit" ||
    closeoutRecoveredMonitoringQueue.queueStatus === "recent_followup_closed";
  const caseRecoveredAndMonitoringComplete =
    closeoutRecoveryConfidenceTrend.latestRecoveryConfidenceLevel ===
      "high_confidence_recovered" &&
    closeoutRegressionResolutionSummary.regressionResolved &&
    (
      closeoutRecoveredMonitoringQueue.queueStatus === "empty" ||
      monitoringOnlyBecauseOfObservationWindow
    ) &&
    !caseRecoveredButStillReopenable &&
    closeoutWatchlistReAddHistory.reAddCount === 0 &&
    !terminalSeverity;
  const monitoringExitAllowed = caseRecoveredAndMonitoringComplete;
  const caseLeavesMonitoringQueue = monitoringExitAllowed;
  const caseRemainsMonitored = !monitoringExitAllowed;

  let monitoringExitStatus: SandboxCloseoutRecoveredMonitoringExitAudit["monitoringExitStatus"] =
    "monitoring_exit_blocked";
  if (monitoringExitAllowed) {
    monitoringExitStatus = "monitoring_exit_allowed";
  } else if (caseRecoveredButStillReopenable) {
    monitoringExitStatus = "monitoring_exit_blocked_by_reopenable_risk";
  } else if (
    closeoutRegressionResolutionSummary.regressionRemainsActive ||
    closeoutRegressionResolutionSummary.regressionStillImpactsRecoveredState
  ) {
    monitoringExitStatus = "monitoring_exit_blocked_by_regression";
  } else if (
    closeoutRecoveryConfidenceTrend.latestRecoveryConfidenceLevel !==
    "high_confidence_recovered"
  ) {
    monitoringExitStatus = "monitoring_exit_blocked_by_confidence";
  }

  const monitoringExitSupportingReasons = unique([
    ...closeoutRegressionResolutionSummary.regressionResolutionReasons,
    ...closeoutRecoveryConfidenceTrend.confidenceTrendReasons,
    ...closeoutWatchlistExitAudit.exitSupportingReasons,
    ...(monitoringOnlyBecauseOfObservationWindow
      ? ["monitoring_observation_window_cleared"]
      : []),
    ...(monitoringExitAllowed ? ["recovered_monitoring_exit_allowed"] : []),
    ...(caseRecoveredAndMonitoringComplete
      ? ["recovered_monitoring_complete"]
      : []),
  ]);
  const monitoringExitBlockedReasons = unique([
    ...closeoutRegressionResolutionSummary.regressionBlockers,
    ...closeoutRecoveredMonitoringQueue.monitoringReasons,
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
    ...(caseRecoveredButStillReopenable
      ? ["case_remains_reopenable"]
      : []),
    ...(terminalSeverity
      ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`]
      : []),
  ]);
  const recommendedNextOperatorStep = monitoringExitAllowed
    ? "recovered_monitoring_exit_complete"
    : closeoutRegressionResolutionSummary.recommendedNextOperatorStep ||
      closeoutRecoveredMonitoringQueue.recommendedNextOperatorStep ||
      closeoutRecoveryConfidenceTrend.recommendedNextOperatorStep;
  const auditedAt =
    closeoutRecoveredMonitoringQueue.latestQueueEntry?.queuedAt ??
    closeoutWatchlistExitAudit.auditedAt;
  const summaryLine = monitoringExitAllowed
    ? "Sandbox closeout recovered monitoring exit audit: monitoring exit allowed."
    : `Sandbox closeout recovered monitoring exit audit: ${monitoringExitStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestRecoveryConfidenceStatus:
      closeoutRecoveryConfidenceTrend.latestRecoveryConfidenceLevel,
    latestRegressionResolutionStatus:
      closeoutRegressionResolutionSummary.regressionResolutionStatus,
    latestMonitoringQueueStatus: closeoutRecoveredMonitoringQueue.queueStatus,
    monitoringExitStatus,
    monitoringExitAllowed,
    monitoringExitSupportingReasons,
    monitoringExitBlockedReasons,
    caseLeavesMonitoringQueue,
    caseRemainsMonitored,
    caseRecoveredButStillReopenable,
    caseRecoveredAndMonitoringComplete,
    recommendedNextOperatorStep,
    auditedAt,
    summaryLine,
  } satisfies SandboxCloseoutRecoveredMonitoringExitAudit;
}

export function formatSandboxCloseoutRecoveredMonitoringExitAudit(
  result: SandboxCloseoutRecoveredMonitoringExitAudit,
) {
  return [
    "Sandbox closeout recovered monitoring exit audit",
    `Latest recovery confidence status: ${result.latestRecoveryConfidenceStatus}`,
    `Latest regression resolution status: ${result.latestRegressionResolutionStatus}`,
    `Latest monitoring queue status: ${result.latestMonitoringQueueStatus}`,
    `Monitoring exit status: ${result.monitoringExitStatus}`,
    `Monitoring exit allowed: ${result.monitoringExitAllowed}`,
    `Monitoring exit supporting reasons: ${result.monitoringExitSupportingReasons.join(" | ") || "none"}`,
    `Monitoring exit blocked reasons: ${result.monitoringExitBlockedReasons.join(" | ") || "none"}`,
    `Leaves monitoring queue: ${result.caseLeavesMonitoringQueue}`,
    `Remains monitored: ${result.caseRemainsMonitored}`,
    `Recovered but still reopenable: ${result.caseRecoveredButStillReopenable}`,
    `Recovered and monitoring-complete: ${result.caseRecoveredAndMonitoringComplete}`,
    `Latest audit: ${result.auditedAt ?? "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
