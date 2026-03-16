import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredExitHistory,
  type SandboxCloseoutRecoveredExitHistory,
} from "../sandbox-closeout-recovered-exit-history";
import {
  buildSandboxCloseoutRecoveredLifecycle,
  type SandboxCloseoutRecoveredLifecycle,
} from "../sandbox-closeout-recovered-lifecycle";
import {
  buildSandboxCloseoutRecoveredMonitoringExitAudit,
  type SandboxCloseoutRecoveredMonitoringExitAudit,
} from "../sandbox-closeout-recovered-monitoring-exit-audit";
import {
  buildSandboxCloseoutRecoveryClearanceAudit,
  type SandboxCloseoutRecoveryClearanceAudit,
} from "../sandbox-closeout-recovery-clearance-audit";
import {
  buildSandboxCloseoutRecoveryConfidenceTrend,
  type SandboxCloseoutRecoveryConfidenceTrend,
} from "../sandbox-closeout-recovery-confidence-trend";
import {
  buildSandboxCloseoutRegressionResolutionSummary,
  type SandboxCloseoutRegressionResolutionSummary,
} from "../sandbox-closeout-regression-resolution-summary";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveryRetirementAudit = {
  latestRecoveryStatus: SandboxCloseoutRecoveredLifecycle["latestRecoveryStatus"];
  latestRecoveredLifecycleStatus: SandboxCloseoutRecoveredLifecycle["lifecycleStatus"];
  latestRecoveryClearanceStatus:
    SandboxCloseoutRecoveryClearanceAudit["recoveryClearanceStatus"];
  latestRegressionResolutionStatus:
    SandboxCloseoutRegressionResolutionSummary["regressionResolutionStatus"];
  latestMonitoringExitStatus:
    SandboxCloseoutRecoveredMonitoringExitAudit["monitoringExitStatus"];
  latestWatchlistStatus: SandboxCloseoutRecoveryClearanceAudit["latestWatchlistStatus"];
  recoveryRetirementStatus:
    | "retirement_allowed"
    | "retirement_blocked"
    | "retirement_allowed_but_reopenable"
    | "retirement_blocked_by_regression"
    | "retirement_blocked_by_followup"
    | "retirement_blocked_by_reentry_risk";
  retirementAllowed: boolean;
  retirementSupportingReasons: string[];
  retirementBlockedReasons: string[];
  caseLeavesActiveGovernance: boolean;
  caseRemainsMonitored: boolean;
  caseRemainsReopenable: boolean;
  caseRemainsRegressionProne: boolean;
  recommendedNextOperatorStep: string;
  auditedAt: string | null;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveryRetirementAudit(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryClearanceAudit?: SandboxCloseoutRecoveryClearanceAudit;
  closeoutRecoveredExitHistory?: SandboxCloseoutRecoveredExitHistory;
  closeoutRecoveredLifecycle?: SandboxCloseoutRecoveredLifecycle;
  closeoutRecoveryConfidenceTrend?: SandboxCloseoutRecoveryConfidenceTrend;
  closeoutRegressionResolutionSummary?: SandboxCloseoutRegressionResolutionSummary;
  closeoutRecoveredMonitoringExitAudit?: SandboxCloseoutRecoveredMonitoringExitAudit;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const closeoutRecoveryConfidenceTrend =
    params.closeoutRecoveryConfidenceTrend ??
    (await buildSandboxCloseoutRecoveryConfidenceTrend({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutRegressionResolutionSummary =
    params.closeoutRegressionResolutionSummary ??
    (await buildSandboxCloseoutRegressionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidence: undefined,
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
    }));
  const closeoutRecoveryClearanceAudit =
    params.closeoutRecoveryClearanceAudit ??
    (await buildSandboxCloseoutRecoveryClearanceAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringExitAudit,
    }));
  const closeoutRecoveredExitHistory =
    params.closeoutRecoveredExitHistory ??
    (await buildSandboxCloseoutRecoveredExitHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveredMonitoringExitAudit,
      closeoutRecoveryClearanceAudit,
      closeoutRegressionResolutionSummary,
    }));
  const closeoutRecoveredLifecycle =
    params.closeoutRecoveredLifecycle ??
    (await buildSandboxCloseoutRecoveredLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceAudit,
      closeoutRecoveredExitHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringExitAudit,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(
    params.state.lastIncidentSeverity ?? "",
  );
  const latestRecoveryStatus = closeoutRecoveredLifecycle.latestRecoveryStatus;
  const latestRecoveredLifecycleStatus =
    closeoutRecoveredLifecycle.lifecycleStatus;
  const latestRecoveryClearanceStatus =
    closeoutRecoveryClearanceAudit.recoveryClearanceStatus;
  const latestRegressionResolutionStatus =
    closeoutRegressionResolutionSummary.regressionResolutionStatus;
  const latestMonitoringExitStatus =
    closeoutRecoveredMonitoringExitAudit.monitoringExitStatus;
  const latestWatchlistStatus =
    closeoutRecoveryClearanceAudit.latestWatchlistStatus;
  const caseRemainsReopenable =
    closeoutRecoveryClearanceAudit.caseRemainsReopenable ||
    closeoutRecoveredLifecycle.caseRemainsReopenable ||
    closeoutRecoveredMonitoringExitAudit.caseRecoveredButStillReopenable;
  const followupBlocked =
    closeoutRecoveryClearanceAudit.latestFollowupStatus !== "empty" ||
    latestRecoveryClearanceStatus === "clearance_blocked_by_followup";
  const regressionBlocked =
    closeoutRegressionResolutionSummary.regressionRemainsActive ||
    closeoutRegressionResolutionSummary.regressionStillImpactsRecoveredState ||
    closeoutRecoveredLifecycle.caseHasRegressed;
  const reentryRiskBlocked =
    closeoutRecoveredExitHistory.reEntryCount > 0 ||
    closeoutRecoveredLifecycle.caseHasReEnteredGovernance;
  const caseRemainsRegressionProne =
    closeoutRecoveryClearanceAudit.caseRemainsRegressionProne ||
    regressionBlocked ||
    reentryRiskBlocked ||
    latestRecoveryStatus !== "high_confidence_recovered";
  const baselineRetireable =
    latestRecoveredLifecycleStatus === "recovered_cleared" &&
    closeoutRecoveryClearanceAudit.recoveryClearanceAllowed &&
    closeoutRecoveredMonitoringExitAudit.monitoringExitAllowed &&
    !terminalSeverity;

  let recoveryRetirementStatus: SandboxCloseoutRecoveryRetirementAudit["recoveryRetirementStatus"] =
    "retirement_blocked";
  if (
    baselineRetireable &&
    !followupBlocked &&
    !regressionBlocked &&
    !reentryRiskBlocked &&
    caseRemainsReopenable
  ) {
    recoveryRetirementStatus = "retirement_allowed_but_reopenable";
  } else if (followupBlocked) {
    recoveryRetirementStatus = "retirement_blocked_by_followup";
  } else if (regressionBlocked) {
    recoveryRetirementStatus = "retirement_blocked_by_regression";
  } else if (reentryRiskBlocked) {
    recoveryRetirementStatus = "retirement_blocked_by_reentry_risk";
  } else if (
    baselineRetireable &&
    !caseRemainsReopenable &&
    !caseRemainsRegressionProne
  ) {
    recoveryRetirementStatus = "retirement_allowed";
  }

  const retirementAllowed =
    recoveryRetirementStatus === "retirement_allowed" ||
    recoveryRetirementStatus === "retirement_allowed_but_reopenable";
  const caseLeavesActiveGovernance =
    recoveryRetirementStatus === "retirement_allowed";
  const caseRemainsMonitored = !caseLeavesActiveGovernance;
  const retirementSupportingReasons = unique([
    ...closeoutRecoveryClearanceAudit.recoveryClearanceSupportingReasons,
    ...closeoutRegressionResolutionSummary.regressionResolutionReasons,
    ...closeoutRecoveredMonitoringExitAudit.monitoringExitSupportingReasons,
    ...closeoutRecoveredLifecycle.lifecycleReasons,
    ...(retirementAllowed ? ["recovery_retirement_reviewed"] : []),
    ...(caseLeavesActiveGovernance ? ["recovery_retirement_allowed"] : []),
    ...(recoveryRetirementStatus === "retirement_allowed_but_reopenable"
      ? ["retirement_allowed_but_reopenable"]
      : []),
  ]);
  const retirementBlockedReasons = unique([
    ...closeoutRecoveryClearanceAudit.recoveryClearanceBlockedReasons,
    ...closeoutRecoveredMonitoringExitAudit.monitoringExitBlockedReasons,
    ...closeoutRegressionResolutionSummary.regressionBlockers,
    ...closeoutRecoveredExitHistory.historyReasons,
    ...(caseRemainsReopenable ? ["case_remains_reopenable"] : []),
    ...(reentryRiskBlocked ? ["reentry_risk_remains_active"] : []),
    ...(terminalSeverity
      ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`]
      : []),
    ...(latestWatchlistStatus !== "empty"
      ? [`watchlist_status:${latestWatchlistStatus}`]
      : []),
  ]);
  const recommendedNextOperatorStep = caseLeavesActiveGovernance
    ? "recovery_governance_retired"
    : closeoutRecoveredLifecycle.recommendedNextOperatorStep ||
      closeoutRegressionResolutionSummary.recommendedNextOperatorStep ||
      closeoutRecoveryClearanceAudit.recommendedNextOperatorStep;
  const auditedAt =
    closeoutRecoveredMonitoringExitAudit.auditedAt ??
    closeoutRecoveryClearanceAudit.auditedAt;
  const summaryLine = caseLeavesActiveGovernance
    ? "Sandbox closeout recovery retirement audit: case retired from active governance."
    : `Sandbox closeout recovery retirement audit: ${recoveryRetirementStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestRecoveryStatus,
    latestRecoveredLifecycleStatus,
    latestRecoveryClearanceStatus,
    latestRegressionResolutionStatus,
    latestMonitoringExitStatus,
    latestWatchlistStatus,
    recoveryRetirementStatus,
    retirementAllowed,
    retirementSupportingReasons,
    retirementBlockedReasons,
    caseLeavesActiveGovernance,
    caseRemainsMonitored,
    caseRemainsReopenable,
    caseRemainsRegressionProne,
    recommendedNextOperatorStep,
    auditedAt,
    summaryLine,
  } satisfies SandboxCloseoutRecoveryRetirementAudit;
}

export function formatSandboxCloseoutRecoveryRetirementAudit(
  result: SandboxCloseoutRecoveryRetirementAudit,
) {
  return [
    "Sandbox closeout recovery retirement audit",
    `Latest recovery status: ${result.latestRecoveryStatus}`,
    `Latest recovered lifecycle status: ${result.latestRecoveredLifecycleStatus}`,
    `Latest recovery clearance status: ${result.latestRecoveryClearanceStatus}`,
    `Latest regression resolution status: ${result.latestRegressionResolutionStatus}`,
    `Latest monitoring exit status: ${result.latestMonitoringExitStatus}`,
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Recovery retirement status: ${result.recoveryRetirementStatus}`,
    `Retirement allowed: ${result.retirementAllowed}`,
    `Retirement supporting reasons: ${result.retirementSupportingReasons.join(" | ") || "none"}`,
    `Retirement blocked reasons: ${result.retirementBlockedReasons.join(" | ") || "none"}`,
    `Leaves active governance: ${result.caseLeavesActiveGovernance}`,
    `Remains monitored: ${result.caseRemainsMonitored}`,
    `Remains reopenable: ${result.caseRemainsReopenable}`,
    `Remains regression-prone: ${result.caseRemainsRegressionProne}`,
    `Latest audit: ${result.auditedAt ?? "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
