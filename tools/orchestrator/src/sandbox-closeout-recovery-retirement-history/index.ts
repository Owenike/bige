import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredLifecycle,
  type SandboxCloseoutRecoveredLifecycle,
} from "../sandbox-closeout-recovered-lifecycle";
import {
  buildSandboxCloseoutRecoveredReentryAudit,
  type SandboxCloseoutRecoveredReentryAudit,
} from "../sandbox-closeout-recovered-reentry-audit";
import {
  buildSandboxCloseoutRecoveryRetirementAudit,
  type SandboxCloseoutRecoveryRetirementAudit,
} from "../sandbox-closeout-recovery-retirement-audit";
import {
  buildSandboxCloseoutWatchlistReAddHistory,
  type SandboxCloseoutWatchlistReAddHistory,
} from "../sandbox-closeout-watchlist-readd-history";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function appendHistoryEntry(
  entries: SandboxCloseoutRecoveryRetirementHistoryEntry[],
  nextEntry: SandboxCloseoutRecoveryRetirementHistoryEntry,
  limit: number,
) {
  const lastEntry = entries[entries.length - 1] ?? null;
  if (
    lastEntry &&
    lastEntry.recoveryRetirementStatus === nextEntry.recoveryRetirementStatus &&
    lastEntry.retirementAllowed === nextEntry.retirementAllowed &&
    lastEntry.caseLeavesActiveGovernance ===
      nextEntry.caseLeavesActiveGovernance &&
    lastEntry.caseRemainsReopenable === nextEntry.caseRemainsReopenable &&
    lastEntry.caseRemainsRegressionProne ===
      nextEntry.caseRemainsRegressionProne
  ) {
    return entries.slice(-limit);
  }

  return [...entries, nextEntry].slice(-limit);
}

export type SandboxCloseoutRecoveryRetirementHistoryEntry = {
  recordedAt: string | null;
  recoveryRetirementStatus:
    SandboxCloseoutRecoveryRetirementAudit["recoveryRetirementStatus"];
  retirementAllowed: boolean;
  caseLeavesActiveGovernance: boolean;
  caseRemainsReopenable: boolean;
  caseRemainsRegressionProne: boolean;
  summaryLine: string;
};

export type SandboxCloseoutRecoveryRetirementHistory = {
  entries: SandboxCloseoutRecoveryRetirementHistoryEntry[];
  latestRetirementAuditEntry:
    SandboxCloseoutRecoveryRetirementHistoryEntry | null;
  previousRetirementAuditEntry:
    SandboxCloseoutRecoveryRetirementHistoryEntry | null;
  latestRetirementStatus:
    SandboxCloseoutRecoveryRetirementAudit["recoveryRetirementStatus"];
  repeatedRetirementAllowedPatterns: string[];
  repeatedRetirementBlockedPatterns: string[];
  repeatedRetirementAllowedButReopenablePatterns: string[];
  repeatedRetiredThenReenteredPatterns: string[];
  repeatedRetiredThenRegressedPatterns: string[];
  repeatedRetiredThenWatchlistReaddedPatterns: string[];
  historyRetainedEntryCount: number;
  historyReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveryRetirementHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryRetirementAudit?: SandboxCloseoutRecoveryRetirementAudit;
  closeoutRecoveredReentryAudit?: SandboxCloseoutRecoveredReentryAudit;
  closeoutRecoveredLifecycle?: SandboxCloseoutRecoveredLifecycle;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const persistedHistoryState = params.state as OrchestratorState & {
    lastCloseoutRecoveryRetirementHistory?: {
      entries?: SandboxCloseoutRecoveryRetirementHistoryEntry[];
    } | null;
  };
  const closeoutRecoveryRetirementAudit =
    params.closeoutRecoveryRetirementAudit ??
    (await buildSandboxCloseoutRecoveryRetirementAudit({
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
    }));
  const closeoutRecoveredReentryAudit =
    params.closeoutRecoveredReentryAudit ??
    (await buildSandboxCloseoutRecoveredReentryAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveredLifecycle,
    }));
  const closeoutWatchlistReAddHistory =
    params.closeoutWatchlistReAddHistory ??
    (await buildSandboxCloseoutWatchlistReAddHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));

  const previousEntries =
    persistedHistoryState.lastCloseoutRecoveryRetirementHistory?.entries ?? [];
  const currentEntry = {
    recordedAt: closeoutRecoveryRetirementAudit.auditedAt,
    recoveryRetirementStatus:
      closeoutRecoveryRetirementAudit.recoveryRetirementStatus,
    retirementAllowed: closeoutRecoveryRetirementAudit.retirementAllowed,
    caseLeavesActiveGovernance:
      closeoutRecoveryRetirementAudit.caseLeavesActiveGovernance,
    caseRemainsReopenable:
      closeoutRecoveryRetirementAudit.caseRemainsReopenable,
    caseRemainsRegressionProne:
      closeoutRecoveryRetirementAudit.caseRemainsRegressionProne,
    summaryLine: closeoutRecoveryRetirementAudit.summaryLine,
  } satisfies SandboxCloseoutRecoveryRetirementHistoryEntry;

  const entries = appendHistoryEntry(previousEntries, currentEntry, limit);
  const latestRetirementAuditEntry =
    entries.length > 0 ? entries[entries.length - 1] : null;
  const previousRetirementAuditEntry =
    entries.length > 1 ? entries[entries.length - 2] : null;
  const hadPreviousRetiredEntry = entries
    .slice(0, -1)
    .some((entry) => entry.caseLeavesActiveGovernance);
  const repeatedRetirementAllowedPatterns = unique(
    entries
      .filter((entry) => entry.recoveryRetirementStatus === "retirement_allowed")
      .map((entry) => entry.recoveryRetirementStatus),
  );
  const repeatedRetirementBlockedPatterns = unique(
    entries
      .filter((entry) =>
        entry.recoveryRetirementStatus.startsWith("retirement_blocked"),
      )
      .map((entry) => entry.recoveryRetirementStatus),
  );
  const repeatedRetirementAllowedButReopenablePatterns = unique(
    entries
      .filter(
        (entry) =>
          entry.recoveryRetirementStatus ===
          "retirement_allowed_but_reopenable",
      )
      .map((entry) => entry.recoveryRetirementStatus),
  );
  const repeatedRetiredThenReenteredPatterns = unique([
    ...(hadPreviousRetiredEntry && closeoutRecoveredReentryAudit.reentryDetected
      ? [closeoutRecoveredReentryAudit.latestReentryStatus]
      : []),
    ...closeoutRecoveredReentryAudit.repeatedExitThenReenterPatterns,
    ...closeoutRecoveredReentryAudit.repeatedClearedThenReenterPatterns,
  ]);
  const repeatedRetiredThenRegressedPatterns = unique([
    ...(hadPreviousRetiredEntry && closeoutRecoveredLifecycle.caseHasRegressed
      ? [closeoutRecoveredLifecycle.lifecycleStatus]
      : []),
    ...closeoutRecoveredReentryAudit.repeatedRecoveredThenRegressedPatterns,
  ]);
  const repeatedRetiredThenWatchlistReaddedPatterns = unique([
    ...(hadPreviousRetiredEntry && closeoutWatchlistReAddHistory.reAddCount > 0
      ? [
          closeoutWatchlistReAddHistory.latestReAddEntry?.reAddPattern ??
            "retired_then_watchlist_readded",
        ]
      : []),
    ...closeoutWatchlistReAddHistory.repeatedResolvedThenReAddedPatterns,
    ...closeoutWatchlistReAddHistory.repeatedExitThenReopenPatterns,
    ...closeoutWatchlistReAddHistory.repeatedExitThenFollowupOpenPatterns,
  ]);
  const historyReasons = unique([
    ...closeoutRecoveryRetirementAudit.retirementBlockedReasons,
    ...closeoutRecoveredReentryAudit.reentryReasons,
    ...closeoutRecoveredLifecycle.lifecycleReasons,
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
  ]);
  const recommendedNextOperatorStep =
    closeoutRecoveredReentryAudit.recommendedNextOperatorStep ||
    closeoutRecoveryRetirementAudit.recommendedNextOperatorStep ||
    closeoutWatchlistReAddHistory.recommendedNextOperatorStep;
  const summaryLine =
    repeatedRetiredThenReenteredPatterns.length > 0 ||
    repeatedRetiredThenRegressedPatterns.length > 0 ||
    repeatedRetiredThenWatchlistReaddedPatterns.length > 0
      ? `Sandbox closeout recovery retirement history: latest=${closeoutRecoveryRetirementAudit.recoveryRetirementStatus}, retirement churn observed; next=${recommendedNextOperatorStep}.`
      : `Sandbox closeout recovery retirement history: latest=${closeoutRecoveryRetirementAudit.recoveryRetirementStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    entries,
    latestRetirementAuditEntry,
    previousRetirementAuditEntry,
    latestRetirementStatus:
      closeoutRecoveryRetirementAudit.recoveryRetirementStatus,
    repeatedRetirementAllowedPatterns,
    repeatedRetirementBlockedPatterns,
    repeatedRetirementAllowedButReopenablePatterns,
    repeatedRetiredThenReenteredPatterns,
    repeatedRetiredThenRegressedPatterns,
    repeatedRetiredThenWatchlistReaddedPatterns,
    historyRetainedEntryCount: entries.length,
    historyReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveryRetirementHistory;
}

export function formatSandboxCloseoutRecoveryRetirementHistory(
  result: SandboxCloseoutRecoveryRetirementHistory,
) {
  return [
    "Sandbox closeout recovery retirement history",
    `Latest retirement status: ${result.latestRetirementStatus}`,
    `Latest retirement audit entry: ${result.latestRetirementAuditEntry?.summaryLine ?? "none"}`,
    `Previous retirement audit entry: ${result.previousRetirementAuditEntry?.summaryLine ?? "none"}`,
    `Repeated retirement_allowed patterns: ${result.repeatedRetirementAllowedPatterns.join(" | ") || "none"}`,
    `Repeated retirement_blocked patterns: ${result.repeatedRetirementBlockedPatterns.join(" | ") || "none"}`,
    `Repeated retirement_allowed_but_reopenable patterns: ${result.repeatedRetirementAllowedButReopenablePatterns.join(" | ") || "none"}`,
    `Repeated retired-then-reentered patterns: ${result.repeatedRetiredThenReenteredPatterns.join(" | ") || "none"}`,
    `Repeated retired-then-regressed patterns: ${result.repeatedRetiredThenRegressedPatterns.join(" | ") || "none"}`,
    `Repeated retired-then-watchlist-readded patterns: ${result.repeatedRetiredThenWatchlistReaddedPatterns.join(" | ") || "none"}`,
    `History retained entry count: ${result.historyRetainedEntryCount}`,
    `History reasons: ${result.historyReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
