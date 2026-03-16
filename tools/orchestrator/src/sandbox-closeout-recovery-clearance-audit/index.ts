import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredMonitoringExitAudit,
  type SandboxCloseoutRecoveredMonitoringExitAudit,
} from "../sandbox-closeout-recovered-monitoring-exit-audit";
import {
  buildSandboxCloseoutRecoveryConfidenceTrend,
  type SandboxCloseoutRecoveryConfidenceTrend,
} from "../sandbox-closeout-recovery-confidence-trend";
import {
  buildSandboxCloseoutRegressionResolutionSummary,
  type SandboxCloseoutRegressionResolutionSummary,
} from "../sandbox-closeout-regression-resolution-summary";
import {
  buildSandboxCloseoutStabilityRecoverySummary,
  type SandboxCloseoutStabilityRecoverySummary,
} from "../sandbox-closeout-stability-recovery-summary";
import {
  buildSandboxCloseoutWatchlistReAddHistory,
  type SandboxCloseoutWatchlistReAddHistory,
} from "../sandbox-closeout-watchlist-readd-history";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveryClearanceAudit = {
  latestRecoveryConfidenceStatus:
    SandboxCloseoutRecoveryConfidenceTrend["latestRecoveryConfidenceLevel"];
  latestRegressionResolutionStatus:
    SandboxCloseoutRegressionResolutionSummary["regressionResolutionStatus"];
  latestRecoveredMonitoringExitStatus:
    SandboxCloseoutRecoveredMonitoringExitAudit["monitoringExitStatus"];
  latestWatchlistStatus: SandboxCloseoutStabilityRecoverySummary["latestWatchlistStatus"];
  latestFollowupStatus:
    SandboxCloseoutStabilityRecoverySummary["latestPostFinalizationFollowupStatus"];
  recoveryClearanceStatus:
    | "clearance_allowed"
    | "clearance_blocked"
    | "clearance_allowed_but_reopenable"
    | "clearance_blocked_by_regression"
    | "clearance_blocked_by_followup"
    | "clearance_blocked_by_readd_risk";
  recoveryClearanceAllowed: boolean;
  recoveryClearanceSupportingReasons: string[];
  recoveryClearanceBlockedReasons: string[];
  caseClearedFromGovernanceMonitoring: boolean;
  caseRemainsMonitored: boolean;
  caseRemainsReopenable: boolean;
  caseRemainsRegressionProne: boolean;
  recommendedNextOperatorStep: string;
  auditedAt: string | null;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveryClearanceAudit(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryConfidenceTrend?: SandboxCloseoutRecoveryConfidenceTrend;
  closeoutRegressionResolutionSummary?: SandboxCloseoutRegressionResolutionSummary;
  closeoutRecoveredMonitoringExitAudit?: SandboxCloseoutRecoveredMonitoringExitAudit;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
  closeoutStabilityRecoverySummary?: SandboxCloseoutStabilityRecoverySummary;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutWatchlistReAddHistory =
    params.closeoutWatchlistReAddHistory ??
    (await buildSandboxCloseoutWatchlistReAddHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutStabilityRecoverySummary =
    params.closeoutStabilityRecoverySummary ??
    (await buildSandboxCloseoutStabilityRecoverySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutWatchlistReAddHistory,
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
      closeoutWatchlistReAddHistory,
    }));
  const closeoutRecoveredMonitoringExitAudit =
    params.closeoutRecoveredMonitoringExitAudit ??
    (await buildSandboxCloseoutRecoveredMonitoringExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutWatchlistReAddHistory,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(
    params.state.lastIncidentSeverity ?? "",
  );
  const latestRecoveryConfidenceStatus =
    closeoutRecoveryConfidenceTrend.latestRecoveryConfidenceLevel;
  const latestRegressionResolutionStatus =
    closeoutRegressionResolutionSummary.regressionResolutionStatus;
  const latestRecoveredMonitoringExitStatus =
    closeoutRecoveredMonitoringExitAudit.monitoringExitStatus;
  const latestWatchlistStatus =
    closeoutStabilityRecoverySummary.latestWatchlistStatus;
  const latestFollowupStatus =
    closeoutStabilityRecoverySummary.latestPostFinalizationFollowupStatus;
  const caseRemainsReopenable =
    closeoutRecoveredMonitoringExitAudit.caseRecoveredButStillReopenable ||
    closeoutStabilityRecoverySummary.caseRecoveredButReopenable;
  const followupBlocked =
    closeoutStabilityRecoverySummary.latestPostFinalizationFollowupStatus !==
      "empty" || closeoutStabilityRecoverySummary.watchlistRemainsOpen;
  const regressionBlocked =
    closeoutRegressionResolutionSummary.regressionRemainsActive ||
    closeoutRegressionResolutionSummary.regressionStillImpactsRecoveredState;
  const reAddRiskBlocked =
    closeoutWatchlistReAddHistory.reAddCount > 0 ||
    closeoutStabilityRecoverySummary.reAddRiskRemainsHigh ||
    (closeoutRecoveryConfidenceTrend.trendRemainsUnresolved &&
      latestRecoveryConfidenceStatus !== "high_confidence_recovered");
  const caseRemainsRegressionProne =
    regressionBlocked ||
    reAddRiskBlocked ||
    latestRecoveryConfidenceStatus !== "high_confidence_recovered";

  let recoveryClearanceStatus: SandboxCloseoutRecoveryClearanceAudit["recoveryClearanceStatus"] =
    "clearance_blocked";
  if (
    latestRecoveryConfidenceStatus === "high_confidence_recovered" &&
    !terminalSeverity &&
    !followupBlocked &&
    !regressionBlocked &&
    !reAddRiskBlocked &&
    caseRemainsReopenable
  ) {
    recoveryClearanceStatus = "clearance_allowed_but_reopenable";
  } else if (followupBlocked) {
    recoveryClearanceStatus = "clearance_blocked_by_followup";
  } else if (regressionBlocked) {
    recoveryClearanceStatus = "clearance_blocked_by_regression";
  } else if (reAddRiskBlocked) {
    recoveryClearanceStatus = "clearance_blocked_by_readd_risk";
  } else if (
    closeoutRecoveredMonitoringExitAudit.monitoringExitAllowed &&
    latestRecoveryConfidenceStatus === "high_confidence_recovered" &&
    latestRegressionResolutionStatus === "regression_resolved" &&
    !caseRemainsReopenable &&
    !terminalSeverity
  ) {
    recoveryClearanceStatus = "clearance_allowed";
  }

  const recoveryClearanceAllowed =
    recoveryClearanceStatus === "clearance_allowed" ||
    recoveryClearanceStatus === "clearance_allowed_but_reopenable";
  const caseClearedFromGovernanceMonitoring =
    recoveryClearanceStatus === "clearance_allowed";
  const caseRemainsMonitored = !caseClearedFromGovernanceMonitoring;
  const recoveryClearanceSupportingReasons = unique([
    ...closeoutRecoveryConfidenceTrend.confidenceTrendReasons,
    ...closeoutRegressionResolutionSummary.regressionResolutionReasons,
    ...closeoutRecoveredMonitoringExitAudit.monitoringExitSupportingReasons,
    ...(recoveryClearanceAllowed ? ["recovery_clearance_reviewed"] : []),
    ...(caseClearedFromGovernanceMonitoring
      ? ["recovery_clearance_allowed"]
      : []),
    ...(recoveryClearanceStatus === "clearance_allowed_but_reopenable"
      ? ["clearance_allowed_but_reopenable"]
      : []),
  ]);
  const recoveryClearanceBlockedReasons = unique([
    ...closeoutRegressionResolutionSummary.regressionBlockers,
    ...closeoutRecoveredMonitoringExitAudit.monitoringExitBlockedReasons,
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
    ...(followupBlocked ? [`followup_status:${latestFollowupStatus}`] : []),
    ...(caseRemainsReopenable ? ["case_remains_reopenable"] : []),
    ...(reAddRiskBlocked ? ["readd_risk_remains_high"] : []),
    ...(terminalSeverity
      ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`]
      : []),
  ]);
  const recommendedNextOperatorStep =
    caseClearedFromGovernanceMonitoring
      ? "recovery_governance_cleared"
      : closeoutRegressionResolutionSummary.recommendedNextOperatorStep ||
        closeoutRecoveredMonitoringExitAudit.recommendedNextOperatorStep ||
        closeoutRecoveryConfidenceTrend.recommendedNextOperatorStep;
  const auditedAt = closeoutRecoveredMonitoringExitAudit.auditedAt;
  const summaryLine = caseClearedFromGovernanceMonitoring
    ? "Sandbox closeout recovery clearance audit: recovery governance cleared."
    : `Sandbox closeout recovery clearance audit: ${recoveryClearanceStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestRecoveryConfidenceStatus,
    latestRegressionResolutionStatus,
    latestRecoveredMonitoringExitStatus,
    latestWatchlistStatus,
    latestFollowupStatus,
    recoveryClearanceStatus,
    recoveryClearanceAllowed,
    recoveryClearanceSupportingReasons,
    recoveryClearanceBlockedReasons,
    caseClearedFromGovernanceMonitoring,
    caseRemainsMonitored,
    caseRemainsReopenable,
    caseRemainsRegressionProne,
    recommendedNextOperatorStep,
    auditedAt,
    summaryLine,
  } satisfies SandboxCloseoutRecoveryClearanceAudit;
}

export function formatSandboxCloseoutRecoveryClearanceAudit(
  result: SandboxCloseoutRecoveryClearanceAudit,
) {
  return [
    "Sandbox closeout recovery clearance audit",
    `Latest recovery confidence status: ${result.latestRecoveryConfidenceStatus}`,
    `Latest regression resolution status: ${result.latestRegressionResolutionStatus}`,
    `Latest recovered monitoring exit status: ${result.latestRecoveredMonitoringExitStatus}`,
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Latest follow-up status: ${result.latestFollowupStatus}`,
    `Recovery clearance status: ${result.recoveryClearanceStatus}`,
    `Recovery clearance allowed: ${result.recoveryClearanceAllowed}`,
    `Recovery clearance supporting reasons: ${result.recoveryClearanceSupportingReasons.join(" | ") || "none"}`,
    `Recovery clearance blocked reasons: ${result.recoveryClearanceBlockedReasons.join(" | ") || "none"}`,
    `Cleared from governance monitoring: ${result.caseClearedFromGovernanceMonitoring}`,
    `Remains monitored: ${result.caseRemainsMonitored}`,
    `Remains reopenable: ${result.caseRemainsReopenable}`,
    `Remains regression-prone: ${result.caseRemainsRegressionProne}`,
    `Latest audit: ${result.auditedAt ?? "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
