import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredMonitoringQueue,
  type SandboxCloseoutRecoveredMonitoringQueue,
} from "../sandbox-closeout-recovered-monitoring-queue";
import {
  buildSandboxCloseoutRecoveryConfidence,
  type SandboxCloseoutRecoveryConfidence,
} from "../sandbox-closeout-recovery-confidence";
import {
  buildSandboxCloseoutRecoveryRegressionAudit,
  type SandboxCloseoutRecoveryRegressionAudit,
} from "../sandbox-closeout-recovery-regression-audit";
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

export type SandboxCloseoutRegressionResolutionSummary = {
  latestRegressionStatus:
    SandboxCloseoutRecoveryRegressionAudit["latestRegressionStatus"];
  latestRecoveryConfidenceStatus:
    SandboxCloseoutRecoveryConfidence["recoveryConfidenceLevel"];
  latestWatchlistStatus: SandboxCloseoutWatchlistExitAudit["latestWatchlistStatus"];
  latestMonitoringQueueStatus:
    SandboxCloseoutRecoveredMonitoringQueue["queueStatus"];
  regressionResolutionStatus:
    | "regression_resolved"
    | "regression_provisionally_resolved"
    | "regression_active"
    | "regression_reopened"
    | "regression_still_blocks_recovered_exit";
  regressionResolved: boolean;
  regressionProvisionallyResolved: boolean;
  regressionRemainsActive: boolean;
  regressionResolutionReasons: string[];
  regressionBlockers: string[];
  regressionStillImpactsRecoveredState: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRegressionResolutionSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryRegressionAudit?: SandboxCloseoutRecoveryRegressionAudit;
  closeoutRecoveryConfidence?: SandboxCloseoutRecoveryConfidence;
  closeoutWatchlistExitAudit?: SandboxCloseoutWatchlistExitAudit;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
  closeoutRecoveredMonitoringQueue?: SandboxCloseoutRecoveredMonitoringQueue;
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
  const closeoutRecoveryConfidence =
    params.closeoutRecoveryConfidence ??
    (await buildSandboxCloseoutRecoveryConfidence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
    }));
  const closeoutRecoveryRegressionAudit =
    params.closeoutRecoveryRegressionAudit ??
    (await buildSandboxCloseoutRecoveryRegressionAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidence,
      closeoutWatchlistReAddHistory,
    }));
  const closeoutRecoveredMonitoringQueue =
    params.closeoutRecoveredMonitoringQueue ??
    (await buildSandboxCloseoutRecoveredMonitoringQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidence,
      closeoutRecoveryRegressionAudit,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(
    params.state.lastIncidentSeverity ?? "",
  );
  const regressionReopened =
    closeoutRecoveryRegressionAudit.latestRegressionStatus ===
      "recovered_then_reopened" &&
    closeoutRecoveryRegressionAudit.regressionDetected;
  const regressionStillImpactsRecoveredState =
    closeoutRecoveryConfidence.recoveryConfidenceLevel !==
      "high_confidence_recovered" ||
    closeoutRecoveredMonitoringQueue.queueStatus === "regression_risk" ||
    closeoutWatchlistExitAudit.caseRemainsReopenable ||
    closeoutWatchlistReAddHistory.reAddCount > 0;
  const regressionRemainsActive =
    terminalSeverity ||
    closeoutRecoveryRegressionAudit.regressionRemainsActive ||
    regressionReopened ||
    (closeoutRecoveryRegressionAudit.regressionDetected &&
      regressionStillImpactsRecoveredState);
  const regressionResolved =
    !terminalSeverity &&
    !closeoutRecoveryRegressionAudit.regressionDetected &&
    !regressionStillImpactsRecoveredState;
  const regressionProvisionallyResolved =
    !regressionResolved &&
    !regressionRemainsActive &&
    !terminalSeverity &&
    closeoutRecoveryConfidence.recoveryConfidenceLevel !== "recovery_blocked";

  let regressionResolutionStatus: SandboxCloseoutRegressionResolutionSummary["regressionResolutionStatus"] =
    "regression_active";
  if (regressionReopened) {
    regressionResolutionStatus = "regression_reopened";
  } else if (regressionRemainsActive) {
    regressionResolutionStatus = "regression_active";
  } else if (regressionStillImpactsRecoveredState) {
    regressionResolutionStatus = "regression_still_blocks_recovered_exit";
  } else if (regressionProvisionallyResolved) {
    regressionResolutionStatus = "regression_provisionally_resolved";
  } else {
    regressionResolutionStatus = "regression_resolved";
  }

  const regressionResolutionReasons = unique([
    ...closeoutRecoveryRegressionAudit.regressionReasons,
    ...closeoutRecoveryConfidence.recoveryConfidenceReasons,
    ...closeoutWatchlistExitAudit.exitSupportingReasons,
    ...(regressionResolved ? ["regression_resolved"] : []),
    ...(regressionProvisionallyResolved
      ? ["regression_provisionally_resolved"]
      : []),
  ]);
  const regressionBlockers = unique([
    ...closeoutRecoveryRegressionAudit.regressionReasons,
    ...closeoutRecoveryConfidence.recoveryConfidenceBlockers,
    ...closeoutRecoveredMonitoringQueue.monitoringReasons,
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
    ...(closeoutWatchlistExitAudit.caseRemainsReopenable
      ? ["case_remains_reopenable"]
      : []),
    ...(terminalSeverity
      ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`]
      : []),
  ]);
  const recommendedNextOperatorStep =
    regressionResolved && !regressionStillImpactsRecoveredState
      ? "regression_resolved"
      : closeoutRecoveryRegressionAudit.recommendedNextOperatorStep ||
        closeoutRecoveredMonitoringQueue.recommendedNextOperatorStep ||
        closeoutRecoveryConfidence.recommendedNextOperatorStep;
  const summaryLine =
    regressionResolved && !regressionStillImpactsRecoveredState
      ? "Sandbox closeout regression resolution: regression resolved."
      : `Sandbox closeout regression resolution: ${regressionResolutionStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestRegressionStatus:
      closeoutRecoveryRegressionAudit.latestRegressionStatus,
    latestRecoveryConfidenceStatus:
      closeoutRecoveryConfidence.recoveryConfidenceLevel,
    latestWatchlistStatus: closeoutWatchlistExitAudit.latestWatchlistStatus,
    latestMonitoringQueueStatus:
      closeoutRecoveredMonitoringQueue.queueStatus,
    regressionResolutionStatus,
    regressionResolved,
    regressionProvisionallyResolved,
    regressionRemainsActive,
    regressionResolutionReasons,
    regressionBlockers,
    regressionStillImpactsRecoveredState,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRegressionResolutionSummary;
}

export function formatSandboxCloseoutRegressionResolutionSummary(
  result: SandboxCloseoutRegressionResolutionSummary,
) {
  return [
    "Sandbox closeout regression resolution summary",
    `Latest regression status: ${result.latestRegressionStatus}`,
    `Latest recovery confidence status: ${result.latestRecoveryConfidenceStatus}`,
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Latest monitoring queue status: ${result.latestMonitoringQueueStatus}`,
    `Regression resolution status: ${result.regressionResolutionStatus}`,
    `Regression resolved: ${result.regressionResolved}`,
    `Regression provisionally resolved: ${result.regressionProvisionallyResolved}`,
    `Regression remains active: ${result.regressionRemainsActive}`,
    `Regression resolution reasons: ${result.regressionResolutionReasons.join(" | ") || "none"}`,
    `Regression blockers: ${result.regressionBlockers.join(" | ") || "none"}`,
    `Regression still impacts recovered state: ${result.regressionStillImpactsRecoveredState}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
