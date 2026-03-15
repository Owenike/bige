import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutFinalizationAuditHistory,
  type SandboxCloseoutFinalizationAuditHistory,
} from "../sandbox-closeout-finalization-audit-history";
import {
  buildSandboxCloseoutReopenRecurrence,
  type SandboxCloseoutReopenRecurrence,
} from "../sandbox-closeout-reopen-recurrence";
import {
  buildSandboxCloseoutStabilityDrift,
  type SandboxCloseoutStabilityDrift,
} from "../sandbox-closeout-stability-drift";
import {
  buildSandboxCloseoutStabilityWatchlist,
  type SandboxCloseoutStabilityWatchlist,
} from "../sandbox-closeout-stability-watchlist";

function collectRepeated(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value]) => value);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutStabilityRecurrenceAudit = {
  latestDriftStatus: SandboxCloseoutStabilityDrift["driftSource"];
  latestReopenRecurrenceStatus:
    SandboxCloseoutReopenRecurrence["latestReopenStatus"];
  latestWatchlistStatus: SandboxCloseoutStabilityWatchlist["watchlistStatus"];
  driftOccurrenceCount: number;
  reopenRecurrenceCount: number;
  watchlistReAddCount: number;
  repeatedDriftPatterns: string[];
  repeatedReopenAfterFinalizationPatterns: string[];
  repeatedWatchlistRetainedPatterns: string[];
  repeatedWatchlistReAddedPatterns: string[];
  recurrenceSeverity: "none" | "low" | "medium" | "high";
  recurrenceReasons: string[];
  recurrenceRemainsActive: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutStabilityRecurrenceAudit(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutStabilityDrift?: SandboxCloseoutStabilityDrift;
  closeoutReopenRecurrence?: SandboxCloseoutReopenRecurrence;
  closeoutStabilityWatchlist?: SandboxCloseoutStabilityWatchlist;
  closeoutFinalizationAuditHistory?: SandboxCloseoutFinalizationAuditHistory;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutFinalizationAuditHistory =
    params.closeoutFinalizationAuditHistory ??
    (await buildSandboxCloseoutFinalizationAuditHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutStabilityDrift =
    params.closeoutStabilityDrift ??
    (await buildSandboxCloseoutStabilityDrift({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationAuditHistory,
    }));
  const closeoutReopenRecurrence =
    params.closeoutReopenRecurrence ??
    (await buildSandboxCloseoutReopenRecurrence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationAuditHistory,
    }));
  const closeoutStabilityWatchlist =
    params.closeoutStabilityWatchlist ??
    (await buildSandboxCloseoutStabilityWatchlist({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
    }));

  const driftEntries = closeoutFinalizationAuditHistory.entries.filter(
    (entry) =>
      entry.reopenedAfterFinalization ||
      entry.postFinalizationFollowUpOpen ||
      entry.retainedAfterFinalization,
  );
  const driftOccurrenceCount = Math.max(
    driftEntries.length,
    closeoutStabilityDrift.driftDetected ? 1 : 0,
  );
  const watchlistReAddCount = closeoutFinalizationAuditHistory.entries.filter(
    (entry) =>
      entry.reopenedAfterFinalization ||
      entry.retainedAfterFinalization ||
      entry.postFinalizationFollowUpOpen,
  ).length;

  const repeatedDriftPatterns = unique([
    ...collectRepeated(driftEntries.map((entry) => entry.summaryLine)),
    ...closeoutFinalizationAuditHistory.repeatedRetainedAfterFinalizationPatterns,
    ...closeoutFinalizationAuditHistory.repeatedPostFinalizationFollowUpOpenPatterns,
  ]);
  const repeatedReopenAfterFinalizationPatterns = unique([
    ...closeoutFinalizationAuditHistory.repeatedReopenedAfterFinalizationPatterns,
    ...closeoutReopenRecurrence.repeatedFinalizedThenReopenedPatterns,
  ]);
  const repeatedWatchlistRetainedPatterns = unique([
    ...closeoutFinalizationAuditHistory.repeatedRetainedAfterFinalizationPatterns,
    ...collectRepeated(
      closeoutFinalizationAuditHistory.entries
        .filter((entry) => entry.retainedAfterFinalization)
        .map((entry) => entry.carryForwardSnapshot.summaryLine),
    ),
  ]);
  const repeatedWatchlistReAddedPatterns = unique([
    ...closeoutFinalizationAuditHistory.repeatedReopenedAfterFinalizationPatterns,
    ...closeoutFinalizationAuditHistory.repeatedPostFinalizationFollowUpOpenPatterns,
    ...collectRepeated(
      closeoutFinalizationAuditHistory.entries
        .filter((entry) => entry.reopenedAfterFinalization || entry.postFinalizationFollowUpOpen)
        .map((entry) => entry.summaryLine),
    ),
  ]);

  const recurrenceReasons = unique([
    ...closeoutStabilityDrift.driftReasons,
    ...closeoutReopenRecurrence.unresolvedRecurrenceReasons,
    ...closeoutStabilityWatchlist.watchlistReasons,
    ...(watchlistReAddCount > 0 ? [`watchlist_readd_count:${watchlistReAddCount}`] : []),
  ]);
  const recurrenceRemainsActive =
    closeoutStabilityDrift.driftDetected ||
    closeoutReopenRecurrence.reopenRecurrenceActive ||
    closeoutStabilityWatchlist.watchlistStatus !== "empty";

  let recurrenceSeverity: SandboxCloseoutStabilityRecurrenceAudit["recurrenceSeverity"] =
    "none";
  if (
    repeatedReopenAfterFinalizationPatterns.length > 0 ||
    repeatedWatchlistReAddedPatterns.length > 0 ||
    closeoutReopenRecurrence.recurrenceSeverity === "high"
  ) {
    recurrenceSeverity = "high";
  } else if (
    repeatedDriftPatterns.length > 0 ||
    repeatedWatchlistRetainedPatterns.length > 0 ||
    closeoutStabilityDrift.driftSeverity === "high" ||
    closeoutReopenRecurrence.recurrenceSeverity === "medium"
  ) {
    recurrenceSeverity = "medium";
  } else if (
    recurrenceRemainsActive ||
    driftOccurrenceCount > 0 ||
    closeoutReopenRecurrence.reopenCount > 0
  ) {
    recurrenceSeverity = "low";
  }

  const recommendedNextOperatorStep =
    closeoutStabilityWatchlist.recommendedNextOperatorStep ||
    closeoutStabilityDrift.recommendedNextOperatorStep ||
    closeoutReopenRecurrence.recommendedNextOperatorStep;
  const summaryLine =
    recurrenceRemainsActive
      ? `Sandbox closeout stability recurrence audit: severity=${recurrenceSeverity}, drift=${driftOccurrenceCount}, reopen=${closeoutReopenRecurrence.reopenCount}, watchlistReAdd=${watchlistReAddCount}; next=${recommendedNextOperatorStep}.`
      : "Sandbox closeout stability recurrence audit: no active recurrence remains.";

  return {
    latestDriftStatus: closeoutStabilityDrift.driftSource,
    latestReopenRecurrenceStatus: closeoutReopenRecurrence.latestReopenStatus,
    latestWatchlistStatus: closeoutStabilityWatchlist.watchlistStatus,
    driftOccurrenceCount,
    reopenRecurrenceCount: closeoutReopenRecurrence.reopenCount,
    watchlistReAddCount,
    repeatedDriftPatterns,
    repeatedReopenAfterFinalizationPatterns,
    repeatedWatchlistRetainedPatterns,
    repeatedWatchlistReAddedPatterns,
    recurrenceSeverity,
    recurrenceReasons,
    recurrenceRemainsActive,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutStabilityRecurrenceAudit;
}

export function formatSandboxCloseoutStabilityRecurrenceAudit(
  result: SandboxCloseoutStabilityRecurrenceAudit,
) {
  return [
    "Sandbox closeout stability recurrence audit",
    `Latest drift status: ${result.latestDriftStatus}`,
    `Latest reopen recurrence status: ${result.latestReopenRecurrenceStatus}`,
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Drift occurrence count: ${result.driftOccurrenceCount}`,
    `Reopen recurrence count: ${result.reopenRecurrenceCount}`,
    `Watchlist re-add count: ${result.watchlistReAddCount}`,
    `Repeated drift patterns: ${result.repeatedDriftPatterns.join(" | ") || "none"}`,
    `Repeated reopen-after-finalization patterns: ${result.repeatedReopenAfterFinalizationPatterns.join(" | ") || "none"}`,
    `Repeated watchlist-retained patterns: ${result.repeatedWatchlistRetainedPatterns.join(" | ") || "none"}`,
    `Repeated watchlist-readded patterns: ${result.repeatedWatchlistReAddedPatterns.join(" | ") || "none"}`,
    `Recurrence severity: ${result.recurrenceSeverity}`,
    `Recurrence reasons: ${result.recurrenceReasons.join(" | ") || "none"}`,
    `Recurrence remains active: ${result.recurrenceRemainsActive}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
