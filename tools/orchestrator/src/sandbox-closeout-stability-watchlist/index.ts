import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutFinalizationStabilitySummary,
  type SandboxCloseoutFinalizationStabilitySummary,
} from "../sandbox-closeout-finalization-stability-summary";
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

export type SandboxCloseoutStabilityWatchlistEntry = {
  listedAt: string | null;
  watchlistStatus:
    | "drift_detected"
    | "reopen_recurrence"
    | "post_finalization_followup_open"
    | "queue_retained"
    | "stable_but_watch";
  stableFinalComplete: boolean;
  driftRiskFlag: boolean;
  reopenRecurrenceFlag: boolean;
  postFinalizationFollowUpOpen: boolean;
  queueRetained: boolean;
  watchlistReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export type SandboxCloseoutStabilityWatchlist = {
  entries: SandboxCloseoutStabilityWatchlistEntry[];
  latestWatchlistEntry: SandboxCloseoutStabilityWatchlistEntry | null;
  watchlistStatus:
    | "empty"
    | SandboxCloseoutStabilityWatchlistEntry["watchlistStatus"];
  stableFinalComplete: boolean;
  driftRiskFlag: boolean;
  reopenRecurrenceFlag: boolean;
  postFinalizationFollowUpOpen: boolean;
  queueRetained: boolean;
  watchlistReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutStabilityWatchlist(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutStabilityDrift?: SandboxCloseoutStabilityDrift;
  closeoutReopenRecurrence?: SandboxCloseoutReopenRecurrence;
  closeoutFinalizationStabilitySummary?: SandboxCloseoutFinalizationStabilitySummary;
  closeoutPostFinalizationFollowupQueue?: SandboxCloseoutPostFinalizationFollowupQueue;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutFinalizationStabilitySummary =
    params.closeoutFinalizationStabilitySummary ??
    (await buildSandboxCloseoutFinalizationStabilitySummary({
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
      closeoutFinalizationStabilitySummary,
    }));
  const closeoutStabilityDrift =
    params.closeoutStabilityDrift ??
    (await buildSandboxCloseoutStabilityDrift({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationStabilitySummary,
      closeoutPostFinalizationFollowupQueue,
    }));
  const closeoutReopenRecurrence =
    params.closeoutReopenRecurrence ??
    (await buildSandboxCloseoutReopenRecurrence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationStabilitySummary,
      closeoutPostFinalizationFollowupQueue,
    }));

  const stableFinalComplete =
    closeoutFinalizationStabilitySummary.completionThreadStableFinalComplete;
  const driftRiskFlag = closeoutStabilityDrift.driftRiskDetected;
  const reopenRecurrenceFlag = closeoutReopenRecurrence.reopenRecurrenceActive;
  const postFinalizationFollowUpOpen =
    closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen;
  const queueRetained =
    closeoutPostFinalizationFollowupQueue.queueStatus !== "empty" &&
    closeoutPostFinalizationFollowupQueue.queueStatus !== "reopened_after_finalization";

  let watchlistStatus: SandboxCloseoutStabilityWatchlist["watchlistStatus"] = "empty";
  if (
    driftRiskFlag ||
    reopenRecurrenceFlag ||
    postFinalizationFollowUpOpen ||
    queueRetained
  ) {
    if (reopenRecurrenceFlag) {
      watchlistStatus = "reopen_recurrence";
    } else if (postFinalizationFollowUpOpen) {
      watchlistStatus = "post_finalization_followup_open";
    } else if (queueRetained) {
      watchlistStatus = "queue_retained";
    } else if (stableFinalComplete) {
      watchlistStatus = "stable_but_watch";
    } else {
      watchlistStatus = "drift_detected";
    }
  }

  const watchlistReasons = Array.from(
    new Set(
      [
        ...closeoutStabilityDrift.driftReasons,
        ...closeoutReopenRecurrence.unresolvedRecurrenceReasons,
        ...closeoutPostFinalizationFollowupQueue.blockedReasonsSummary,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const recommendedNextOperatorStep =
    watchlistStatus === "empty"
      ? "stability_stable"
      : closeoutPostFinalizationFollowupQueue.recommendedNextOperatorStep;
  const latestWatchlistEntry =
    watchlistStatus === "empty"
      ? null
      : ({
          listedAt:
            closeoutPostFinalizationFollowupQueue.latestQueueEntry?.queuedAt ?? null,
          watchlistStatus,
          stableFinalComplete,
          driftRiskFlag,
          reopenRecurrenceFlag,
          postFinalizationFollowUpOpen,
          queueRetained,
          watchlistReasons,
          recommendedNextOperatorStep,
          summaryLine:
            closeoutStabilityDrift.summaryLine ??
            closeoutReopenRecurrence.summaryLine,
        } satisfies SandboxCloseoutStabilityWatchlistEntry);
  const entries = latestWatchlistEntry ? [latestWatchlistEntry] : [];
  const summaryLine =
    latestWatchlistEntry === null
      ? "Sandbox closeout stability watchlist is empty."
      : `Sandbox closeout stability watchlist: status=${latestWatchlistEntry.watchlistStatus}, next=${recommendedNextOperatorStep}.`;

  return {
    entries,
    latestWatchlistEntry,
    watchlistStatus,
    stableFinalComplete,
    driftRiskFlag,
    reopenRecurrenceFlag,
    postFinalizationFollowUpOpen,
    queueRetained,
    watchlistReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutStabilityWatchlist;
}

export function formatSandboxCloseoutStabilityWatchlist(
  result: SandboxCloseoutStabilityWatchlist,
) {
  return [
    "Sandbox closeout stability watchlist",
    `Watchlist status: ${result.watchlistStatus}`,
    `Stable-final-complete: ${result.stableFinalComplete}`,
    `Drift risk: ${result.driftRiskFlag}`,
    `Reopen recurrence: ${result.reopenRecurrenceFlag}`,
    `Post-finalization follow-up open: ${result.postFinalizationFollowUpOpen}`,
    `Queue retained: ${result.queueRetained}`,
    `Watchlist reasons: ${result.watchlistReasons.join(" | ") || "none"}`,
    `Latest watchlist entry: ${result.latestWatchlistEntry?.listedAt ?? "none"} ${result.latestWatchlistEntry?.summaryLine ?? ""}`.trimEnd(),
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
