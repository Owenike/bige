import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
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
  buildSandboxCloseoutWatchlistResolutionSummary,
  type SandboxCloseoutWatchlistResolutionSummary,
} from "../sandbox-closeout-watchlist-resolution-summary";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutWatchlistLifecycle = {
  watchlistActive: boolean;
  watchlistRetained: boolean;
  watchlistResolved: boolean;
  watchlistReAdded: boolean;
  watchlistHeldByDrift: boolean;
  watchlistHeldByReopenRecurrence: boolean;
  watchlistHeldByFollowUpOpen: boolean;
  lifecycleStatus: "active" | "retained" | "resolved" | "re_added";
  lifecycleReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutWatchlistLifecycle(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutStabilityDrift?: SandboxCloseoutStabilityDrift;
  closeoutReopenRecurrence?: SandboxCloseoutReopenRecurrence;
  closeoutStabilityWatchlist?: SandboxCloseoutStabilityWatchlist;
  closeoutWatchlistResolutionSummary?: SandboxCloseoutWatchlistResolutionSummary;
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
    }));

  const watchlistResolved =
    closeoutWatchlistResolutionSummary.watchlistCanBeResolved;
  const watchlistReAdded =
    closeoutWatchlistResolutionSummary.watchlistWasReAdded;
  const watchlistHeldByDrift = closeoutStabilityDrift.driftDetected;
  const watchlistHeldByReopenRecurrence =
    closeoutReopenRecurrence.reopenRecurrenceActive;
  const watchlistHeldByFollowUpOpen =
    closeoutStabilityWatchlist.postFinalizationFollowUpOpen;
  const watchlistActive =
    !watchlistResolved &&
    closeoutStabilityWatchlist.watchlistStatus !== "empty";
  const watchlistRetained =
    closeoutWatchlistResolutionSummary.watchlistMustRemainRetained &&
    !watchlistReAdded &&
    watchlistActive;

  let lifecycleStatus: SandboxCloseoutWatchlistLifecycle["lifecycleStatus"] =
    "active";
  if (watchlistResolved) {
    lifecycleStatus = "resolved";
  } else if (watchlistReAdded) {
    lifecycleStatus = "re_added";
  } else if (watchlistRetained) {
    lifecycleStatus = "retained";
  }

  const lifecycleReasons = unique([
    ...closeoutWatchlistResolutionSummary.resolutionBlockedReasons,
    ...(watchlistHeldByDrift ? closeoutStabilityDrift.driftReasons : []),
    ...(watchlistHeldByReopenRecurrence
      ? closeoutReopenRecurrence.unresolvedRecurrenceReasons
      : []),
    ...(watchlistHeldByFollowUpOpen
      ? ["post_finalization_followup_remains_open"]
      : []),
    ...(watchlistResolved
      ? closeoutWatchlistResolutionSummary.resolutionSupportingReasons
      : []),
  ]);
  const recommendedNextOperatorStep = watchlistResolved
    ? "stability_watchlist_resolved"
    : closeoutWatchlistResolutionSummary.recommendedNextOperatorStep;
  const summaryLine = watchlistResolved
    ? "Sandbox closeout watchlist lifecycle: watchlist is resolved."
    : `Sandbox closeout watchlist lifecycle: ${lifecycleStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    watchlistActive,
    watchlistRetained,
    watchlistResolved,
    watchlistReAdded,
    watchlistHeldByDrift,
    watchlistHeldByReopenRecurrence,
    watchlistHeldByFollowUpOpen,
    lifecycleStatus,
    lifecycleReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutWatchlistLifecycle;
}

export function formatSandboxCloseoutWatchlistLifecycle(
  result: SandboxCloseoutWatchlistLifecycle,
) {
  return [
    "Sandbox closeout watchlist lifecycle",
    `Watchlist active: ${result.watchlistActive}`,
    `Watchlist retained: ${result.watchlistRetained}`,
    `Watchlist resolved: ${result.watchlistResolved}`,
    `Watchlist re-added: ${result.watchlistReAdded}`,
    `Held by drift: ${result.watchlistHeldByDrift}`,
    `Held by reopen recurrence: ${result.watchlistHeldByReopenRecurrence}`,
    `Held by follow-up open: ${result.watchlistHeldByFollowUpOpen}`,
    `Lifecycle status: ${result.lifecycleStatus}`,
    `Lifecycle reasons: ${result.lifecycleReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
