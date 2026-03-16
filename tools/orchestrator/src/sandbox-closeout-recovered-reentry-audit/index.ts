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
  buildSandboxCloseoutRecoveryClearanceHistory,
  type SandboxCloseoutRecoveryClearanceHistory,
} from "../sandbox-closeout-recovery-clearance-history";
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

export type SandboxCloseoutRecoveredReentryAudit = {
  latestRecoveredLifecycleStatus: SandboxCloseoutRecoveredLifecycle["lifecycleStatus"];
  latestReentryStatus:
    | "no_reentry"
    | "monitoring_exit_then_reenter"
    | "cleared_then_reenter"
    | "recovered_then_regressed"
    | "reopened_after_cleared";
  reentryDetected: boolean;
  reentrySource: string | null;
  reentryReasons: string[];
  reentrySeverity: "none" | "low" | "medium" | "high";
  reentryCount: number;
  repeatedExitThenReenterPatterns: string[];
  repeatedClearedThenReenterPatterns: string[];
  repeatedRecoveredThenRegressedPatterns: string[];
  reentryRemainsActive: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveredReentryAudit(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveredExitHistory?: SandboxCloseoutRecoveredExitHistory;
  closeoutRecoveryClearanceHistory?: SandboxCloseoutRecoveryClearanceHistory;
  closeoutRecoveryConfidenceTrend?: SandboxCloseoutRecoveryConfidenceTrend;
  closeoutRegressionResolutionSummary?: SandboxCloseoutRegressionResolutionSummary;
  closeoutRecoveredLifecycle?: SandboxCloseoutRecoveredLifecycle;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const closeoutRecoveredExitHistory =
    params.closeoutRecoveredExitHistory ??
    (await buildSandboxCloseoutRecoveredExitHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
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
  const closeoutRecoveredLifecycle =
    params.closeoutRecoveredLifecycle ??
    (await buildSandboxCloseoutRecoveredLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveredExitHistory,
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
      closeoutRecoveredExitHistory,
      closeoutRecoveredLifecycle,
    }));

  const reentryDetected = closeoutRecoveredExitHistory.reEntryCount > 0;
  let latestReentryStatus: SandboxCloseoutRecoveredReentryAudit["latestReentryStatus"] =
    "no_reentry";
  if (reentryDetected) {
    if (closeoutRecoveredLifecycle.caseHasRegressed) {
      latestReentryStatus = "recovered_then_regressed";
    } else if (
      closeoutRecoveredExitHistory.latestReEntryEntry?.pattern ===
      "cleared_then_reopened"
    ) {
      latestReentryStatus = "reopened_after_cleared";
    } else if (
      closeoutRecoveredExitHistory.latestReEntryEntry?.pattern?.startsWith("cleared_then_")
    ) {
      latestReentryStatus = "cleared_then_reenter";
    } else {
      latestReentryStatus = "monitoring_exit_then_reenter";
    }
  }

  const reentrySource = !reentryDetected
    ? null
    : latestReentryStatus === "recovered_then_regressed"
      ? "regression_resolution_summary"
      : latestReentryStatus === "cleared_then_reenter" ||
          latestReentryStatus === "reopened_after_cleared"
        ? "recovery_clearance_history"
        : "recovered_exit_history";
  const reentryReasons = unique([
    ...closeoutRecoveredExitHistory.historyReasons,
    ...closeoutRecoveryClearanceHistory.historyReasons,
    ...closeoutRecoveryConfidenceTrend.confidenceTrendReasons,
    ...closeoutRegressionResolutionSummary.regressionBlockers,
    ...(closeoutRecoveredExitHistory.latestReEntryEntry?.reason
      ? [closeoutRecoveredExitHistory.latestReEntryEntry.reason]
      : []),
  ]);
  const repeatedExitThenReenterPatterns = unique([
    ...closeoutRecoveredExitHistory.repeatedExitThenReEnterPatterns,
    ...(latestReentryStatus === "monitoring_exit_then_reenter"
      ? ["monitoring_exit_then_reenter"]
      : []),
  ]);
  const repeatedClearedThenReenterPatterns = unique([
    ...closeoutRecoveryClearanceHistory.repeatedClearanceThenReEnterPatterns,
    ...(latestReentryStatus === "cleared_then_reenter" ||
      latestReentryStatus === "reopened_after_cleared"
      ? [latestReentryStatus]
      : []),
  ]);
  const repeatedRecoveredThenRegressedPatterns = unique([
    ...closeoutRecoveryClearanceHistory.repeatedClearanceThenRegressedPatterns,
    ...(latestReentryStatus === "recovered_then_regressed"
      ? ["recovered_then_regressed"]
      : []),
  ]);
  const reentryRemainsActive =
    reentryDetected &&
    (closeoutRecoveredLifecycle.caseHasReEnteredGovernance ||
      closeoutRecoveredLifecycle.caseHasRegressed ||
      closeoutRegressionResolutionSummary.regressionRemainsActive);
  const reentrySeverity =
    !reentryDetected
      ? "none"
      : repeatedRecoveredThenRegressedPatterns.length > 0 ||
          closeoutRecoveredLifecycle.caseHasRegressed ||
          closeoutRecoveredExitHistory.reEntryCount > 1
        ? "high"
        : repeatedClearedThenReenterPatterns.length > 0 ||
            repeatedExitThenReenterPatterns.length > 0
          ? "medium"
          : "low";
  const recommendedNextOperatorStep =
    closeoutRecoveredLifecycle.recommendedNextOperatorStep ||
    closeoutRegressionResolutionSummary.recommendedNextOperatorStep ||
    closeoutRecoveryClearanceHistory.recommendedNextOperatorStep;
  const summaryLine = reentryDetected
    ? `Sandbox closeout recovered re-entry audit: ${latestReentryStatus}; next=${recommendedNextOperatorStep}.`
    : "Sandbox closeout recovered re-entry audit: no re-entry detected.";

  return {
    latestRecoveredLifecycleStatus: closeoutRecoveredLifecycle.lifecycleStatus,
    latestReentryStatus,
    reentryDetected,
    reentrySource,
    reentryReasons,
    reentrySeverity,
    reentryCount: closeoutRecoveredExitHistory.reEntryCount,
    repeatedExitThenReenterPatterns,
    repeatedClearedThenReenterPatterns,
    repeatedRecoveredThenRegressedPatterns,
    reentryRemainsActive,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveredReentryAudit;
}

export function formatSandboxCloseoutRecoveredReentryAudit(
  result: SandboxCloseoutRecoveredReentryAudit,
) {
  return [
    "Sandbox closeout recovered re-entry audit",
    `Latest recovered lifecycle status: ${result.latestRecoveredLifecycleStatus}`,
    `Latest re-entry status: ${result.latestReentryStatus}`,
    `Re-entry detected: ${result.reentryDetected}`,
    `Re-entry source: ${result.reentrySource ?? "none"}`,
    `Re-entry reasons: ${result.reentryReasons.join(" | ") || "none"}`,
    `Re-entry severity: ${result.reentrySeverity}`,
    `Re-entry count: ${result.reentryCount}`,
    `Repeated exit-then-reenter patterns: ${result.repeatedExitThenReenterPatterns.join(" | ") || "none"}`,
    `Repeated cleared-then-reenter patterns: ${result.repeatedClearedThenReenterPatterns.join(" | ") || "none"}`,
    `Repeated recovered-then-regressed patterns: ${result.repeatedRecoveredThenRegressedPatterns.join(" | ") || "none"}`,
    `Re-entry remains active: ${result.reentryRemainsActive}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
