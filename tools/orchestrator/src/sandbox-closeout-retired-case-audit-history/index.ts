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
  buildSandboxCloseoutRecoveryRegressionAudit,
  type SandboxCloseoutRecoveryRegressionAudit,
} from "../sandbox-closeout-recovery-regression-audit";
import {
  buildSandboxCloseoutRecoveryRetirementHistory,
  type SandboxCloseoutRecoveryRetirementHistory,
} from "../sandbox-closeout-recovery-retirement-history";
import {
  buildSandboxCloseoutWatchlistReAddHistory,
  type SandboxCloseoutWatchlistReAddHistory,
} from "../sandbox-closeout-watchlist-readd-history";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function appendAuditEntry(
  entries: SandboxCloseoutRetiredCaseAuditHistoryEntry[],
  nextEntry: SandboxCloseoutRetiredCaseAuditHistoryEntry | null,
  limit: number,
) {
  if (nextEntry === null) {
    return entries.slice(-limit);
  }
  const lastEntry = entries[entries.length - 1] ?? null;
  if (
    lastEntry &&
    lastEntry.postRetirementStatus === nextEntry.postRetirementStatus &&
    lastEntry.latestReentryStatus === nextEntry.latestReentryStatus &&
    lastEntry.latestRegressionStatus === nextEntry.latestRegressionStatus &&
    lastEntry.latestWatchlistReaddStatus ===
      nextEntry.latestWatchlistReaddStatus &&
    lastEntry.retiredCaseStateRemainsStable ===
      nextEntry.retiredCaseStateRemainsStable
  ) {
    return entries.slice(-limit);
  }

  return [...entries, nextEntry].slice(-limit);
}

export type SandboxCloseoutRetiredCaseAuditHistoryEntry = {
  recordedAt: string | null;
  postRetirementStatus:
    | "not_retired"
    | "retired_and_stable"
    | "retired_then_reentered"
    | "retired_then_regressed"
    | "retired_then_readded";
  latestReentryStatus: string | null;
  latestRegressionStatus:
    SandboxCloseoutRecoveryRegressionAudit["latestRegressionStatus"];
  latestWatchlistReaddStatus: string | null;
  retiredCaseStateRemainsStable: boolean;
  summaryLine: string;
};

export type SandboxCloseoutRetiredCaseAuditHistory = {
  entries: SandboxCloseoutRetiredCaseAuditHistoryEntry[];
  latestRetiredCaseAuditEntry:
    SandboxCloseoutRetiredCaseAuditHistoryEntry | null;
  previousRetiredCaseAuditEntry:
    SandboxCloseoutRetiredCaseAuditHistoryEntry | null;
  latestPostRetirementStatus:
    SandboxCloseoutRetiredCaseAuditHistoryEntry["postRetirementStatus"];
  latestReentryStatus: string | null;
  latestRegressionStatus:
    SandboxCloseoutRecoveryRegressionAudit["latestRegressionStatus"];
  latestWatchlistReaddStatus: string | null;
  repeatedRetiredThenReenteredPatterns: string[];
  repeatedRetiredThenRegressedPatterns: string[];
  repeatedRetiredThenWatchlistReaddedPatterns: string[];
  retiredCaseStateRemainsStable: boolean;
  historyRetainedEntryCount: number;
  auditReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRetiredCaseAuditHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryRetirementHistory?: SandboxCloseoutRecoveryRetirementHistory;
  closeoutRecoveredExitHistory?: SandboxCloseoutRecoveredExitHistory;
  closeoutRecoveredLifecycle?: SandboxCloseoutRecoveredLifecycle;
  closeoutRecoveryRegressionAudit?: SandboxCloseoutRecoveryRegressionAudit;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const persistedHistoryState = params.state as OrchestratorState & {
    lastCloseoutRetiredCaseAuditHistory?: {
      entries?: SandboxCloseoutRetiredCaseAuditHistoryEntry[];
    } | null;
  };
  const closeoutWatchlistReAddHistory =
    params.closeoutWatchlistReAddHistory ??
    (await buildSandboxCloseoutWatchlistReAddHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutRecoveryRegressionAudit =
    params.closeoutRecoveryRegressionAudit ??
    (await buildSandboxCloseoutRecoveryRegressionAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutWatchlistReAddHistory,
    }));
  const closeoutRecoveredExitHistory =
    params.closeoutRecoveredExitHistory ??
    (await buildSandboxCloseoutRecoveredExitHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutWatchlistReAddHistory,
    }));
  const closeoutRecoveredLifecycle =
    params.closeoutRecoveredLifecycle ??
    (await buildSandboxCloseoutRecoveredLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveredExitHistory,
    }));
  const closeoutRecoveryRetirementHistory =
    params.closeoutRecoveryRetirementHistory ??
    (await buildSandboxCloseoutRecoveryRetirementHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveredLifecycle,
      closeoutWatchlistReAddHistory,
    }));

  const previousEntries =
    persistedHistoryState.lastCloseoutRetiredCaseAuditHistory?.entries ?? [];
  const hasRetiredEntry =
    closeoutRecoveryRetirementHistory.entries.some(
      (entry) => entry.caseLeavesActiveGovernance,
    ) ||
    closeoutRecoveryRetirementHistory.latestRetirementStatus ===
      "retirement_allowed";

  let postRetirementStatus: SandboxCloseoutRetiredCaseAuditHistoryEntry["postRetirementStatus"] =
    "not_retired";
  if (hasRetiredEntry) {
    if (closeoutRecoveryRegressionAudit.regressionDetected) {
      postRetirementStatus = "retired_then_regressed";
    } else if (closeoutWatchlistReAddHistory.reAddCount > 0) {
      postRetirementStatus = "retired_then_readded";
    } else if (
      closeoutRecoveredExitHistory.reEntryCount > 0 ||
      closeoutRecoveredLifecycle.caseHasReEnteredGovernance
    ) {
      postRetirementStatus = "retired_then_reentered";
    } else {
      postRetirementStatus = "retired_and_stable";
    }
  }

  const retiredCaseStateRemainsStable =
    hasRetiredEntry && postRetirementStatus === "retired_and_stable";
  const currentEntry = hasRetiredEntry
    ? ({
        recordedAt:
          closeoutRecoveryRetirementHistory.latestRetirementAuditEntry
            ?.recordedAt ??
          closeoutWatchlistReAddHistory.latestReAddEntry?.addedAt ??
          null,
        postRetirementStatus,
        latestReentryStatus:
          closeoutRecoveredExitHistory.latestReEntryEntry?.pattern ?? null,
        latestRegressionStatus:
          closeoutRecoveryRegressionAudit.latestRegressionStatus,
        latestWatchlistReaddStatus:
          closeoutWatchlistReAddHistory.latestReAddEntry?.reAddPattern ?? null,
        retiredCaseStateRemainsStable,
        summaryLine: `Retired case audit history: ${postRetirementStatus}.`,
      } satisfies SandboxCloseoutRetiredCaseAuditHistoryEntry)
    : null;

  const entries = appendAuditEntry(previousEntries, currentEntry, limit);
  const latestRetiredCaseAuditEntry =
    entries.length > 0 ? entries[entries.length - 1] : null;
  const previousRetiredCaseAuditEntry =
    entries.length > 1 ? entries[entries.length - 2] : null;
  const repeatedRetiredThenReenteredPatterns = unique([
    ...closeoutRecoveryRetirementHistory.repeatedRetiredThenReenteredPatterns,
    ...closeoutRecoveredExitHistory.repeatedExitThenReEnterPatterns,
    ...(postRetirementStatus === "retired_then_reentered"
      ? [
          closeoutRecoveredExitHistory.latestReEntryEntry?.pattern ??
            postRetirementStatus,
        ]
      : []),
  ]);
  const repeatedRetiredThenRegressedPatterns = unique([
    ...closeoutRecoveryRetirementHistory.repeatedRetiredThenRegressedPatterns,
    ...closeoutRecoveryRegressionAudit.repeatedRecoveredThenRegressedPatterns,
    ...(postRetirementStatus === "retired_then_regressed"
      ? [closeoutRecoveryRegressionAudit.latestRegressionStatus]
      : []),
  ]);
  const repeatedRetiredThenWatchlistReaddedPatterns = unique([
    ...closeoutRecoveryRetirementHistory.repeatedRetiredThenWatchlistReaddedPatterns,
    ...closeoutWatchlistReAddHistory.repeatedResolvedThenReAddedPatterns,
    ...closeoutWatchlistReAddHistory.repeatedExitThenReopenPatterns,
    ...(postRetirementStatus === "retired_then_readded"
      ? [
          closeoutWatchlistReAddHistory.latestReAddEntry?.reAddPattern ??
            postRetirementStatus,
        ]
      : []),
  ]);
  const auditReasons = unique([
    ...closeoutRecoveryRetirementHistory.historyReasons,
    ...closeoutRecoveredExitHistory.historyReasons,
    ...closeoutRecoveredLifecycle.lifecycleReasons,
    ...closeoutRecoveryRegressionAudit.regressionReasons,
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
  ]);
  const recommendedNextOperatorStep = retiredCaseStateRemainsStable
    ? "retired_case_stable"
    : closeoutRecoveredLifecycle.recommendedNextOperatorStep ||
      closeoutRecoveryRegressionAudit.recommendedNextOperatorStep ||
      closeoutWatchlistReAddHistory.recommendedNextOperatorStep;
  const summaryLine = hasRetiredEntry
    ? `Sandbox closeout retired-case audit history: ${postRetirementStatus}; next=${recommendedNextOperatorStep}.`
    : "Sandbox closeout retired-case audit history: no retired case audit trail is active.";

  return {
    entries,
    latestRetiredCaseAuditEntry,
    previousRetiredCaseAuditEntry,
    latestPostRetirementStatus:
      latestRetiredCaseAuditEntry?.postRetirementStatus ?? "not_retired",
    latestReentryStatus:
      latestRetiredCaseAuditEntry?.latestReentryStatus ?? null,
    latestRegressionStatus:
      latestRetiredCaseAuditEntry?.latestRegressionStatus ?? "none",
    latestWatchlistReaddStatus:
      latestRetiredCaseAuditEntry?.latestWatchlistReaddStatus ?? null,
    repeatedRetiredThenReenteredPatterns,
    repeatedRetiredThenRegressedPatterns,
    repeatedRetiredThenWatchlistReaddedPatterns,
    retiredCaseStateRemainsStable,
    historyRetainedEntryCount: entries.length,
    auditReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRetiredCaseAuditHistory;
}

export function formatSandboxCloseoutRetiredCaseAuditHistory(
  result: SandboxCloseoutRetiredCaseAuditHistory,
) {
  return [
    "Sandbox closeout retired-case audit history",
    `Latest post-retirement status: ${result.latestPostRetirementStatus}`,
    `Latest retired-case audit entry: ${result.latestRetiredCaseAuditEntry?.summaryLine ?? "none"}`,
    `Previous retired-case audit entry: ${result.previousRetiredCaseAuditEntry?.summaryLine ?? "none"}`,
    `Latest re-entry status: ${result.latestReentryStatus ?? "none"}`,
    `Latest regression status: ${result.latestRegressionStatus}`,
    `Latest watchlist re-add status: ${result.latestWatchlistReaddStatus ?? "none"}`,
    `Repeated retired-then-reentered patterns: ${result.repeatedRetiredThenReenteredPatterns.join(" | ") || "none"}`,
    `Repeated retired-then-regressed patterns: ${result.repeatedRetiredThenRegressedPatterns.join(" | ") || "none"}`,
    `Repeated retired-then-watchlist-readded patterns: ${result.repeatedRetiredThenWatchlistReaddedPatterns.join(" | ") || "none"}`,
    `Retired-case state remains stable: ${result.retiredCaseStateRemainsStable}`,
    `History retained entry count: ${result.historyRetainedEntryCount}`,
    `Audit reasons: ${result.auditReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
