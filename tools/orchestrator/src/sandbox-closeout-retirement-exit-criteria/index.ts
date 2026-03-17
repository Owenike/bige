import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredLifecycleHistory,
  type SandboxCloseoutRecoveredLifecycleHistory,
} from "../sandbox-closeout-recovered-lifecycle-history";
import {
  buildSandboxCloseoutRecoveredRetirementSummary,
  type SandboxCloseoutRecoveredRetirementSummary,
} from "../sandbox-closeout-recovered-retirement-summary";
import {
  buildSandboxCloseoutRecoveryClearanceHistory,
  type SandboxCloseoutRecoveryClearanceHistory,
} from "../sandbox-closeout-recovery-clearance-history";
import {
  buildSandboxCloseoutRecoveryConfidenceTrend,
  type SandboxCloseoutRecoveryConfidenceTrend,
} from "../sandbox-closeout-recovery-confidence-trend";
import {
  buildSandboxCloseoutRecoveryRetirementAudit,
  type SandboxCloseoutRecoveryRetirementAudit,
} from "../sandbox-closeout-recovery-retirement-audit";
import {
  buildSandboxCloseoutRecoveryRetirementQueue,
  type SandboxCloseoutRecoveryRetirementQueue,
} from "../sandbox-closeout-recovery-retirement-queue";
import {
  buildSandboxCloseoutRegressionResolutionSummary,
  type SandboxCloseoutRegressionResolutionSummary,
} from "../sandbox-closeout-regression-resolution-summary";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRetirementExitCriteria = {
  latestRecoveryStatus: SandboxCloseoutRecoveryRetirementAudit["latestRecoveryStatus"];
  latestRetirementStatus:
    SandboxCloseoutRecoveryRetirementAudit["recoveryRetirementStatus"];
  latestClearanceStatus:
    SandboxCloseoutRecoveryRetirementAudit["latestRecoveryClearanceStatus"];
  latestRegressionResolutionStatus:
    SandboxCloseoutRecoveryRetirementAudit["latestRegressionResolutionStatus"];
  latestMonitoringStatus:
    SandboxCloseoutRecoveredRetirementSummary["latestMonitoringStatus"];
  latestWatchlistStatus:
    SandboxCloseoutRecoveryRetirementAudit["latestWatchlistStatus"];
  retirementExitCriteriaStatus:
    | "strict_pass"
    | "provisional_pass"
    | "blocked_by_regression"
    | "blocked_by_reentry_risk"
    | "blocked_by_followup"
    | "blocked_by_watchlist_readd_risk"
    | "blocked";
  retirementCriteriaMet: boolean;
  retirementCriteriaBlockers: string[];
  retirementCriteriaSupportingReasons: string[];
  criteriaAreStrictPass: boolean;
  criteriaAreProvisionalPass: boolean;
  criteriaRemainUnmet: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRetirementExitCriteria(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryRetirementAudit?: SandboxCloseoutRecoveryRetirementAudit;
  closeoutRecoveredRetirementSummary?: SandboxCloseoutRecoveredRetirementSummary;
  closeoutRecoveryRetirementQueue?: SandboxCloseoutRecoveryRetirementQueue;
  closeoutRecoveryClearanceHistory?: SandboxCloseoutRecoveryClearanceHistory;
  closeoutRecoveredLifecycleHistory?: SandboxCloseoutRecoveredLifecycleHistory;
  closeoutRecoveryConfidenceTrend?: SandboxCloseoutRecoveryConfidenceTrend;
  closeoutRegressionResolutionSummary?: SandboxCloseoutRegressionResolutionSummary;
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
    }));
  const closeoutRecoveryRetirementAudit =
    params.closeoutRecoveryRetirementAudit ??
    (await buildSandboxCloseoutRecoveryRetirementAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
    }));
  const closeoutRecoveryClearanceHistory =
    params.closeoutRecoveryClearanceHistory ??
    (await buildSandboxCloseoutRecoveryClearanceHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutRecoveredLifecycleHistory =
    params.closeoutRecoveredLifecycleHistory ??
    (await buildSandboxCloseoutRecoveredLifecycleHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceHistory,
    }));
  const closeoutRecoveredRetirementSummary =
    params.closeoutRecoveredRetirementSummary ??
    (await buildSandboxCloseoutRecoveredRetirementSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryRetirementAudit,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredLifecycleHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
    }));
  const closeoutRecoveryRetirementQueue =
    params.closeoutRecoveryRetirementQueue ??
    (await buildSandboxCloseoutRecoveryRetirementQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryRetirementAudit,
      closeoutRecoveredRetirementSummary,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredLifecycleHistory,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(
    params.state.lastIncidentSeverity ?? "",
  );
  const blockedByRegression =
    closeoutRegressionResolutionSummary.regressionRemainsActive ||
    closeoutRegressionResolutionSummary.regressionStillImpactsRecoveredState ||
    closeoutRecoveryRetirementAudit.recoveryRetirementStatus ===
      "retirement_blocked_by_regression" ||
    closeoutRecoveryRetirementQueue.regressionRiskFlag;
  const blockedByReentryRisk =
    closeoutRecoveryRetirementAudit.recoveryRetirementStatus ===
      "retirement_blocked_by_reentry_risk" ||
    closeoutRecoveryRetirementQueue.reentryRiskFlag ||
    closeoutRecoveryClearanceHistory.repeatedClearanceThenReEnterPatterns
      .length > 0 ||
    closeoutRecoveredLifecycleHistory.repeatedReEnteredPatterns.length > 0;
  const blockedByFollowup =
    closeoutRecoveryRetirementAudit.recoveryRetirementStatus ===
      "retirement_blocked_by_followup" ||
    closeoutRecoveryRetirementAudit.retirementBlockedReasons.some((reason) =>
      reason.includes("followup"),
    );
  const blockedByWatchlistReaddRisk =
    closeoutRecoveryRetirementAudit.latestWatchlistStatus !== "empty" ||
    closeoutRecoveryRetirementAudit.retirementBlockedReasons.some(
      (reason) => reason.includes("watchlist") || reason.includes("readd"),
    ) ||
    closeoutRecoveryRetirementQueue.retirementBlockedReasons.some(
      (reason) => reason.includes("watchlist") || reason.includes("readd"),
    );
  const criteriaAreStrictPass =
    !terminalSeverity &&
    closeoutRecoveryRetirementAudit.recoveryRetirementStatus ===
      "retirement_allowed" &&
    closeoutRecoveredRetirementSummary.retirementReady &&
    closeoutRecoveryRetirementQueue.queueStatus === "empty" &&
    !closeoutRecoveryConfidenceTrend.trendRemainsUnresolved &&
    closeoutRegressionResolutionSummary.regressionResolutionStatus ===
      "regression_resolved";
  const criteriaAreProvisionalPass =
    !criteriaAreStrictPass &&
    !terminalSeverity &&
    (closeoutRecoveredRetirementSummary.retirementProvisional ||
      closeoutRecoveryRetirementAudit.recoveryRetirementStatus ===
        "retirement_allowed_but_reopenable" ||
      closeoutRecoveryRetirementQueue.queueStatus === "retirement_provisional");
  const criteriaRemainUnmet =
    !criteriaAreStrictPass && !criteriaAreProvisionalPass;

  let retirementExitCriteriaStatus: SandboxCloseoutRetirementExitCriteria["retirementExitCriteriaStatus"] =
    "blocked";
  if (criteriaAreStrictPass) {
    retirementExitCriteriaStatus = "strict_pass";
  } else if (criteriaAreProvisionalPass) {
    retirementExitCriteriaStatus = "provisional_pass";
  } else if (blockedByRegression) {
    retirementExitCriteriaStatus = "blocked_by_regression";
  } else if (blockedByFollowup) {
    retirementExitCriteriaStatus = "blocked_by_followup";
  } else if (blockedByWatchlistReaddRisk) {
    retirementExitCriteriaStatus = "blocked_by_watchlist_readd_risk";
  } else if (blockedByReentryRisk || terminalSeverity) {
    retirementExitCriteriaStatus = "blocked_by_reentry_risk";
  }

  const retirementCriteriaMet =
    criteriaAreStrictPass || criteriaAreProvisionalPass;
  const retirementCriteriaSupportingReasons = unique([
    ...closeoutRecoveryRetirementAudit.retirementSupportingReasons,
    ...closeoutRecoveredRetirementSummary.retirementReasons,
    ...closeoutRecoveryConfidenceTrend.confidenceTrendReasons,
    ...closeoutRegressionResolutionSummary.regressionResolutionReasons,
    ...(criteriaAreStrictPass ? ["retirement_exit_criteria_strict_pass"] : []),
    ...(criteriaAreProvisionalPass
      ? ["retirement_exit_criteria_provisional_pass"]
      : []),
  ]);
  const retirementCriteriaBlockers = unique([
    ...closeoutRecoveryRetirementAudit.retirementBlockedReasons,
    ...closeoutRecoveredRetirementSummary.retirementWarnings,
    ...closeoutRecoveryRetirementQueue.retirementBlockedReasons,
    ...closeoutRecoveryClearanceHistory.historyReasons,
    ...closeoutRecoveredLifecycleHistory.historyReasons,
    ...closeoutRegressionResolutionSummary.regressionBlockers,
    ...(terminalSeverity
      ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`]
      : []),
  ]);
  const recommendedNextOperatorStep = criteriaAreStrictPass
    ? "retirement_exit_criteria_satisfied"
    : closeoutRecoveryRetirementQueue.recommendedNextOperatorStep ||
      closeoutRecoveredRetirementSummary.recommendedNextOperatorStep ||
      closeoutRecoveryRetirementAudit.recommendedNextOperatorStep;
  const summaryLine = `Sandbox closeout retirement exit criteria: ${retirementExitCriteriaStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestRecoveryStatus: closeoutRecoveryRetirementAudit.latestRecoveryStatus,
    latestRetirementStatus:
      closeoutRecoveryRetirementAudit.recoveryRetirementStatus,
    latestClearanceStatus:
      closeoutRecoveryRetirementAudit.latestRecoveryClearanceStatus,
    latestRegressionResolutionStatus:
      closeoutRecoveryRetirementAudit.latestRegressionResolutionStatus,
    latestMonitoringStatus:
      closeoutRecoveredRetirementSummary.latestMonitoringStatus,
    latestWatchlistStatus:
      closeoutRecoveryRetirementAudit.latestWatchlistStatus,
    retirementExitCriteriaStatus,
    retirementCriteriaMet,
    retirementCriteriaBlockers,
    retirementCriteriaSupportingReasons,
    criteriaAreStrictPass,
    criteriaAreProvisionalPass,
    criteriaRemainUnmet,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRetirementExitCriteria;
}

export function formatSandboxCloseoutRetirementExitCriteria(
  result: SandboxCloseoutRetirementExitCriteria,
) {
  return [
    "Sandbox closeout retirement exit criteria",
    `Latest recovery status: ${result.latestRecoveryStatus}`,
    `Latest retirement status: ${result.latestRetirementStatus}`,
    `Latest clearance status: ${result.latestClearanceStatus}`,
    `Latest regression resolution status: ${result.latestRegressionResolutionStatus}`,
    `Latest monitoring status: ${result.latestMonitoringStatus}`,
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Retirement exit criteria status: ${result.retirementExitCriteriaStatus}`,
    `Retirement criteria met: ${result.retirementCriteriaMet}`,
    `Retirement criteria blockers: ${result.retirementCriteriaBlockers.join(" | ") || "none"}`,
    `Retirement criteria supporting reasons: ${result.retirementCriteriaSupportingReasons.join(" | ") || "none"}`,
    `Criteria are strict-pass: ${result.criteriaAreStrictPass}`,
    `Criteria are provisional-pass: ${result.criteriaAreProvisionalPass}`,
    `Criteria remain unmet: ${result.criteriaRemainUnmet}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
