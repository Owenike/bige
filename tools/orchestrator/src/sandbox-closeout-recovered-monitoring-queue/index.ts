import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutPostFinalizationFollowupQueue,
  type SandboxCloseoutPostFinalizationFollowupQueue,
} from "../sandbox-closeout-post-finalization-followup-queue";
import {
  buildSandboxCloseoutRecoveryConfidence,
  type SandboxCloseoutRecoveryConfidence,
} from "../sandbox-closeout-recovery-confidence";
import {
  buildSandboxCloseoutRecoveryRegressionAudit,
  type SandboxCloseoutRecoveryRegressionAudit,
} from "../sandbox-closeout-recovery-regression-audit";
import {
  buildSandboxCloseoutStabilityRecoverySummary,
  type SandboxCloseoutStabilityRecoverySummary,
} from "../sandbox-closeout-stability-recovery-summary";
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

export type SandboxCloseoutRecoveredMonitoringQueueEntry = {
  queuedAt: string | null;
  queueStatus:
    | "monitoring_required"
    | "provisional_recovery"
    | "low_confidence_recovery"
    | "regression_risk"
    | "reopenable_recovered"
    | "recent_watchlist_exit"
    | "recent_followup_closed";
  recovered: boolean;
  recoveryConfidenceLevel:
    SandboxCloseoutRecoveryConfidence["recoveryConfidenceLevel"];
  regressionRiskFlag: boolean;
  reopenableFlag: boolean;
  watchlistRecentlyResolvedFlag: boolean;
  followupRecentlyClosedFlag: boolean;
  monitoringReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export type SandboxCloseoutRecoveredMonitoringQueue = {
  entries: SandboxCloseoutRecoveredMonitoringQueueEntry[];
  latestQueueEntry: SandboxCloseoutRecoveredMonitoringQueueEntry | null;
  queueStatus:
    | "empty"
    | SandboxCloseoutRecoveredMonitoringQueueEntry["queueStatus"];
  recovered: boolean;
  recoveryConfidenceLevel:
    SandboxCloseoutRecoveryConfidence["recoveryConfidenceLevel"];
  regressionRiskFlag: boolean;
  reopenableFlag: boolean;
  watchlistRecentlyResolvedFlag: boolean;
  followupRecentlyClosedFlag: boolean;
  monitoringReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveredMonitoringQueue(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryConfidence?: SandboxCloseoutRecoveryConfidence;
  closeoutRecoveryRegressionAudit?: SandboxCloseoutRecoveryRegressionAudit;
  closeoutWatchlistExitAudit?: SandboxCloseoutWatchlistExitAudit;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
  closeoutStabilityRecoverySummary?: SandboxCloseoutStabilityRecoverySummary;
  closeoutPostFinalizationFollowupQueue?: SandboxCloseoutPostFinalizationFollowupQueue;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutPostFinalizationFollowupQueue =
    params.closeoutPostFinalizationFollowupQueue ??
    (await buildSandboxCloseoutPostFinalizationFollowupQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutWatchlistExitAudit =
    params.closeoutWatchlistExitAudit ??
    (await buildSandboxCloseoutWatchlistExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutPostFinalizationFollowupQueue,
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
  const closeoutStabilityRecoverySummary =
    params.closeoutStabilityRecoverySummary ??
    (await buildSandboxCloseoutStabilityRecoverySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutPostFinalizationFollowupQueue,
    }));
  const closeoutRecoveryConfidence =
    params.closeoutRecoveryConfidence ??
    (await buildSandboxCloseoutRecoveryConfidence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityRecoverySummary,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutPostFinalizationFollowupQueue,
    }));
  const closeoutRecoveryRegressionAudit =
    params.closeoutRecoveryRegressionAudit ??
    (await buildSandboxCloseoutRecoveryRegressionAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidence,
      closeoutStabilityRecoverySummary,
      closeoutWatchlistReAddHistory,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(
    params.state.lastIncidentSeverity ?? "",
  );
  const recovered =
    closeoutRecoveryConfidence.recoveryConfidenceLevel !== "recovery_blocked";
  const regressionRiskFlag =
    closeoutRecoveryRegressionAudit.regressionDetected ||
    closeoutRecoveryRegressionAudit.regressionRemainsActive ||
    closeoutRecoveryConfidence.recoveryConfidenceLevel !==
      "high_confidence_recovered" ||
    closeoutStabilityRecoverySummary.reAddRiskRemainsHigh;
  const reopenableFlag = closeoutRecoveryConfidence.caseRemainsReopenable;
  const watchlistRecentlyResolvedFlag =
    closeoutWatchlistExitAudit.exitAllowed ||
    closeoutWatchlistExitAudit.caseRemovedFromWatchlist ||
    closeoutWatchlistExitAudit.entries.some((entry) => entry.exitAllowed);
  const followupRecentlyClosedFlag =
    !closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen &&
    (watchlistRecentlyResolvedFlag ||
      closeoutStabilityRecoverySummary.recoveryAchieved ||
      closeoutStabilityRecoverySummary.recoveryProvisional);
  const needsMonitoring =
    recovered &&
    (terminalSeverity ||
      regressionRiskFlag ||
      reopenableFlag ||
      watchlistRecentlyResolvedFlag ||
      followupRecentlyClosedFlag);

  let queueStatus: SandboxCloseoutRecoveredMonitoringQueue["queueStatus"] =
    "empty";
  if (needsMonitoring) {
    if (closeoutRecoveryRegressionAudit.regressionDetected) {
      queueStatus = "regression_risk";
    } else if (
      closeoutRecoveryConfidence.recoveryConfidenceLevel ===
      "provisional_recovered"
    ) {
      queueStatus = "provisional_recovery";
    } else if (
      closeoutRecoveryConfidence.recoveryConfidenceLevel ===
      "low_confidence_recovered"
    ) {
      queueStatus = "low_confidence_recovery";
    } else if (reopenableFlag) {
      queueStatus = "reopenable_recovered";
    } else if (watchlistRecentlyResolvedFlag) {
      queueStatus = "recent_watchlist_exit";
    } else if (followupRecentlyClosedFlag) {
      queueStatus = "recent_followup_closed";
    } else {
      queueStatus = "monitoring_required";
    }
  }

  const monitoringReasons = unique([
    ...closeoutRecoveryConfidence.recoveryConfidenceReasons,
    ...closeoutRecoveryConfidence.recoveryConfidenceBlockers,
    ...closeoutRecoveryRegressionAudit.regressionReasons,
    ...closeoutStabilityRecoverySummary.recoveryWarnings,
    ...(watchlistRecentlyResolvedFlag ? ["watchlist_recently_resolved"] : []),
    ...(followupRecentlyClosedFlag ? ["followup_recently_closed"] : []),
    ...(reopenableFlag ? ["case_remains_reopenable"] : []),
    ...(terminalSeverity
      ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`]
      : []),
  ]);
  const recommendedNextOperatorStep =
    queueStatus === "empty"
      ? "recovered_monitoring_clear"
      : closeoutRecoveryRegressionAudit.regressionDetected
        ? closeoutRecoveryRegressionAudit.recommendedNextOperatorStep
        : closeoutRecoveryConfidence.recommendedNextOperatorStep;
  const latestQueueEntry =
    queueStatus === "empty"
      ? null
      : ({
          queuedAt: closeoutWatchlistExitAudit.auditedAt,
          queueStatus,
          recovered,
          recoveryConfidenceLevel:
            closeoutRecoveryConfidence.recoveryConfidenceLevel,
          regressionRiskFlag,
          reopenableFlag,
          watchlistRecentlyResolvedFlag,
          followupRecentlyClosedFlag,
          monitoringReasons,
          recommendedNextOperatorStep,
          summaryLine: `Recovered monitoring queue: ${queueStatus}; next=${recommendedNextOperatorStep}.`,
        } satisfies SandboxCloseoutRecoveredMonitoringQueueEntry);
  const entries =
    latestQueueEntry === null ? [] : [latestQueueEntry].slice(0, limit);
  const summaryLine =
    latestQueueEntry === null
      ? "Sandbox closeout recovered monitoring queue: no recovered monitoring remains open."
      : latestQueueEntry.summaryLine;

  return {
    entries,
    latestQueueEntry,
    queueStatus,
    recovered,
    recoveryConfidenceLevel:
      closeoutRecoveryConfidence.recoveryConfidenceLevel,
    regressionRiskFlag,
    reopenableFlag,
    watchlistRecentlyResolvedFlag,
    followupRecentlyClosedFlag,
    monitoringReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveredMonitoringQueue;
}

export function formatSandboxCloseoutRecoveredMonitoringQueue(
  result: SandboxCloseoutRecoveredMonitoringQueue,
) {
  return [
    "Sandbox closeout recovered monitoring queue",
    `Queue status: ${result.queueStatus}`,
    `Recovered: ${result.recovered}`,
    `Recovery confidence level: ${result.recoveryConfidenceLevel}`,
    `Regression risk flag: ${result.regressionRiskFlag}`,
    `Reopenable flag: ${result.reopenableFlag}`,
    `Watchlist recently resolved flag: ${result.watchlistRecentlyResolvedFlag}`,
    `Follow-up recently closed flag: ${result.followupRecentlyClosedFlag}`,
    `Monitoring reasons: ${result.monitoringReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
