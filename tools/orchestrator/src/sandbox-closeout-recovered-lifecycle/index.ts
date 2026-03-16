import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredExitHistory,
  type SandboxCloseoutRecoveredExitHistory,
} from "../sandbox-closeout-recovered-exit-history";
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

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveredLifecycle = {
  latestRecoveryStatus: SandboxCloseoutRecoveryConfidenceTrend["latestRecoveryConfidenceLevel"];
  latestMonitoringStatus: SandboxCloseoutRecoveredMonitoringExitAudit["monitoringExitStatus"];
  latestClearanceStatus: SandboxCloseoutRecoveryClearanceAudit["recoveryClearanceStatus"];
  latestRegressionStatus: SandboxCloseoutRegressionResolutionSummary["regressionResolutionStatus"];
  lifecycleStatus:
    | "recovered_monitored"
    | "recovered_cleared"
    | "recovered_reentered"
    | "recovered_regressed"
    | "recovered_but_reopenable";
  caseMonitored: boolean;
  caseCleared: boolean;
  caseHasReEnteredGovernance: boolean;
  caseHasRegressed: boolean;
  caseRemainsReopenable: boolean;
  lifecycleReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveredLifecycle(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryClearanceAudit?: SandboxCloseoutRecoveryClearanceAudit;
  closeoutRecoveredExitHistory?: SandboxCloseoutRecoveredExitHistory;
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

  const caseHasRegressed =
    closeoutRegressionResolutionSummary.regressionRemainsActive ||
    closeoutRegressionResolutionSummary.regressionResolutionStatus ===
      "regression_reopened";
  const caseHasReEnteredGovernance =
    closeoutRecoveredExitHistory.reEntryCount > 0 &&
    !closeoutRecoveryClearanceAudit.caseClearedFromGovernanceMonitoring;
  const caseCleared =
    closeoutRecoveryClearanceAudit.caseClearedFromGovernanceMonitoring;
  const caseRemainsReopenable =
    closeoutRecoveryClearanceAudit.caseRemainsReopenable;
  const caseMonitored =
    !caseCleared &&
    (closeoutRecoveredMonitoringExitAudit.caseRemainsMonitored ||
      closeoutRecoveryClearanceAudit.caseRemainsMonitored);

  let lifecycleStatus: SandboxCloseoutRecoveredLifecycle["lifecycleStatus"] =
    "recovered_monitored";
  if (caseHasRegressed) {
    lifecycleStatus = "recovered_regressed";
  } else if (caseHasReEnteredGovernance) {
    lifecycleStatus = "recovered_reentered";
  } else if (caseCleared) {
    lifecycleStatus = "recovered_cleared";
  } else if (caseRemainsReopenable) {
    lifecycleStatus = "recovered_but_reopenable";
  }

  const lifecycleReasons = unique([
    ...closeoutRecoveryClearanceAudit.recoveryClearanceBlockedReasons,
    ...closeoutRecoveredExitHistory.historyReasons,
    ...closeoutRecoveryConfidenceTrend.confidenceTrendReasons,
    ...closeoutRegressionResolutionSummary.regressionBlockers,
    ...(caseHasReEnteredGovernance ? ["reentered_recovery_governance"] : []),
    ...(caseHasRegressed ? ["recovered_case_regressed"] : []),
    ...(caseCleared ? ["recovered_case_cleared"] : []),
    ...(caseRemainsReopenable ? ["recovered_but_reopenable"] : []),
  ]);
  const recommendedNextOperatorStep = caseCleared
    ? "recovered_lifecycle_cleared"
    : closeoutRecoveryClearanceAudit.recommendedNextOperatorStep ||
      closeoutRegressionResolutionSummary.recommendedNextOperatorStep ||
      closeoutRecoveredMonitoringExitAudit.recommendedNextOperatorStep;
  const summaryLine = `Sandbox closeout recovered lifecycle: ${lifecycleStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestRecoveryStatus:
      closeoutRecoveryConfidenceTrend.latestRecoveryConfidenceLevel,
    latestMonitoringStatus:
      closeoutRecoveredMonitoringExitAudit.monitoringExitStatus,
    latestClearanceStatus:
      closeoutRecoveryClearanceAudit.recoveryClearanceStatus,
    latestRegressionStatus:
      closeoutRegressionResolutionSummary.regressionResolutionStatus,
    lifecycleStatus,
    caseMonitored,
    caseCleared,
    caseHasReEnteredGovernance,
    caseHasRegressed,
    caseRemainsReopenable,
    lifecycleReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveredLifecycle;
}

export function formatSandboxCloseoutRecoveredLifecycle(
  result: SandboxCloseoutRecoveredLifecycle,
) {
  return [
    "Sandbox closeout recovered lifecycle",
    `Latest recovery status: ${result.latestRecoveryStatus}`,
    `Latest monitoring status: ${result.latestMonitoringStatus}`,
    `Latest clearance status: ${result.latestClearanceStatus}`,
    `Latest regression status: ${result.latestRegressionStatus}`,
    `Lifecycle status: ${result.lifecycleStatus}`,
    `Case monitored: ${result.caseMonitored}`,
    `Case cleared: ${result.caseCleared}`,
    `Case re-entered governance: ${result.caseHasReEnteredGovernance}`,
    `Case regressed: ${result.caseHasRegressed}`,
    `Case remains reopenable: ${result.caseRemainsReopenable}`,
    `Lifecycle reasons: ${result.lifecycleReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
