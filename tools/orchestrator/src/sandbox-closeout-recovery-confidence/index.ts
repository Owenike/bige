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
  buildSandboxCloseoutStabilityRecoverySummary,
  type SandboxCloseoutStabilityRecoverySummary,
} from "../sandbox-closeout-stability-recovery-summary";
import {
  buildSandboxCloseoutWatchlistExitAudit,
  type SandboxCloseoutWatchlistExitAudit,
} from "../sandbox-closeout-watchlist-exit-audit";
import {
  buildSandboxCloseoutWatchlistReAddHistory,
  type SandboxCloseoutWatchlistReAddHistory,
} from "../sandbox-closeout-watchlist-readd-history";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveryConfidence = {
  latestRecoveryStatus: SandboxCloseoutStabilityRecoverySummary["recoveryStatus"];
  latestWatchlistStatus: SandboxCloseoutWatchlistExitAudit["latestWatchlistStatus"];
  latestDriftStatus: SandboxCloseoutStabilityDrift["driftSource"];
  latestReopenRecurrenceStatus:
    SandboxCloseoutReopenRecurrence["latestReopenStatus"];
  latestFollowupStatus:
    SandboxCloseoutPostFinalizationFollowupQueue["queueStatus"];
  recoveryConfidenceLevel:
    | "high_confidence_recovered"
    | "provisional_recovered"
    | "low_confidence_recovered"
    | "recovery_blocked";
  recoveryConfidenceReasons: string[];
  recoveryConfidenceBlockers: string[];
  recoveryHighConfidence: boolean;
  recoveryProvisional: boolean;
  recoveryLowConfidence: boolean;
  caseRemainsReopenable: boolean;
  watchlistRemainsOpen: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveryConfidence(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutStabilityRecoverySummary?: SandboxCloseoutStabilityRecoverySummary;
  closeoutWatchlistExitAudit?: SandboxCloseoutWatchlistExitAudit;
  closeoutWatchlistReAddHistory?: SandboxCloseoutWatchlistReAddHistory;
  closeoutStabilityDrift?: SandboxCloseoutStabilityDrift;
  closeoutReopenRecurrence?: SandboxCloseoutReopenRecurrence;
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
  const closeoutWatchlistExitAudit =
    params.closeoutWatchlistExitAudit ??
    (await buildSandboxCloseoutWatchlistExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
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
    }));
  const closeoutStabilityRecoverySummary =
    params.closeoutStabilityRecoverySummary ??
    (await buildSandboxCloseoutStabilityRecoverySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutPostFinalizationFollowupQueue,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(
    params.state.lastIncidentSeverity ?? "",
  );
  const watchlistRemainsOpen =
    closeoutStabilityRecoverySummary.watchlistRemainsOpen;
  const historicalRecoveryObserved =
    closeoutWatchlistExitAudit.exitAllowed ||
    closeoutWatchlistExitAudit.caseRemovedFromWatchlist ||
    closeoutWatchlistExitAudit.entries.some(
      (entry) => entry.exitAllowed || entry.caseTreatedAsRecovered,
    );
  const caseRemainsReopenable =
    closeoutStabilityRecoverySummary.caseRecoveredButReopenable ||
    closeoutWatchlistExitAudit.caseRemainsReopenable;
  const reAddRiskRemainsHigh =
    closeoutStabilityRecoverySummary.reAddRiskRemainsHigh ||
    closeoutWatchlistReAddHistory.recurrenceSeverity === "medium" ||
    closeoutWatchlistReAddHistory.recurrenceSeverity === "high";
  const activeRecoveryBlockers =
    closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen ||
    terminalSeverity;
  const recoveryCandidate =
    closeoutStabilityRecoverySummary.recoveryAchieved ||
    closeoutStabilityRecoverySummary.recoveryProvisional ||
    closeoutStabilityRecoverySummary.recoveryStatus === "readd_risk_high" ||
    historicalRecoveryObserved;
  const recoveryBlocked =
    activeRecoveryBlockers ||
    (!recoveryCandidate && closeoutStabilityRecoverySummary.recoveryBlocked);
  const recoveryHighConfidence =
    !recoveryBlocked &&
    recoveryCandidate &&
    !caseRemainsReopenable &&
    !closeoutReopenRecurrence.reopenRecurrenceActive &&
    !watchlistRemainsOpen &&
    !reAddRiskRemainsHigh;
  const recoveryProvisional =
    !recoveryBlocked &&
    !recoveryHighConfidence &&
    (closeoutStabilityRecoverySummary.recoveryProvisional ||
      closeoutWatchlistExitAudit.exitStatus === "exit_allowed_but_reopenable" ||
      caseRemainsReopenable);
  const recoveryLowConfidence =
    !recoveryBlocked &&
    !recoveryHighConfidence &&
    !recoveryProvisional &&
    (recoveryCandidate || reAddRiskRemainsHigh || watchlistRemainsOpen);

  let recoveryConfidenceLevel: SandboxCloseoutRecoveryConfidence["recoveryConfidenceLevel"] =
    "recovery_blocked";
  if (recoveryHighConfidence) {
    recoveryConfidenceLevel = "high_confidence_recovered";
  } else if (recoveryProvisional) {
    recoveryConfidenceLevel = "provisional_recovered";
  } else if (recoveryLowConfidence) {
    recoveryConfidenceLevel = "low_confidence_recovered";
  }

  const recoveryConfidenceReasons = unique([
    ...closeoutStabilityRecoverySummary.recoveryReasons,
    ...closeoutWatchlistExitAudit.exitSupportingReasons,
    ...(recoveryHighConfidence ? ["high_confidence_recovered"] : []),
    ...(recoveryProvisional ? ["provisional_recovered"] : []),
    ...(recoveryLowConfidence ? ["low_confidence_recovered"] : []),
  ]);
  const recoveryConfidenceBlockers = unique([
    ...closeoutStabilityRecoverySummary.recoveryWarnings,
    ...closeoutWatchlistExitAudit.exitBlockedReasons,
    ...closeoutWatchlistReAddHistory.unresolvedReAddReasons,
    ...(caseRemainsReopenable ? ["case_remains_reopenable"] : []),
    ...(watchlistRemainsOpen ? ["watchlist_remains_open"] : []),
    ...(closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen
      ? ["post_finalization_followup_open"]
      : []),
    ...(terminalSeverity
      ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`]
      : []),
  ]);

  const recommendedNextOperatorStep = recoveryHighConfidence
    ? "monitor_recovered_case"
    : recoveryProvisional
      ? "monitor_provisional_recovery"
      : recoveryLowConfidence
        ? "monitor_low_confidence_recovery"
        : closeoutStabilityRecoverySummary.recommendedNextOperatorStep ||
          closeoutWatchlistReAddHistory.recommendedNextOperatorStep;
  const summaryLine = recoveryHighConfidence
    ? "Sandbox closeout recovery confidence: high-confidence recovered."
    : `Sandbox closeout recovery confidence: ${recoveryConfidenceLevel}; next=${recommendedNextOperatorStep}.`;

  return {
    latestRecoveryStatus: closeoutStabilityRecoverySummary.recoveryStatus,
    latestWatchlistStatus: closeoutWatchlistExitAudit.latestWatchlistStatus,
    latestDriftStatus: closeoutStabilityDrift.driftSource,
    latestReopenRecurrenceStatus:
      closeoutReopenRecurrence.latestReopenStatus,
    latestFollowupStatus: closeoutPostFinalizationFollowupQueue.queueStatus,
    recoveryConfidenceLevel,
    recoveryConfidenceReasons,
    recoveryConfidenceBlockers,
    recoveryHighConfidence,
    recoveryProvisional,
    recoveryLowConfidence,
    caseRemainsReopenable,
    watchlistRemainsOpen,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveryConfidence;
}

export function formatSandboxCloseoutRecoveryConfidence(
  result: SandboxCloseoutRecoveryConfidence,
) {
  return [
    "Sandbox closeout recovery confidence",
    `Latest recovery status: ${result.latestRecoveryStatus}`,
    `Latest watchlist status: ${result.latestWatchlistStatus}`,
    `Latest drift status: ${result.latestDriftStatus}`,
    `Latest reopen recurrence status: ${result.latestReopenRecurrenceStatus}`,
    `Latest follow-up status: ${result.latestFollowupStatus}`,
    `Recovery confidence level: ${result.recoveryConfidenceLevel}`,
    `Recovery confidence reasons: ${result.recoveryConfidenceReasons.join(" | ") || "none"}`,
    `Recovery confidence blockers: ${result.recoveryConfidenceBlockers.join(" | ") || "none"}`,
    `High-confidence recovered: ${result.recoveryHighConfidence}`,
    `Provisional recovered: ${result.recoveryProvisional}`,
    `Low-confidence recovered: ${result.recoveryLowConfidence}`,
    `Case remains reopenable: ${result.caseRemainsReopenable}`,
    `Watchlist remains open: ${result.watchlistRemainsOpen}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
