import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
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
  buildSandboxCloseoutWatchlistExitAudit,
  type SandboxCloseoutWatchlistExitAudit,
} from "../sandbox-closeout-watchlist-exit-audit";
import {
  buildSandboxCloseoutWatchlistLifecycle,
  type SandboxCloseoutWatchlistLifecycle,
} from "../sandbox-closeout-watchlist-lifecycle";
import {
  buildSandboxCloseoutWatchlistReAddHistory,
  type SandboxCloseoutWatchlistReAddHistory,
} from "../sandbox-closeout-watchlist-readd-history";
import {
  buildSandboxCloseoutWatchlistResolutionSummary,
  type SandboxCloseoutWatchlistResolutionSummary,
} from "../sandbox-closeout-watchlist-resolution-summary";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutStabilityRecoverySummary = {
  latestDriftStatus: SandboxCloseoutStabilityDrift["driftSource"];
  latestReopenRecurrenceStatus:
    SandboxCloseoutReopenRecurrence["latestReopenStatus"];
  latestWatchlistStatus:
    SandboxCloseoutWatchlistResolutionSummary["latestWatchlistStatus"];
  latestWatchlistExitStatus: SandboxCloseoutWatchlistExitAudit["exitStatus"];
  latestPostFinalizationFollowupStatus:
    SandboxCloseoutPostFinalizationFollowupQueue["queueStatus"];
  recoveryStatus:
    | "recovery_achieved"
    | "recovery_provisional"
    | "recovery_blocked"
    | "recovered_but_reopenable"
    | "watchlist_still_open"
    | "readd_risk_high";
  recoveryAchieved: boolean;
  recoveryProvisional: boolean;
  recoveryBlocked: boolean;
  caseRecoveredButReopenable: boolean;
  watchlistRemainsOpen: boolean;
  reAddRiskRemainsHigh: boolean;
  recoveryReasons: string[];
  recoveryWarnings: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutStabilityRecoverySummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutStabilityDrift?: SandboxCloseoutStabilityDrift;
  closeoutReopenRecurrence?: SandboxCloseoutReopenRecurrence;
  closeoutWatchlistExitAudit?: SandboxCloseoutWatchlistExitAudit;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
  closeoutWatchlistResolutionSummary?: SandboxCloseoutWatchlistResolutionSummary;
  closeoutWatchlistLifecycle?: SandboxCloseoutWatchlistLifecycle;
  closeoutPostFinalizationFollowupQueue?: SandboxCloseoutPostFinalizationFollowupQueue;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutPostFinalizationFollowupQueue =
    params.closeoutPostFinalizationFollowupQueue ??
    (await buildSandboxCloseoutPostFinalizationFollowupQueue({
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
      closeoutPostFinalizationFollowupQueue,
    }));
  const closeoutReopenRecurrence =
    params.closeoutReopenRecurrence ??
    (await buildSandboxCloseoutReopenRecurrence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
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
      closeoutWatchlistResolutionSummary,
    }));
  const closeoutWatchlistExitAudit =
    params.closeoutWatchlistExitAudit ??
    (await buildSandboxCloseoutWatchlistExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutWatchlistResolutionSummary,
      closeoutWatchlistLifecycle,
      closeoutPostFinalizationFollowupQueue,
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
      closeoutWatchlistExitAudit,
      closeoutWatchlistLifecycle,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "");
  const watchlistRemainsOpen =
    closeoutWatchlistLifecycle.watchlistActive ||
    closeoutWatchlistLifecycle.watchlistRetained ||
    closeoutWatchlistLifecycle.watchlistReAdded;
  const caseRecoveredButReopenable =
    closeoutWatchlistExitAudit.exitAllowed &&
    closeoutWatchlistExitAudit.caseRemainsReopenable;
  const reAddRiskRemainsHigh =
    closeoutWatchlistReAddHistory.reAddCount > 0 ||
    closeoutWatchlistReAddHistory.recurrenceSeverity === "high" ||
    closeoutWatchlistReAddHistory.recurrenceSeverity === "medium";

  const recoveryAchieved =
    closeoutWatchlistExitAudit.exitAllowed &&
    closeoutWatchlistExitAudit.caseRemovedFromWatchlist &&
    !caseRecoveredButReopenable &&
    !watchlistRemainsOpen &&
    !closeoutStabilityDrift.driftDetected &&
    !closeoutReopenRecurrence.reopenRecurrenceActive &&
    !closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen &&
    !reAddRiskRemainsHigh &&
    !terminalSeverity;
  const recoveryProvisional =
    !recoveryAchieved &&
    closeoutWatchlistExitAudit.exitAllowed &&
    closeoutWatchlistExitAudit.caseRemovedFromWatchlist &&
    !watchlistRemainsOpen &&
    !closeoutStabilityDrift.driftDetected &&
    !closeoutReopenRecurrence.reopenRecurrenceActive &&
    !closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen &&
    !terminalSeverity;
  const recoveryBlocked = !recoveryAchieved && !recoveryProvisional;

  let recoveryStatus: SandboxCloseoutStabilityRecoverySummary["recoveryStatus"] =
    "recovery_blocked";
  if (recoveryAchieved) {
    recoveryStatus = "recovery_achieved";
  } else if (recoveryProvisional && caseRecoveredButReopenable) {
    recoveryStatus = "recovered_but_reopenable";
  } else if (watchlistRemainsOpen) {
    recoveryStatus = "watchlist_still_open";
  } else if (reAddRiskRemainsHigh) {
    recoveryStatus = "readd_risk_high";
  } else if (recoveryProvisional) {
    recoveryStatus = "recovery_provisional";
  }

  const recoveryReasons = unique([
    ...closeoutWatchlistExitAudit.exitSupportingReasons,
    ...(recoveryAchieved ? ["stability_recovery_achieved"] : []),
    ...(recoveryProvisional ? ["stability_recovery_provisional"] : []),
    ...(closeoutWatchlistResolutionSummary.stableFinalCompleteRestored
      ? ["stable_final_complete_restored"]
      : []),
  ]);
  const recoveryWarnings = unique([
    ...closeoutWatchlistExitAudit.exitBlockedReasons,
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
    ...(caseRecoveredButReopenable ? ["case_remains_reopenable"] : []),
    ...(watchlistRemainsOpen ? ["watchlist_remains_open"] : []),
    ...(reAddRiskRemainsHigh ? ["watchlist_readd_risk_remains_high"] : []),
    ...(terminalSeverity ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`] : []),
  ]);
  const recommendedNextOperatorStep = recoveryAchieved
    ? "stability_recovered"
    : recoveryProvisional
      ? "monitor_recovery_provisional"
      : closeoutWatchlistLifecycle.recommendedNextOperatorStep ||
        closeoutWatchlistReAddHistory.recommendedNextOperatorStep;
  const summaryLine = recoveryAchieved
    ? "Sandbox closeout stability recovery: recovery achieved."
    : `Sandbox closeout stability recovery: ${recoveryStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestDriftStatus: closeoutStabilityDrift.driftSource,
    latestReopenRecurrenceStatus:
      closeoutReopenRecurrence.latestReopenStatus,
    latestWatchlistStatus:
      closeoutWatchlistResolutionSummary.latestWatchlistStatus,
    latestWatchlistExitStatus: closeoutWatchlistExitAudit.exitStatus,
    latestPostFinalizationFollowupStatus:
      closeoutPostFinalizationFollowupQueue.queueStatus,
    recoveryStatus,
    recoveryAchieved,
    recoveryProvisional,
    recoveryBlocked,
    caseRecoveredButReopenable,
    watchlistRemainsOpen,
    reAddRiskRemainsHigh,
    recoveryReasons,
    recoveryWarnings,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutStabilityRecoverySummary;
}

export function formatSandboxCloseoutStabilityRecoverySummary(
  result: SandboxCloseoutStabilityRecoverySummary,
) {
  return [
    "Sandbox closeout stability recovery summary",
    `Latest drift status: ${result.latestDriftStatus}`,
    `Latest reopen recurrence status: ${result.latestReopenRecurrenceStatus}`,
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Latest watchlist exit status: ${result.latestWatchlistExitStatus}`,
    `Latest post-finalization follow-up status: ${result.latestPostFinalizationFollowupStatus}`,
    `Recovery status: ${result.recoveryStatus}`,
    `Recovery achieved: ${result.recoveryAchieved}`,
    `Recovery provisional: ${result.recoveryProvisional}`,
    `Recovery blocked: ${result.recoveryBlocked}`,
    `Recovered but reopenable: ${result.caseRecoveredButReopenable}`,
    `Watchlist remains open: ${result.watchlistRemainsOpen}`,
    `Re-add risk remains high: ${result.reAddRiskRemainsHigh}`,
    `Recovery reasons: ${result.recoveryReasons.join(" | ") || "none"}`,
    `Recovery warnings: ${result.recoveryWarnings.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
