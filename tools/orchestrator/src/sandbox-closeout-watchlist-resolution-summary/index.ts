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
import {
  buildSandboxCloseoutStabilityWatchlist,
  type SandboxCloseoutStabilityWatchlist,
} from "../sandbox-closeout-stability-watchlist";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutWatchlistResolutionSummary = {
  latestWatchlistStatus: SandboxCloseoutStabilityWatchlist["watchlistStatus"];
  latestDriftStatus: SandboxCloseoutStabilityDrift["driftSource"];
  latestReopenRecurrenceStatus:
    SandboxCloseoutReopenRecurrence["latestReopenStatus"];
  latestPostFinalizationFollowupStatus:
    SandboxCloseoutPostFinalizationFollowupQueue["queueStatus"];
  watchlistCanBeResolved: boolean;
  watchlistMustRemainRetained: boolean;
  watchlistWasReAdded: boolean;
  resolutionStatus:
    | "watchlist_resolved"
    | "watchlist_retained"
    | "watchlist_readded"
    | "watchlist_blocked_by_drift"
    | "watchlist_blocked_by_recurrence"
    | "watchlist_blocked_by_followup";
  resolutionBlockedReasons: string[];
  resolutionSupportingReasons: string[];
  stableFinalCompleteRestored: boolean;
  followUpRemainsOpen: boolean;
  recurrenceRemainsActive: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutWatchlistResolutionSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutStabilityDrift?: SandboxCloseoutStabilityDrift;
  closeoutReopenRecurrence?: SandboxCloseoutReopenRecurrence;
  closeoutStabilityWatchlist?: SandboxCloseoutStabilityWatchlist;
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
  const closeoutStabilityWatchlist =
    params.closeoutStabilityWatchlist ??
    (await buildSandboxCloseoutStabilityWatchlist({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutFinalizationStabilitySummary,
      closeoutPostFinalizationFollowupQueue,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "");
  const followUpRemainsOpen =
    closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen;
  const recurrenceRemainsActive =
    closeoutReopenRecurrence.reopenRecurrenceActive;
  const watchlistWasReAdded =
    closeoutStabilityWatchlist.watchlistStatus !== "empty" &&
    (
      closeoutPostFinalizationFollowupQueue.reopenedAfterFinalization ||
      closeoutStabilityDrift.caseDegradedToNonStable ||
      closeoutReopenRecurrence.repeatedFinalizedThenReopenedPatterns.length > 0
    );
  const stableFinalCompleteRestored =
    closeoutFinalizationStabilitySummary.completionThreadStableFinalComplete &&
    !closeoutStabilityDrift.driftDetected &&
    !recurrenceRemainsActive &&
    !followUpRemainsOpen &&
    closeoutStabilityWatchlist.watchlistStatus === "empty" &&
    !terminalSeverity;
  const watchlistCanBeResolved = stableFinalCompleteRestored;
  const watchlistMustRemainRetained = !watchlistCanBeResolved;

  const resolutionBlockedReasons = unique([
    ...closeoutStabilityDrift.driftReasons,
    ...closeoutReopenRecurrence.unresolvedRecurrenceReasons,
    ...closeoutStabilityWatchlist.watchlistReasons,
    ...closeoutPostFinalizationFollowupQueue.blockedReasonsSummary,
    ...(terminalSeverity ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`] : []),
  ]);
  const resolutionSupportingReasons = unique([
    ...(closeoutFinalizationStabilitySummary.completionThreadStableFinalComplete
      ? ["stable_final_complete_restored"]
      : []),
    ...(closeoutStabilityWatchlist.watchlistStatus === "empty"
      ? ["watchlist_empty"]
      : []),
    ...(!closeoutStabilityDrift.driftDetected ? ["no_active_drift"] : []),
    ...(!recurrenceRemainsActive ? ["no_active_reopen_recurrence"] : []),
    ...(!followUpRemainsOpen ? ["no_post_finalization_followup_open"] : []),
  ]);

  let resolutionStatus: SandboxCloseoutWatchlistResolutionSummary["resolutionStatus"] =
    "watchlist_retained";
  if (watchlistCanBeResolved) {
    resolutionStatus = "watchlist_resolved";
  } else if (watchlistWasReAdded) {
    resolutionStatus = "watchlist_readded";
  } else if (closeoutStabilityDrift.driftDetected) {
    resolutionStatus = "watchlist_blocked_by_drift";
  } else if (recurrenceRemainsActive) {
    resolutionStatus = "watchlist_blocked_by_recurrence";
  } else if (followUpRemainsOpen || closeoutPostFinalizationFollowupQueue.queueStatus !== "empty") {
    resolutionStatus = "watchlist_blocked_by_followup";
  }

  const recommendedNextOperatorStep = watchlistCanBeResolved
    ? "stability_watchlist_resolved"
    : closeoutStabilityWatchlist.recommendedNextOperatorStep;
  const summaryLine = watchlistCanBeResolved
    ? "Sandbox closeout watchlist resolution: watchlist can be resolved."
    : `Sandbox closeout watchlist resolution: ${resolutionStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestWatchlistStatus: closeoutStabilityWatchlist.watchlistStatus,
    latestDriftStatus: closeoutStabilityDrift.driftSource,
    latestReopenRecurrenceStatus: closeoutReopenRecurrence.latestReopenStatus,
    latestPostFinalizationFollowupStatus:
      closeoutPostFinalizationFollowupQueue.queueStatus,
    watchlistCanBeResolved,
    watchlistMustRemainRetained,
    watchlistWasReAdded,
    resolutionStatus,
    resolutionBlockedReasons,
    resolutionSupportingReasons,
    stableFinalCompleteRestored,
    followUpRemainsOpen,
    recurrenceRemainsActive,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutWatchlistResolutionSummary;
}

export function formatSandboxCloseoutWatchlistResolutionSummary(
  result: SandboxCloseoutWatchlistResolutionSummary,
) {
  return [
    "Sandbox closeout watchlist resolution summary",
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Latest drift status: ${result.latestDriftStatus}`,
    `Latest reopen recurrence status: ${result.latestReopenRecurrenceStatus}`,
    `Latest post-finalization follow-up status: ${result.latestPostFinalizationFollowupStatus}`,
    `Watchlist can be resolved: ${result.watchlistCanBeResolved}`,
    `Watchlist must remain retained: ${result.watchlistMustRemainRetained}`,
    `Watchlist was re-added: ${result.watchlistWasReAdded}`,
    `Resolution status: ${result.resolutionStatus}`,
    `Resolution blocked reasons: ${result.resolutionBlockedReasons.join(" | ") || "none"}`,
    `Resolution supporting reasons: ${result.resolutionSupportingReasons.join(" | ") || "none"}`,
    `Stable-final-complete restored: ${result.stableFinalCompleteRestored}`,
    `Follow-up remains open: ${result.followUpRemainsOpen}`,
    `Recurrence remains active: ${result.recurrenceRemainsActive}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
