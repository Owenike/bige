import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredLifecycleHistory,
  type SandboxCloseoutRecoveredLifecycleHistory,
} from "../sandbox-closeout-recovered-lifecycle-history";
import {
  buildSandboxCloseoutRecoveredReentryAudit,
  type SandboxCloseoutRecoveredReentryAudit,
} from "../sandbox-closeout-recovered-reentry-audit";
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
  buildSandboxCloseoutRegressionResolutionSummary,
  type SandboxCloseoutRegressionResolutionSummary,
} from "../sandbox-closeout-regression-resolution-summary";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveredRetirementSummary = {
  latestRecoveryStatus: SandboxCloseoutRecoveryRetirementAudit["latestRecoveryStatus"];
  latestLifecycleStatus:
    SandboxCloseoutRecoveryRetirementAudit["latestRecoveredLifecycleStatus"];
  latestClearanceStatus:
    SandboxCloseoutRecoveryRetirementAudit["latestRecoveryClearanceStatus"];
  latestRegressionResolutionStatus:
    SandboxCloseoutRecoveryRetirementAudit["latestRegressionResolutionStatus"];
  latestMonitoringStatus:
    SandboxCloseoutRecoveryRetirementAudit["latestMonitoringExitStatus"];
  retirementReady: boolean;
  retirementProvisional: boolean;
  retirementBlocked: boolean;
  caseRecoveredButStillActive: boolean;
  caseRecoveredAndRetireable: boolean;
  retirementReasons: string[];
  retirementWarnings: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveredRetirementSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryRetirementAudit?: SandboxCloseoutRecoveryRetirementAudit;
  closeoutRecoveryClearanceHistory?: SandboxCloseoutRecoveryClearanceHistory;
  closeoutRecoveredReentryAudit?: SandboxCloseoutRecoveredReentryAudit;
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
  const closeoutRecoveredReentryAudit =
    params.closeoutRecoveredReentryAudit ??
    (await buildSandboxCloseoutRecoveredReentryAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
    }));
  const closeoutRecoveredLifecycleHistory =
    params.closeoutRecoveredLifecycleHistory ??
    (await buildSandboxCloseoutRecoveredLifecycleHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredReentryAudit,
    }));

  const retirementReady =
    closeoutRecoveryRetirementAudit.recoveryRetirementStatus ===
    "retirement_allowed";
  const retirementProvisional =
    closeoutRecoveryRetirementAudit.recoveryRetirementStatus ===
      "retirement_allowed_but_reopenable" ||
    (closeoutRecoveryRetirementAudit.retirementAllowed &&
      closeoutRecoveryConfidenceTrend.trendRemainsUnresolved);
  const retirementBlocked = !retirementReady && !retirementProvisional;
  const caseRecoveredButStillActive =
    closeoutRecoveryRetirementAudit.latestRecoveryStatus !== "recovery_blocked" &&
    !retirementReady;
  const caseRecoveredAndRetireable = retirementReady;
  const retirementReasons = unique([
    ...closeoutRecoveryRetirementAudit.retirementSupportingReasons,
    ...closeoutRecoveryClearanceHistory.historyReasons,
    ...closeoutRecoveredLifecycleHistory.historyReasons,
    ...closeoutRegressionResolutionSummary.regressionResolutionReasons,
    ...closeoutRecoveryConfidenceTrend.confidenceTrendReasons,
    ...(caseRecoveredAndRetireable ? ["recovered_and_retireable"] : []),
    ...(caseRecoveredButStillActive ? ["recovered_but_still_active"] : []),
  ]);
  const retirementWarnings = unique([
    ...closeoutRecoveryRetirementAudit.retirementBlockedReasons,
    ...closeoutRecoveredReentryAudit.reentryReasons,
    ...closeoutRecoveredLifecycleHistory.lifecycleTransitionSummary,
    ...closeoutRecoveryClearanceHistory.repeatedClearanceThenReEnterPatterns,
    ...closeoutRecoveryClearanceHistory.repeatedClearanceThenRegressedPatterns,
    ...(retirementProvisional ? ["retirement_provisional"] : []),
  ]);
  const recommendedNextOperatorStep = retirementReady
    ? "recovery_retirement_ready"
    : closeoutRecoveryRetirementAudit.recommendedNextOperatorStep ||
      closeoutRecoveredReentryAudit.recommendedNextOperatorStep ||
      closeoutRecoveredLifecycleHistory.recommendedNextOperatorStep;
  const summaryStatus = retirementReady
    ? "retirement_ready"
    : retirementProvisional
      ? "retirement_provisional"
      : retirementBlocked
        ? "retirement_blocked"
        : "recovered_but_still_active";
  const summaryLine = `Sandbox closeout recovered retirement summary: ${summaryStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestRecoveryStatus: closeoutRecoveryRetirementAudit.latestRecoveryStatus,
    latestLifecycleStatus:
      closeoutRecoveryRetirementAudit.latestRecoveredLifecycleStatus,
    latestClearanceStatus:
      closeoutRecoveryRetirementAudit.latestRecoveryClearanceStatus,
    latestRegressionResolutionStatus:
      closeoutRecoveryRetirementAudit.latestRegressionResolutionStatus,
    latestMonitoringStatus:
      closeoutRecoveryRetirementAudit.latestMonitoringExitStatus,
    retirementReady,
    retirementProvisional,
    retirementBlocked,
    caseRecoveredButStillActive,
    caseRecoveredAndRetireable,
    retirementReasons,
    retirementWarnings,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveredRetirementSummary;
}

export function formatSandboxCloseoutRecoveredRetirementSummary(
  result: SandboxCloseoutRecoveredRetirementSummary,
) {
  return [
    "Sandbox closeout recovered retirement summary",
    `Latest recovery status: ${result.latestRecoveryStatus}`,
    `Latest lifecycle status: ${result.latestLifecycleStatus}`,
    `Latest clearance status: ${result.latestClearanceStatus}`,
    `Latest regression resolution status: ${result.latestRegressionResolutionStatus}`,
    `Latest monitoring status: ${result.latestMonitoringStatus}`,
    `Retirement ready: ${result.retirementReady}`,
    `Retirement provisional: ${result.retirementProvisional}`,
    `Retirement blocked: ${result.retirementBlocked}`,
    `Recovered but still active: ${result.caseRecoveredButStillActive}`,
    `Recovered and retireable: ${result.caseRecoveredAndRetireable}`,
    `Retirement reasons: ${result.retirementReasons.join(" | ") || "none"}`,
    `Retirement warnings: ${result.retirementWarnings.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
