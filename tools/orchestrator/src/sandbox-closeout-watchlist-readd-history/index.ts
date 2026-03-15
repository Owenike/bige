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
import {
  buildSandboxCloseoutWatchlistExitAudit,
  type SandboxCloseoutWatchlistExitAudit,
  type SandboxCloseoutWatchlistExitAuditEntry,
} from "../sandbox-closeout-watchlist-exit-audit";
import {
  buildSandboxCloseoutWatchlistLifecycle,
  type SandboxCloseoutWatchlistLifecycle,
} from "../sandbox-closeout-watchlist-lifecycle";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

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

export type SandboxCloseoutWatchlistReAddHistoryEntry = {
  addedAt: string | null;
  reAddReason: string | null;
  reAddPattern:
    | "single_re_add"
    | "resolved_then_readded"
    | "exit_then_drift"
    | "exit_then_followup_open"
    | "exit_then_reopen";
  summaryLine: string;
};

export type SandboxCloseoutWatchlistReAddHistory = {
  entries: SandboxCloseoutWatchlistReAddHistoryEntry[];
  latestWatchlistStatus: SandboxCloseoutStabilityWatchlist["watchlistStatus"];
  latestReAddReason: string | null;
  reAddCount: number;
  latestExitAuditEntry: SandboxCloseoutWatchlistExitAuditEntry | null;
  latestReAddEntry: SandboxCloseoutWatchlistReAddHistoryEntry | null;
  repeatedReAddPatterns: string[];
  repeatedResolvedThenReAddedPatterns: string[];
  repeatedExitThenDriftPatterns: string[];
  repeatedExitThenFollowupOpenPatterns: string[];
  repeatedExitThenReopenPatterns: string[];
  recurrenceSeverity: "none" | "low" | "medium" | "high";
  unresolvedReAddReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutWatchlistReAddHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutFinalizationAuditHistory?: SandboxCloseoutFinalizationAuditHistory;
  closeoutStabilityDrift?: SandboxCloseoutStabilityDrift;
  closeoutReopenRecurrence?: SandboxCloseoutReopenRecurrence;
  closeoutStabilityWatchlist?: SandboxCloseoutStabilityWatchlist;
  closeoutWatchlistLifecycle?: SandboxCloseoutWatchlistLifecycle;
  closeoutWatchlistExitAudit?: SandboxCloseoutWatchlistExitAudit;
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
  const closeoutWatchlistLifecycle =
    params.closeoutWatchlistLifecycle ??
    (await buildSandboxCloseoutWatchlistLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
    }));
  const closeoutWatchlistExitAudit =
    params.closeoutWatchlistExitAudit ??
    (await buildSandboxCloseoutWatchlistExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationAuditHistory,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutWatchlistLifecycle,
    }));

  const chronologicalEntries = [...closeoutFinalizationAuditHistory.entries].reverse();
  let hasExited = closeoutWatchlistExitAudit.entries.some((entry) => entry.exitAllowed);
  const readdEntries: SandboxCloseoutWatchlistReAddHistoryEntry[] = [];

  for (const entry of chronologicalEntries) {
    const trigger =
      entry.reopenedAfterFinalization ||
      entry.postFinalizationFollowUpOpen ||
      entry.retainedAfterFinalization;
    if (entry.finalizationStatus === "final_complete" && !trigger) {
      hasExited = true;
      continue;
    }
    if (!hasExited || !trigger) {
      continue;
    }
    let reAddPattern: SandboxCloseoutWatchlistReAddHistoryEntry["reAddPattern"] =
      "single_re_add";
    let reAddReason = "watchlist_readded";
    if (entry.reopenedAfterFinalization) {
      reAddPattern = "exit_then_reopen";
      reAddReason = "reopened_after_finalization";
    } else if (entry.postFinalizationFollowUpOpen) {
      reAddPattern = "exit_then_followup_open";
      reAddReason = "post_finalization_followup_open";
    } else if (entry.retainedAfterFinalization) {
      reAddPattern = "exit_then_drift";
      reAddReason = "carry_forward_retained_again";
    }
    if (readdEntries.length > 0) {
      reAddPattern = "resolved_then_readded";
    }
    readdEntries.push({
      addedAt: entry.auditedAt,
      reAddReason,
      reAddPattern,
      summaryLine: `Watchlist re-add history: ${reAddPattern} at ${entry.auditedAt ?? "unknown time"}.`,
    });
  }

  if (
    readdEntries.length === 0 &&
    closeoutWatchlistLifecycle.watchlistReAdded
  ) {
    readdEntries.push({
      addedAt: closeoutWatchlistExitAudit.auditedAt,
      reAddReason:
        closeoutStabilityDrift.driftReasons[0] ??
        closeoutReopenRecurrence.unresolvedRecurrenceReasons[0] ??
        closeoutStabilityWatchlist.watchlistReasons[0] ??
        "watchlist_readded",
      reAddPattern: "single_re_add",
      summaryLine: "Watchlist re-add history: active watchlist re-add remains unresolved.",
    });
  }

  const entries = readdEntries.reverse().slice(0, limit);
  const repeatedReAddPatterns = collectRepeated(entries.map((entry) => entry.summaryLine));
  const repeatedResolvedThenReAddedPatterns = collectRepeated(
    entries
      .filter((entry) => entry.reAddPattern === "resolved_then_readded")
      .map((entry) => entry.summaryLine),
  );
  const repeatedExitThenDriftPatterns = collectRepeated(
    entries
      .filter((entry) => entry.reAddPattern === "exit_then_drift")
      .map((entry) => entry.summaryLine),
  );
  const repeatedExitThenFollowupOpenPatterns = collectRepeated(
    entries
      .filter((entry) => entry.reAddPattern === "exit_then_followup_open")
      .map((entry) => entry.summaryLine),
  );
  const repeatedExitThenReopenPatterns = unique([
    ...collectRepeated(
      entries
        .filter((entry) => entry.reAddPattern === "exit_then_reopen")
        .map((entry) => entry.summaryLine),
    ),
    ...closeoutReopenRecurrence.repeatedFinalizedThenReopenedPatterns,
  ]);
  const unresolvedReAddReasons = unique([
    ...entries.map((entry) => entry.reAddReason ?? ""),
    ...closeoutStabilityDrift.driftReasons,
    ...closeoutReopenRecurrence.unresolvedRecurrenceReasons,
    ...closeoutStabilityWatchlist.watchlistReasons,
  ]);

  let recurrenceSeverity: SandboxCloseoutWatchlistReAddHistory["recurrenceSeverity"] =
    "none";
  if (
    entries.length > 1 ||
    repeatedResolvedThenReAddedPatterns.length > 0 ||
    repeatedExitThenReopenPatterns.length > 0
  ) {
    recurrenceSeverity = "high";
  } else if (
    entries.length === 1 ||
    repeatedExitThenDriftPatterns.length > 0 ||
    repeatedExitThenFollowupOpenPatterns.length > 0 ||
    closeoutWatchlistLifecycle.watchlistReAdded
  ) {
    recurrenceSeverity = "medium";
  } else if (closeoutWatchlistLifecycle.watchlistActive) {
    recurrenceSeverity = "low";
  }

  const latestReAddEntry = entries[0] ?? null;
  const recommendedNextOperatorStep =
    closeoutWatchlistLifecycle.recommendedNextOperatorStep ||
    "stability_watchlist_reassess";
  const summaryLine =
    latestReAddEntry === null
      ? "Sandbox closeout watchlist re-add history: no watchlist re-add has been detected."
      : `Sandbox closeout watchlist re-add history: count=${entries.length}, severity=${recurrenceSeverity}, next=${recommendedNextOperatorStep}.`;

  return {
    entries,
    latestWatchlistStatus: closeoutStabilityWatchlist.watchlistStatus,
    latestReAddReason: latestReAddEntry?.reAddReason ?? null,
    reAddCount: entries.length,
    latestExitAuditEntry: closeoutWatchlistExitAudit.latestExitAuditEntry,
    latestReAddEntry,
    repeatedReAddPatterns,
    repeatedResolvedThenReAddedPatterns,
    repeatedExitThenDriftPatterns,
    repeatedExitThenFollowupOpenPatterns,
    repeatedExitThenReopenPatterns,
    recurrenceSeverity,
    unresolvedReAddReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutWatchlistReAddHistory;
}

export function formatSandboxCloseoutWatchlistReAddHistory(
  result: SandboxCloseoutWatchlistReAddHistory,
) {
  return [
    "Sandbox closeout watchlist re-add history",
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Latest re-add reason: ${result.latestReAddReason ?? "none"}`,
    `Re-add count: ${result.reAddCount}`,
    `Latest exit audit entry: ${result.latestExitAuditEntry?.auditedAt ?? "none"} ${result.latestExitAuditEntry?.summaryLine ?? ""}`.trimEnd(),
    `Latest re-add entry: ${result.latestReAddEntry?.addedAt ?? "none"} ${result.latestReAddEntry?.summaryLine ?? ""}`.trimEnd(),
    `Repeated re-add patterns: ${result.repeatedReAddPatterns.join(" | ") || "none"}`,
    `Repeated resolved-then-readded patterns: ${result.repeatedResolvedThenReAddedPatterns.join(" | ") || "none"}`,
    `Repeated exit-then-drift patterns: ${result.repeatedExitThenDriftPatterns.join(" | ") || "none"}`,
    `Repeated exit-then-followup-open patterns: ${result.repeatedExitThenFollowupOpenPatterns.join(" | ") || "none"}`,
    `Repeated exit-then-reopen patterns: ${result.repeatedExitThenReopenPatterns.join(" | ") || "none"}`,
    `Recurrence severity: ${result.recurrenceSeverity}`,
    `Unresolved re-add reasons: ${result.unresolvedReAddReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
