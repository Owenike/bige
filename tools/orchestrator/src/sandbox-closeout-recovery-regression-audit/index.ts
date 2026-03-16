import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveryConfidence,
  type SandboxCloseoutRecoveryConfidence,
} from "../sandbox-closeout-recovery-confidence";
import {
  buildSandboxCloseoutReopenRecurrence,
  type SandboxCloseoutReopenRecurrence,
} from "../sandbox-closeout-reopen-recurrence";
import {
  buildSandboxCloseoutStabilityDrift,
  type SandboxCloseoutStabilityDrift,
} from "../sandbox-closeout-stability-drift";
import {
  buildSandboxCloseoutStabilityRecoverySummary,
  type SandboxCloseoutStabilityRecoverySummary,
} from "../sandbox-closeout-stability-recovery-summary";
import {
  buildSandboxCloseoutWatchlistReAddHistory,
  type SandboxCloseoutWatchlistReAddHistory,
} from "../sandbox-closeout-watchlist-readd-history";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveryRegressionAudit = {
  latestRecoveryStatus: SandboxCloseoutStabilityRecoverySummary["recoveryStatus"];
  latestRegressionStatus:
    | "none"
    | "recovered_then_drifted"
    | "recovered_then_reopened"
    | "recovered_then_followup_reopened"
    | "recovered_then_watchlist_readded";
  regressionDetected: boolean;
  regressionSource: SandboxCloseoutRecoveryRegressionAudit["latestRegressionStatus"];
  regressionReasons: string[];
  regressionSeverity: "none" | "low" | "medium" | "high";
  regressionCount: number;
  repeatedRecoveredThenRegressedPatterns: string[];
  repeatedExitThenRegressedPatterns: string[];
  repeatedRecoveredThenWatchlistReAddedPatterns: string[];
  repeatedRecoveredThenReopenedPatterns: string[];
  regressionRemainsActive: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveryRegressionAudit(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryConfidence?: SandboxCloseoutRecoveryConfidence;
  closeoutStabilityRecoverySummary?: SandboxCloseoutStabilityRecoverySummary;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
  closeoutStabilityDrift?: SandboxCloseoutStabilityDrift;
  closeoutReopenRecurrence?: SandboxCloseoutReopenRecurrence;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutStabilityDrift =
    params.closeoutStabilityDrift ??
    (await buildSandboxCloseoutStabilityDrift({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutReopenRecurrence =
    params.closeoutReopenRecurrence ??
    (await buildSandboxCloseoutReopenRecurrence({
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
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
    }));
  const closeoutStabilityRecoverySummary =
    params.closeoutStabilityRecoverySummary ??
    (await buildSandboxCloseoutStabilityRecoverySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutWatchlistReAddHistory,
    }));
  const closeoutRecoveryConfidence =
    params.closeoutRecoveryConfidence ??
    (await buildSandboxCloseoutRecoveryConfidence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityRecoverySummary,
      closeoutWatchlistReAddHistory,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
    }));

  let regressionSource: SandboxCloseoutRecoveryRegressionAudit["regressionSource"] =
    "none";
  if (
    closeoutWatchlistReAddHistory.repeatedExitThenReopenPatterns.length > 0 ||
    closeoutReopenRecurrence.reopenRecurrenceActive
  ) {
    regressionSource = "recovered_then_reopened";
  } else if (
    closeoutWatchlistReAddHistory.repeatedExitThenFollowupOpenPatterns.length > 0
  ) {
    regressionSource = "recovered_then_followup_reopened";
  } else if (closeoutWatchlistReAddHistory.reAddCount > 0) {
    regressionSource = "recovered_then_watchlist_readded";
  } else if (
    closeoutStabilityDrift.driftDetected ||
    closeoutWatchlistReAddHistory.repeatedExitThenDriftPatterns.length > 0
  ) {
    regressionSource = "recovered_then_drifted";
  }

  const regressionDetected = regressionSource !== "none";
  const repeatedRecoveredThenRegressedPatterns = unique([
    ...closeoutWatchlistReAddHistory.repeatedReAddPatterns,
    ...closeoutWatchlistReAddHistory.repeatedResolvedThenReAddedPatterns,
    ...closeoutWatchlistReAddHistory.repeatedExitThenDriftPatterns,
    ...closeoutWatchlistReAddHistory.repeatedExitThenFollowupOpenPatterns,
    ...closeoutWatchlistReAddHistory.repeatedExitThenReopenPatterns,
  ]);
  const repeatedExitThenRegressedPatterns = unique([
    ...closeoutWatchlistReAddHistory.repeatedExitThenDriftPatterns,
    ...closeoutWatchlistReAddHistory.repeatedExitThenFollowupOpenPatterns,
    ...closeoutWatchlistReAddHistory.repeatedExitThenReopenPatterns,
  ]);
  const repeatedRecoveredThenWatchlistReAddedPatterns = unique([
    ...closeoutWatchlistReAddHistory.repeatedResolvedThenReAddedPatterns,
    ...closeoutWatchlistReAddHistory.repeatedReAddPatterns,
  ]);
  const repeatedRecoveredThenReopenedPatterns = unique([
    ...closeoutWatchlistReAddHistory.repeatedExitThenReopenPatterns,
  ]);
  const regressionCount = Math.max(
    closeoutWatchlistReAddHistory.reAddCount,
    regressionDetected ? 1 : 0,
  );
  const regressionReasons = unique([
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
    ...closeoutStabilityDrift.driftReasons,
    ...closeoutReopenRecurrence.unresolvedRecurrenceReasons,
    ...(regressionDetected ? [regressionSource] : []),
  ]);

  let regressionSeverity: SandboxCloseoutRecoveryRegressionAudit["regressionSeverity"] =
    "none";
  if (
    repeatedRecoveredThenReopenedPatterns.length > 0 ||
    regressionCount > 1 ||
    closeoutWatchlistReAddHistory.recurrenceSeverity === "high" ||
    closeoutReopenRecurrence.recurrenceSeverity === "high"
  ) {
    regressionSeverity = "high";
  } else if (
    regressionDetected &&
    (closeoutWatchlistReAddHistory.recurrenceSeverity === "medium" ||
      closeoutStabilityDrift.driftSeverity === "high" ||
      repeatedExitThenRegressedPatterns.length > 0)
  ) {
    regressionSeverity = "medium";
  } else if (regressionDetected) {
    regressionSeverity = "low";
  }

  const regressionRemainsActive =
    regressionDetected &&
    (closeoutStabilityDrift.driftDetected ||
      closeoutReopenRecurrence.reopenRecurrenceActive ||
      closeoutStabilityRecoverySummary.watchlistRemainsOpen ||
      closeoutWatchlistReAddHistory.reAddCount > 0 ||
      closeoutRecoveryConfidence.watchlistRemainsOpen);
  const recommendedNextOperatorStep = regressionDetected
    ? closeoutWatchlistReAddHistory.recommendedNextOperatorStep ||
      closeoutStabilityRecoverySummary.recommendedNextOperatorStep
    : closeoutRecoveryConfidence.recommendedNextOperatorStep;
  const summaryLine = regressionDetected
    ? `Sandbox closeout recovery regression audit: ${regressionSource}; severity=${regressionSeverity}; next=${recommendedNextOperatorStep}.`
    : "Sandbox closeout recovery regression audit: no recovery regression detected.";

  return {
    latestRecoveryStatus: closeoutStabilityRecoverySummary.recoveryStatus,
    latestRegressionStatus: regressionSource,
    regressionDetected,
    regressionSource,
    regressionReasons,
    regressionSeverity,
    regressionCount,
    repeatedRecoveredThenRegressedPatterns,
    repeatedExitThenRegressedPatterns,
    repeatedRecoveredThenWatchlistReAddedPatterns,
    repeatedRecoveredThenReopenedPatterns,
    regressionRemainsActive,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveryRegressionAudit;
}

export function formatSandboxCloseoutRecoveryRegressionAudit(
  result: SandboxCloseoutRecoveryRegressionAudit,
) {
  return [
    "Sandbox closeout recovery regression audit",
    `Latest recovery status: ${result.latestRecoveryStatus}`,
    `Latest regression status: ${result.latestRegressionStatus}`,
    `Regression detected: ${result.regressionDetected}`,
    `Regression source: ${result.regressionSource}`,
    `Regression reasons: ${result.regressionReasons.join(" | ") || "none"}`,
    `Regression severity: ${result.regressionSeverity}`,
    `Regression count: ${result.regressionCount}`,
    `Repeated recovered-then-regressed patterns: ${result.repeatedRecoveredThenRegressedPatterns.join(" | ") || "none"}`,
    `Repeated exit-then-regressed patterns: ${result.repeatedExitThenRegressedPatterns.join(" | ") || "none"}`,
    `Repeated recovered-then-watchlist-readded patterns: ${result.repeatedRecoveredThenWatchlistReAddedPatterns.join(" | ") || "none"}`,
    `Repeated recovered-then-reopened patterns: ${result.repeatedRecoveredThenReopenedPatterns.join(" | ") || "none"}`,
    `Regression remains active: ${result.regressionRemainsActive}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
