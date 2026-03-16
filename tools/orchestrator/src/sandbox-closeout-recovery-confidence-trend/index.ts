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
  buildSandboxCloseoutWatchlistReAddHistory,
  type SandboxCloseoutWatchlistReAddHistory,
} from "../sandbox-closeout-watchlist-readd-history";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveryConfidenceTrend = {
  latestRecoveryConfidenceLevel:
    SandboxCloseoutRecoveryConfidence["recoveryConfidenceLevel"];
  previousRecoveryConfidenceLevel:
    | SandboxCloseoutRecoveryConfidence["recoveryConfidenceLevel"]
    | "none";
  confidenceTrend:
    | "no_prior_confidence"
    | "improving_to_high_confidence"
    | "stable_but_provisional"
    | "degrading_to_low_confidence"
    | "oscillating_confidence"
    | "stable_high_confidence"
    | "persistently_low_confidence"
    | "recovery_blocked";
  confidenceTrendReasons: string[];
  confidenceImproving: boolean;
  confidenceStable: boolean;
  confidenceDegrading: boolean;
  repeatedProvisionalRecoveredPatterns: string[];
  repeatedLowConfidenceRecoveredPatterns: string[];
  repeatedRecoveredThenLowConfidencePatterns: string[];
  trendRemainsUnresolved: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveryConfidenceTrend(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryConfidence?: SandboxCloseoutRecoveryConfidence;
  closeoutRecoveryRegressionAudit?: SandboxCloseoutRecoveryRegressionAudit;
  closeoutRecoveredMonitoringQueue?: SandboxCloseoutRecoveredMonitoringQueue;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
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
  const closeoutRecoveryConfidence =
    params.closeoutRecoveryConfidence ??
    (await buildSandboxCloseoutRecoveryConfidence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
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
      closeoutWatchlistReAddHistory,
    }));

  const latestRecoveryConfidenceLevel =
    closeoutRecoveryConfidence.recoveryConfidenceLevel;
  const previousRecoveryConfidenceLevel =
    params.state.lastCloseoutRecoveryConfidence?.recoveryConfidenceLevel ??
    "none";
  const repeatedProvisionalRecoveredPatterns =
    latestRecoveryConfidenceLevel === "provisional_recovered" &&
    previousRecoveryConfidenceLevel === "provisional_recovered"
      ? ["provisional_recovered"]
      : [];
  const repeatedLowConfidenceRecoveredPatterns =
    latestRecoveryConfidenceLevel === "low_confidence_recovered" &&
    previousRecoveryConfidenceLevel === "low_confidence_recovered"
      ? ["low_confidence_recovered"]
      : [];
  const repeatedRecoveredThenLowConfidencePatterns =
    latestRecoveryConfidenceLevel === "low_confidence_recovered" &&
    (previousRecoveryConfidenceLevel === "high_confidence_recovered" ||
      previousRecoveryConfidenceLevel === "provisional_recovered")
      ? [
          `${previousRecoveryConfidenceLevel}->${latestRecoveryConfidenceLevel}`,
        ]
      : [];

  let confidenceTrend: SandboxCloseoutRecoveryConfidenceTrend["confidenceTrend"] =
    "no_prior_confidence";
  if (latestRecoveryConfidenceLevel === "recovery_blocked") {
    confidenceTrend = "recovery_blocked";
  } else if (previousRecoveryConfidenceLevel === "none") {
    confidenceTrend =
      latestRecoveryConfidenceLevel === "high_confidence_recovered"
        ? "improving_to_high_confidence"
        : latestRecoveryConfidenceLevel === "provisional_recovered"
          ? "stable_but_provisional"
          : latestRecoveryConfidenceLevel === "low_confidence_recovered"
            ? "persistently_low_confidence"
            : "no_prior_confidence";
  } else if (
    latestRecoveryConfidenceLevel === "high_confidence_recovered" &&
    previousRecoveryConfidenceLevel !== "high_confidence_recovered"
  ) {
    confidenceTrend = "improving_to_high_confidence";
  } else if (
    latestRecoveryConfidenceLevel === "provisional_recovered" &&
    previousRecoveryConfidenceLevel === "provisional_recovered"
  ) {
    confidenceTrend = "stable_but_provisional";
  } else if (
    latestRecoveryConfidenceLevel === "low_confidence_recovered" &&
    (previousRecoveryConfidenceLevel === "high_confidence_recovered" ||
      previousRecoveryConfidenceLevel === "provisional_recovered")
  ) {
    confidenceTrend = "degrading_to_low_confidence";
  } else if (
    latestRecoveryConfidenceLevel === "low_confidence_recovered" &&
    previousRecoveryConfidenceLevel === "low_confidence_recovered"
  ) {
    confidenceTrend = "persistently_low_confidence";
  } else if (
    latestRecoveryConfidenceLevel === "high_confidence_recovered" &&
    previousRecoveryConfidenceLevel === "high_confidence_recovered"
  ) {
    confidenceTrend = "stable_high_confidence";
  } else if (latestRecoveryConfidenceLevel !== previousRecoveryConfidenceLevel) {
    confidenceTrend = "oscillating_confidence";
  }

  const confidenceImproving =
    confidenceTrend === "improving_to_high_confidence";
  const confidenceStable =
    confidenceTrend === "stable_but_provisional" ||
    confidenceTrend === "stable_high_confidence";
  const confidenceDegrading =
    confidenceTrend === "degrading_to_low_confidence" ||
    confidenceTrend === "persistently_low_confidence" ||
    confidenceTrend === "recovery_blocked";
  const trendRemainsUnresolved =
    latestRecoveryConfidenceLevel !== "high_confidence_recovered" ||
    closeoutRecoveryRegressionAudit.regressionDetected ||
    closeoutRecoveryRegressionAudit.regressionRemainsActive ||
    closeoutRecoveredMonitoringQueue.queueStatus !== "empty" ||
    closeoutWatchlistReAddHistory.reAddCount > 0;
  const confidenceTrendReasons = unique([
    ...closeoutRecoveryConfidence.recoveryConfidenceReasons,
    ...closeoutRecoveryConfidence.recoveryConfidenceBlockers,
    ...closeoutRecoveryRegressionAudit.regressionReasons,
    ...closeoutRecoveredMonitoringQueue.monitoringReasons,
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
    ...(confidenceImproving ? ["confidence_improving"] : []),
    ...(confidenceStable ? ["confidence_stable"] : []),
    ...(confidenceDegrading ? ["confidence_degrading"] : []),
  ]);
  const recommendedNextOperatorStep = trendRemainsUnresolved
    ? closeoutRecoveryRegressionAudit.recommendedNextOperatorStep ||
      closeoutRecoveredMonitoringQueue.recommendedNextOperatorStep ||
      closeoutRecoveryConfidence.recommendedNextOperatorStep
    : "recovery_confidence_trend_stable";
  const summaryLine = trendRemainsUnresolved
    ? `Sandbox closeout recovery confidence trend: ${confidenceTrend}; next=${recommendedNextOperatorStep}.`
    : "Sandbox closeout recovery confidence trend: confidence remains high and stable.";

  return {
    latestRecoveryConfidenceLevel,
    previousRecoveryConfidenceLevel,
    confidenceTrend,
    confidenceTrendReasons,
    confidenceImproving,
    confidenceStable,
    confidenceDegrading,
    repeatedProvisionalRecoveredPatterns,
    repeatedLowConfidenceRecoveredPatterns,
    repeatedRecoveredThenLowConfidencePatterns,
    trendRemainsUnresolved,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveryConfidenceTrend;
}

export function formatSandboxCloseoutRecoveryConfidenceTrend(
  result: SandboxCloseoutRecoveryConfidenceTrend,
) {
  return [
    "Sandbox closeout recovery confidence trend",
    `Latest recovery confidence level: ${result.latestRecoveryConfidenceLevel}`,
    `Previous recovery confidence level: ${result.previousRecoveryConfidenceLevel}`,
    `Confidence trend: ${result.confidenceTrend}`,
    `Confidence trend reasons: ${result.confidenceTrendReasons.join(" | ") || "none"}`,
    `Confidence improving: ${result.confidenceImproving}`,
    `Confidence stable: ${result.confidenceStable}`,
    `Confidence degrading: ${result.confidenceDegrading}`,
    `Repeated provisional_recovered patterns: ${result.repeatedProvisionalRecoveredPatterns.join(" | ") || "none"}`,
    `Repeated low_confidence_recovered patterns: ${result.repeatedLowConfidenceRecoveredPatterns.join(" | ") || "none"}`,
    `Repeated recovered_then_low_confidence patterns: ${result.repeatedRecoveredThenLowConfidencePatterns.join(" | ") || "none"}`,
    `Trend remains unresolved: ${result.trendRemainsUnresolved}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
