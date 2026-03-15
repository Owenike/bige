import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutFinalizationAuditHistory,
  type SandboxCloseoutFinalizationAuditHistory,
} from "../sandbox-closeout-finalization-audit-history";
import {
  buildSandboxCloseoutPostFinalizationFollowupQueue,
  type SandboxCloseoutPostFinalizationFollowupQueue,
} from "../sandbox-closeout-post-finalization-followup-queue";
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
  buildSandboxCloseoutWatchlistLifecycle,
  type SandboxCloseoutWatchlistLifecycle,
} from "../sandbox-closeout-watchlist-lifecycle";
import {
  buildSandboxCloseoutWatchlistResolutionSummary,
  type SandboxCloseoutWatchlistResolutionSummary,
} from "../sandbox-closeout-watchlist-resolution-summary";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutWatchlistExitAuditEntry = {
  auditedAt: string | null;
  watchlistStatus: SandboxCloseoutStabilityWatchlist["watchlistStatus"];
  watchlistLifecycleStatus: SandboxCloseoutWatchlistLifecycle["lifecycleStatus"];
  watchlistResolutionSnapshot:
    SandboxCloseoutWatchlistResolutionSummary["resolutionStatus"];
  stabilityDriftSnapshot: SandboxCloseoutStabilityDrift["driftSource"];
  reopenRecurrenceSnapshot:
    SandboxCloseoutReopenRecurrence["latestReopenStatus"];
  postFinalizationFollowupSnapshot:
    SandboxCloseoutPostFinalizationFollowupQueue["queueStatus"];
  exitStatus:
    | "exit_allowed"
    | "exit_blocked"
    | "exit_allowed_but_reopenable"
    | "exit_blocked_by_drift"
    | "exit_blocked_by_recurrence"
    | "exit_blocked_by_followup";
  exitAllowed: boolean;
  exitSupportingReasons: string[];
  exitBlockedReasons: string[];
  caseRemovedFromWatchlist: boolean;
  caseRemainsReopenable: boolean;
  caseTreatedAsRecovered: boolean;
  summaryLine: string;
};

export type SandboxCloseoutWatchlistExitAudit = {
  entries: SandboxCloseoutWatchlistExitAuditEntry[];
  latestExitAuditEntry: SandboxCloseoutWatchlistExitAuditEntry | null;
  previousExitAuditEntry: SandboxCloseoutWatchlistExitAuditEntry | null;
  latestWatchlistStatus: SandboxCloseoutStabilityWatchlist["watchlistStatus"];
  latestWatchlistLifecycleStatus:
    SandboxCloseoutWatchlistLifecycle["lifecycleStatus"];
  latestWatchlistResolutionSnapshot:
    SandboxCloseoutWatchlistResolutionSummary["resolutionStatus"];
  latestStabilityDriftSnapshot: SandboxCloseoutStabilityDrift["driftSource"];
  latestReopenRecurrenceSnapshot:
    SandboxCloseoutReopenRecurrence["latestReopenStatus"];
  latestPostFinalizationFollowupSnapshot:
    SandboxCloseoutPostFinalizationFollowupQueue["queueStatus"];
  exitStatus: SandboxCloseoutWatchlistExitAuditEntry["exitStatus"];
  exitAllowed: boolean;
  exitSupportingReasons: string[];
  exitBlockedReasons: string[];
  caseRemovedFromWatchlist: boolean;
  caseRemainsReopenable: boolean;
  caseTreatedAsRecovered: boolean;
  auditedAt: string | null;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

function buildHistoricalExitAuditEntry(
  entry: SandboxCloseoutFinalizationAuditHistory["entries"][number],
): SandboxCloseoutWatchlistExitAuditEntry {
  const exitAllowed =
    entry.finalizationStatus === "final_complete" &&
    !entry.reopenedAfterFinalization &&
    !entry.postFinalizationFollowUpOpen &&
    !entry.retainedAfterFinalization;
  const caseRemainsReopenable =
    entry.finalizationStatus === "finalized_but_reopenable" ||
    entry.reopenedAfterFinalization;
  const watchlistStatus: SandboxCloseoutStabilityWatchlist["watchlistStatus"] =
    entry.reopenedAfterFinalization
      ? "reopen_recurrence"
      : entry.postFinalizationFollowUpOpen
        ? "post_finalization_followup_open"
        : entry.retainedAfterFinalization
          ? "queue_retained"
          : exitAllowed
            ? "empty"
            : "drift_detected";
  const watchlistLifecycleStatus: SandboxCloseoutWatchlistLifecycle["lifecycleStatus"] =
    exitAllowed
      ? "resolved"
      : entry.reopenedAfterFinalization
        ? "re_added"
        : entry.retainedAfterFinalization || entry.postFinalizationFollowUpOpen
          ? "retained"
          : "active";
  const watchlistResolutionSnapshot:
    SandboxCloseoutWatchlistResolutionSummary["resolutionStatus"] =
    exitAllowed
      ? "watchlist_resolved"
      : entry.reopenedAfterFinalization
        ? "watchlist_readded"
        : entry.postFinalizationFollowUpOpen
          ? "watchlist_blocked_by_followup"
          : entry.retainedAfterFinalization
            ? "watchlist_retained"
            : "watchlist_blocked_by_drift";
  const stabilityDriftSnapshot: SandboxCloseoutStabilityDrift["driftSource"] =
    entry.reopenedAfterFinalization
      ? "reopen"
      : entry.postFinalizationFollowUpOpen
        ? "followup_reopening"
        : entry.retainedAfterFinalization
          ? "queue_retained_again"
          : "none";
  const reopenRecurrenceSnapshot:
    SandboxCloseoutReopenRecurrence["latestReopenStatus"] =
    entry.reopenedAfterFinalization
      ? "repeated_reopen_after_finalization"
      : "none";
  const postFinalizationFollowupSnapshot:
    SandboxCloseoutPostFinalizationFollowupQueue["queueStatus"] =
    entry.reopenedAfterFinalization
      ? "reopened_after_finalization"
      : entry.postFinalizationFollowUpOpen
        ? "post_finalization_followup_open"
        : entry.retainedAfterFinalization
          ? "carry_forward_retained"
          : entry.finalizationStatus === "finalized_but_reopenable"
            ? "finalized_but_reopenable"
            : "empty";
  const exitBlockedReasons = unique([
    ...(entry.reopenedAfterFinalization
      ? ["reopened_after_finalization"]
      : []),
    ...(entry.postFinalizationFollowUpOpen
      ? ["post_finalization_followup_open"]
      : []),
    ...(entry.retainedAfterFinalization ? ["carry_forward_retained"] : []),
  ]);
  const exitSupportingReasons = unique([
    ...(exitAllowed ? ["watchlist_exit_allowed"] : []),
    ...(exitAllowed && !caseRemainsReopenable ? ["stable_recovery_candidate"] : []),
  ]);

  let exitStatus: SandboxCloseoutWatchlistExitAuditEntry["exitStatus"] =
    "exit_blocked";
  if (exitAllowed && caseRemainsReopenable) {
    exitStatus = "exit_allowed_but_reopenable";
  } else if (exitAllowed) {
    exitStatus = "exit_allowed";
  } else if (entry.reopenedAfterFinalization) {
    exitStatus = "exit_blocked_by_recurrence";
  } else if (entry.postFinalizationFollowUpOpen || entry.retainedAfterFinalization) {
    exitStatus = "exit_blocked_by_followup";
  } else {
    exitStatus = "exit_blocked_by_drift";
  }

  return {
    auditedAt: entry.auditedAt,
    watchlistStatus,
    watchlistLifecycleStatus,
    watchlistResolutionSnapshot,
    stabilityDriftSnapshot,
    reopenRecurrenceSnapshot,
    postFinalizationFollowupSnapshot,
    exitStatus,
    exitAllowed,
    exitSupportingReasons,
    exitBlockedReasons,
    caseRemovedFromWatchlist: exitAllowed,
    caseRemainsReopenable,
    caseTreatedAsRecovered: exitAllowed && !caseRemainsReopenable,
    summaryLine: exitAllowed
      ? `Watchlist exit audit: exit allowed at ${entry.auditedAt ?? "unknown time"}.`
      : `Watchlist exit audit: ${exitStatus} at ${entry.auditedAt ?? "unknown time"}.`,
  };
}

export async function buildSandboxCloseoutWatchlistExitAudit(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutFinalizationAuditHistory?: SandboxCloseoutFinalizationAuditHistory;
  closeoutStabilityDrift?: SandboxCloseoutStabilityDrift;
  closeoutReopenRecurrence?: SandboxCloseoutReopenRecurrence;
  closeoutStabilityWatchlist?: SandboxCloseoutStabilityWatchlist;
  closeoutWatchlistResolutionSummary?: SandboxCloseoutWatchlistResolutionSummary;
  closeoutWatchlistLifecycle?: SandboxCloseoutWatchlistLifecycle;
  closeoutPostFinalizationFollowupQueue?: SandboxCloseoutPostFinalizationFollowupQueue;
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
  const closeoutPostFinalizationFollowupQueue =
    params.closeoutPostFinalizationFollowupQueue ??
    (await buildSandboxCloseoutPostFinalizationFollowupQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationAuditHistory,
    }));
  const closeoutStabilityDrift =
    params.closeoutStabilityDrift ??
    (await buildSandboxCloseoutStabilityDrift({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationAuditHistory,
      closeoutPostFinalizationFollowupQueue,
    }));
  const closeoutReopenRecurrence =
    params.closeoutReopenRecurrence ??
    (await buildSandboxCloseoutReopenRecurrence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationAuditHistory,
      closeoutPostFinalizationFollowupQueue,
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
      closeoutPostFinalizationFollowupQueue,
    }));
  const closeoutWatchlistResolutionSummary =
    params.closeoutWatchlistResolutionSummary ??
    (await buildSandboxCloseoutWatchlistResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutPostFinalizationFollowupQueue,
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
      closeoutWatchlistResolutionSummary,
    }));

  const exitAllowed = closeoutWatchlistResolutionSummary.watchlistCanBeResolved;
  const caseRemovedFromWatchlist =
    exitAllowed &&
    closeoutWatchlistLifecycle.watchlistResolved &&
    closeoutStabilityWatchlist.watchlistStatus === "empty";
  const caseRemainsReopenable =
    closeoutPostFinalizationFollowupQueue.queueStatus ===
      "finalized_but_reopenable" ||
    closeoutReopenRecurrence.latestReopenStatus ===
      "repeated_reopen_after_finalization";
  const caseTreatedAsRecovered =
    caseRemovedFromWatchlist &&
    !caseRemainsReopenable &&
    !closeoutStabilityDrift.driftDetected &&
    !closeoutReopenRecurrence.reopenRecurrenceActive &&
    !closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen;
  const exitSupportingReasons = unique([
    ...closeoutWatchlistResolutionSummary.resolutionSupportingReasons,
    ...(closeoutWatchlistLifecycle.watchlistResolved
      ? ["watchlist_lifecycle_resolved"]
      : []),
    ...(caseRemovedFromWatchlist ? ["watchlist_removed"] : []),
    ...(caseTreatedAsRecovered ? ["stability_recovery_candidate"] : []),
  ]);
  const exitBlockedReasons = unique([
    ...closeoutWatchlistResolutionSummary.resolutionBlockedReasons,
    ...closeoutStabilityDrift.driftReasons,
    ...closeoutReopenRecurrence.unresolvedRecurrenceReasons,
    ...closeoutPostFinalizationFollowupQueue.blockedReasonsSummary,
  ]);

  let exitStatus: SandboxCloseoutWatchlistExitAuditEntry["exitStatus"] =
    "exit_blocked";
  if (exitAllowed && caseRemainsReopenable) {
    exitStatus = "exit_allowed_but_reopenable";
  } else if (exitAllowed) {
    exitStatus = "exit_allowed";
  } else if (closeoutStabilityDrift.driftDetected) {
    exitStatus = "exit_blocked_by_drift";
  } else if (closeoutReopenRecurrence.reopenRecurrenceActive) {
    exitStatus = "exit_blocked_by_recurrence";
  } else if (
    closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen ||
    closeoutPostFinalizationFollowupQueue.queueStatus !== "empty"
  ) {
    exitStatus = "exit_blocked_by_followup";
  }

  const latestExitAuditEntry = {
    auditedAt: closeoutFinalizationAuditHistory.latestEntry?.auditedAt ?? null,
    watchlistStatus: closeoutStabilityWatchlist.watchlistStatus,
    watchlistLifecycleStatus: closeoutWatchlistLifecycle.lifecycleStatus,
    watchlistResolutionSnapshot:
      closeoutWatchlistResolutionSummary.resolutionStatus,
    stabilityDriftSnapshot: closeoutStabilityDrift.driftSource,
    reopenRecurrenceSnapshot:
      closeoutReopenRecurrence.latestReopenStatus,
    postFinalizationFollowupSnapshot:
      closeoutPostFinalizationFollowupQueue.queueStatus,
    exitStatus,
    exitAllowed,
    exitSupportingReasons,
    exitBlockedReasons,
    caseRemovedFromWatchlist,
    caseRemainsReopenable,
    caseTreatedAsRecovered,
    summaryLine: exitAllowed
      ? `Sandbox closeout watchlist exit audit: ${exitStatus}; removed=${caseRemovedFromWatchlist}, recovered=${caseTreatedAsRecovered}.`
      : `Sandbox closeout watchlist exit audit: ${exitStatus}; next=${closeoutWatchlistLifecycle.recommendedNextOperatorStep}.`,
  } satisfies SandboxCloseoutWatchlistExitAuditEntry;

  const historicalEntries = closeoutFinalizationAuditHistory.entries
    .map((entry) => buildHistoricalExitAuditEntry(entry))
    .filter(
      (entry) =>
        entry.exitAllowed ||
        entry.exitStatus !== "exit_blocked_by_drift" ||
        entry.auditedAt !== latestExitAuditEntry.auditedAt,
    )
    .slice(0, Math.max(0, limit - 1));

  const entries = [latestExitAuditEntry, ...historicalEntries].slice(0, limit);

  return {
    entries,
    latestExitAuditEntry,
    previousExitAuditEntry: entries[1] ?? null,
    latestWatchlistStatus: closeoutStabilityWatchlist.watchlistStatus,
    latestWatchlistLifecycleStatus: closeoutWatchlistLifecycle.lifecycleStatus,
    latestWatchlistResolutionSnapshot:
      closeoutWatchlistResolutionSummary.resolutionStatus,
    latestStabilityDriftSnapshot: closeoutStabilityDrift.driftSource,
    latestReopenRecurrenceSnapshot:
      closeoutReopenRecurrence.latestReopenStatus,
    latestPostFinalizationFollowupSnapshot:
      closeoutPostFinalizationFollowupQueue.queueStatus,
    exitStatus,
    exitAllowed,
    exitSupportingReasons,
    exitBlockedReasons,
    caseRemovedFromWatchlist,
    caseRemainsReopenable,
    caseTreatedAsRecovered,
    auditedAt: latestExitAuditEntry.auditedAt,
    recommendedNextOperatorStep:
      closeoutWatchlistLifecycle.recommendedNextOperatorStep,
    summaryLine: latestExitAuditEntry.summaryLine,
  } satisfies SandboxCloseoutWatchlistExitAudit;
}

export function formatSandboxCloseoutWatchlistExitAudit(
  result: SandboxCloseoutWatchlistExitAudit,
) {
  return [
    "Sandbox closeout watchlist exit audit",
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Latest watchlist lifecycle status: ${result.latestWatchlistLifecycleStatus}`,
    `Latest watchlist resolution snapshot: ${result.latestWatchlistResolutionSnapshot}`,
    `Latest stability drift snapshot: ${result.latestStabilityDriftSnapshot}`,
    `Latest reopen recurrence snapshot: ${result.latestReopenRecurrenceSnapshot}`,
    `Latest post-finalization follow-up snapshot: ${result.latestPostFinalizationFollowupSnapshot}`,
    `Exit status: ${result.exitStatus}`,
    `Exit allowed: ${result.exitAllowed}`,
    `Exit supporting reasons: ${result.exitSupportingReasons.join(" | ") || "none"}`,
    `Exit blocked reasons: ${result.exitBlockedReasons.join(" | ") || "none"}`,
    `Removed from watchlist: ${result.caseRemovedFromWatchlist}`,
    `Remains reopenable: ${result.caseRemainsReopenable}`,
    `Treated as recovered: ${result.caseTreatedAsRecovered}`,
    `Latest audit: ${result.auditedAt ?? "none"} ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
