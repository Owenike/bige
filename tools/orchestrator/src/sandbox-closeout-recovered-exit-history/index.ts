import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredMonitoringExitAudit,
  type SandboxCloseoutRecoveredMonitoringExitAudit,
} from "../sandbox-closeout-recovered-monitoring-exit-audit";
import {
  buildSandboxCloseoutRecoveryClearanceAudit,
  type SandboxCloseoutRecoveryClearanceAudit,
} from "../sandbox-closeout-recovery-clearance-audit";
import {
  buildSandboxCloseoutRegressionResolutionSummary,
  type SandboxCloseoutRegressionResolutionSummary,
} from "../sandbox-closeout-regression-resolution-summary";
import {
  buildSandboxCloseoutWatchlistReAddHistory,
  type SandboxCloseoutWatchlistReAddHistory,
} from "../sandbox-closeout-watchlist-readd-history";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveredExitHistoryEntry = {
  entryType: "exit" | "re_entry";
  recordedAt: string | null;
  status: string;
  reason: string | null;
  pattern:
    | "single_exit"
    | "repeated_exit"
    | "exit_then_reenter"
    | "cleared_then_reopened"
    | "cleared_then_watchlist_readded"
    | "cleared_then_followup_reopened";
  summaryLine: string;
};

export type SandboxCloseoutRecoveredExitHistory = {
  entries: SandboxCloseoutRecoveredExitHistoryEntry[];
  latestMonitoringExitStatus:
    SandboxCloseoutRecoveredMonitoringExitAudit["monitoringExitStatus"];
  latestClearanceStatus:
    SandboxCloseoutRecoveryClearanceAudit["recoveryClearanceStatus"];
  exitCount: number;
  reEntryCount: number;
  latestExitEntry: SandboxCloseoutRecoveredExitHistoryEntry | null;
  latestReEntryEntry: SandboxCloseoutRecoveredExitHistoryEntry | null;
  repeatedExitThenReEnterPatterns: string[];
  repeatedExitThenRegressionPatterns: string[];
  repeatedExitThenWatchlistReAddPatterns: string[];
  repeatedClearedThenReopenedPatterns: string[];
  repeatedClearedThenFollowupReopenedPatterns: string[];
  historyRetainedEntryCount: number;
  historySeverity: "none" | "low" | "medium" | "high";
  historyReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

function appendHistoryEntry(
  entries: SandboxCloseoutRecoveredExitHistoryEntry[],
  nextEntry: SandboxCloseoutRecoveredExitHistoryEntry | null,
  limit: number,
) {
  if (nextEntry === null) return entries.slice(0, limit);
  const lastEntry = entries[entries.length - 1] ?? null;
  if (
    lastEntry &&
    lastEntry.entryType === nextEntry.entryType &&
    lastEntry.status === nextEntry.status &&
    lastEntry.pattern === nextEntry.pattern &&
    lastEntry.reason === nextEntry.reason
  ) {
    return entries.slice(-limit);
  }
  return [...entries, nextEntry].slice(-limit);
}

export async function buildSandboxCloseoutRecoveredExitHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveredMonitoringExitAudit?: SandboxCloseoutRecoveredMonitoringExitAudit;
  closeoutRecoveryClearanceAudit?: SandboxCloseoutRecoveryClearanceAudit;
  closeoutRegressionResolutionSummary?: SandboxCloseoutRegressionResolutionSummary;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const closeoutWatchlistReAddHistory =
    params.closeoutWatchlistReAddHistory ??
    (await buildSandboxCloseoutWatchlistReAddHistory({
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
  const closeoutRecoveryClearanceAudit =
    params.closeoutRecoveryClearanceAudit ??
    (await buildSandboxCloseoutRecoveryClearanceAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveredMonitoringExitAudit,
      closeoutRegressionResolutionSummary,
      closeoutWatchlistReAddHistory,
    }));

  const previousEntries =
    params.state.lastCloseoutRecoveredExitHistory?.entries ?? [];
  const currentExitEntry =
    closeoutRecoveredMonitoringExitAudit.monitoringExitAllowed ||
    closeoutRecoveryClearanceAudit.recoveryClearanceAllowed
      ? ({
          entryType: "exit",
          recordedAt:
            closeoutRecoveryClearanceAudit.auditedAt ??
            closeoutRecoveredMonitoringExitAudit.auditedAt,
          status: closeoutRecoveryClearanceAudit.recoveryClearanceStatus,
          reason:
            closeoutRecoveryClearanceAudit.caseRemainsReopenable
              ? "case_remains_reopenable"
              : null,
          pattern:
            (previousEntries.filter((entry) => entry.entryType === "exit").length >
            0
              ? "repeated_exit"
              : "single_exit") as SandboxCloseoutRecoveredExitHistoryEntry["pattern"],
          summaryLine: `Recovered exit history: ${closeoutRecoveryClearanceAudit.recoveryClearanceStatus}.`,
        } satisfies SandboxCloseoutRecoveredExitHistoryEntry)
      : null;
  const currentReEntryPattern: SandboxCloseoutRecoveredExitHistoryEntry["pattern"] =
    closeoutRegressionResolutionSummary.latestRegressionStatus ===
    "recovered_then_followup_reopened"
      ? "cleared_then_followup_reopened"
      : closeoutRegressionResolutionSummary.latestRegressionStatus ===
            "recovered_then_reopened"
          ? "cleared_then_reopened"
        : closeoutWatchlistReAddHistory.reAddCount > 0
          ? "cleared_then_watchlist_readded"
          : "exit_then_reenter";
  const currentReEntryReason =
    closeoutWatchlistReAddHistory.latestReAddReason ??
    closeoutRegressionResolutionSummary.regressionBlockers[0] ??
    null;
  const currentReEntry =
    closeoutRegressionResolutionSummary.regressionRemainsActive ||
    closeoutWatchlistReAddHistory.reAddCount > 0
      ? ({
          entryType: "re_entry",
          recordedAt:
            closeoutRecoveryClearanceAudit.auditedAt ??
            closeoutRecoveredMonitoringExitAudit.auditedAt,
          status: closeoutRegressionResolutionSummary.regressionResolutionStatus,
          reason: currentReEntryReason,
          pattern: currentReEntryPattern,
          summaryLine: `Recovered exit history: ${currentReEntryPattern}; reason=${currentReEntryReason ?? "none"}.`,
        } satisfies SandboxCloseoutRecoveredExitHistoryEntry)
      : null;

  let entries = appendHistoryEntry(previousEntries, currentExitEntry, limit);
  entries = appendHistoryEntry(entries, currentReEntry, limit);

  const exitEntries = entries.filter((entry) => entry.entryType === "exit");
  const reEntryEntries = entries.filter((entry) => entry.entryType === "re_entry");
  const latestExitEntry =
    exitEntries.length > 0 ? exitEntries[exitEntries.length - 1] : null;
  const latestReEntryEntry =
    reEntryEntries.length > 0 ? reEntryEntries[reEntryEntries.length - 1] : null;
  const repeatedExitThenReEnterPatterns = unique([
    ...entries
      .filter((entry) => entry.pattern === "exit_then_reenter")
      .map((entry) => entry.pattern),
  ]);
  const repeatedExitThenRegressionPatterns = unique([
    closeoutRegressionResolutionSummary.latestRegressionStatus ===
    "recovered_then_drifted"
      ? "exit_then_regression"
      : "",
    closeoutRegressionResolutionSummary.latestRegressionStatus ===
    "recovered_then_reopened"
      ? "exit_then_regression"
      : "",
  ]);
  const repeatedExitThenWatchlistReAddPatterns = unique([
    ...closeoutWatchlistReAddHistory.repeatedResolvedThenReAddedPatterns,
    ...entries
      .filter((entry) => entry.pattern === "cleared_then_watchlist_readded")
      .map((entry) => entry.pattern),
  ]);
  const repeatedClearedThenReopenedPatterns = unique([
    ...closeoutWatchlistReAddHistory.repeatedExitThenReopenPatterns,
    ...entries
      .filter((entry) => entry.pattern === "cleared_then_reopened")
      .map((entry) => entry.pattern),
  ]);
  const repeatedClearedThenFollowupReopenedPatterns = unique([
    ...closeoutWatchlistReAddHistory.repeatedExitThenFollowupOpenPatterns,
    ...entries
      .filter((entry) => entry.pattern === "cleared_then_followup_reopened")
      .map((entry) => entry.pattern),
  ]);
  const historyReasons = unique([
    ...closeoutRecoveryClearanceAudit.recoveryClearanceBlockedReasons,
    ...closeoutRegressionResolutionSummary.regressionBlockers,
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
    ...(latestReEntryEntry?.reason ? [latestReEntryEntry.reason] : []),
  ]);
  const historySeverity =
    reEntryEntries.length > 1 ||
    repeatedClearedThenReopenedPatterns.length > 0 ||
    repeatedExitThenWatchlistReAddPatterns.length > 0
      ? "high"
      : reEntryEntries.length === 1 ||
          repeatedExitThenRegressionPatterns.length > 0
        ? "medium"
        : exitEntries.length > 1
          ? "low"
          : "none";
  const recommendedNextOperatorStep =
    latestReEntryEntry !== null
      ? closeoutRegressionResolutionSummary.recommendedNextOperatorStep ||
        closeoutRecoveryClearanceAudit.recommendedNextOperatorStep
      : closeoutRecoveryClearanceAudit.recommendedNextOperatorStep;
  const summaryLine =
    latestReEntryEntry !== null
      ? `Sandbox closeout recovered exit history: re-entry=${latestReEntryEntry.pattern}; next=${recommendedNextOperatorStep}.`
      : `Sandbox closeout recovered exit history: exits=${exitEntries.length}; next=${recommendedNextOperatorStep}.`;

  return {
    entries,
    latestMonitoringExitStatus:
      closeoutRecoveredMonitoringExitAudit.monitoringExitStatus,
    latestClearanceStatus:
      closeoutRecoveryClearanceAudit.recoveryClearanceStatus,
    exitCount: exitEntries.length,
    reEntryCount: reEntryEntries.length,
    latestExitEntry,
    latestReEntryEntry,
    repeatedExitThenReEnterPatterns,
    repeatedExitThenRegressionPatterns,
    repeatedExitThenWatchlistReAddPatterns,
    repeatedClearedThenReopenedPatterns,
    repeatedClearedThenFollowupReopenedPatterns,
    historyRetainedEntryCount: entries.length,
    historySeverity,
    historyReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveredExitHistory;
}

export function formatSandboxCloseoutRecoveredExitHistory(
  result: SandboxCloseoutRecoveredExitHistory,
) {
  return [
    "Sandbox closeout recovered exit history",
    `Latest monitoring exit status: ${result.latestMonitoringExitStatus}`,
    `Latest clearance status: ${result.latestClearanceStatus}`,
    `Exit count: ${result.exitCount}`,
    `Re-entry count: ${result.reEntryCount}`,
    `Latest exit entry: ${result.latestExitEntry?.summaryLine ?? "none"}`,
    `Latest re-entry entry: ${result.latestReEntryEntry?.summaryLine ?? "none"}`,
    `Repeated exit-then-reenter patterns: ${result.repeatedExitThenReEnterPatterns.join(" | ") || "none"}`,
    `Repeated exit-then-regression patterns: ${result.repeatedExitThenRegressionPatterns.join(" | ") || "none"}`,
    `Repeated exit-then-watchlist-readd patterns: ${result.repeatedExitThenWatchlistReAddPatterns.join(" | ") || "none"}`,
    `Repeated cleared-then-reopened patterns: ${result.repeatedClearedThenReopenedPatterns.join(" | ") || "none"}`,
    `Repeated cleared-then-followup-reopened patterns: ${result.repeatedClearedThenFollowupReopenedPatterns.join(" | ") || "none"}`,
    `History retained entry count: ${result.historyRetainedEntryCount}`,
    `History severity: ${result.historySeverity}`,
    `History reasons: ${result.historyReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
