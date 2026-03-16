import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { buildSandboxCloseoutSummary } from "../sandbox-closeout-summary";
import { buildSandboxCloseoutCompletionDispositionSummary } from "../sandbox-closeout-completion-disposition-summary";
import { buildSandboxCloseoutCompletionFinalizationSummary } from "../sandbox-closeout-completion-finalization-summary";
import { buildSandboxCloseoutFinalizationStabilitySummary } from "../sandbox-closeout-finalization-stability-summary";
import { buildSandboxCloseoutStabilityDrift } from "../sandbox-closeout-stability-drift";
import { buildSandboxCloseoutReopenRecurrence } from "../sandbox-closeout-reopen-recurrence";
import { buildSandboxCloseoutStabilityWatchlist } from "../sandbox-closeout-stability-watchlist";
import { buildSandboxCloseoutStabilityRecurrenceAudit } from "../sandbox-closeout-stability-recurrence-audit";
import { buildSandboxCloseoutWatchlistResolutionSummary } from "../sandbox-closeout-watchlist-resolution-summary";
import { buildSandboxCloseoutWatchlistLifecycle } from "../sandbox-closeout-watchlist-lifecycle";
import { buildSandboxCloseoutWatchlistExitAudit } from "../sandbox-closeout-watchlist-exit-audit";
import { buildSandboxCloseoutWatchlistReAddHistory } from "../sandbox-closeout-watchlist-readd-history";
import { buildSandboxCloseoutStabilityRecoverySummary } from "../sandbox-closeout-stability-recovery-summary";
import { buildSandboxCloseoutRecoveryConfidence } from "../sandbox-closeout-recovery-confidence";
import { buildSandboxCloseoutRecoveryRegressionAudit } from "../sandbox-closeout-recovery-regression-audit";
import { buildSandboxCloseoutRecoveredMonitoringQueue } from "../sandbox-closeout-recovered-monitoring-queue";
import { buildSandboxCloseoutRecoveryConfidenceTrend } from "../sandbox-closeout-recovery-confidence-trend";
import { buildSandboxCloseoutRegressionResolutionSummary } from "../sandbox-closeout-regression-resolution-summary";
import { buildSandboxCloseoutRecoveredMonitoringExitAudit } from "../sandbox-closeout-recovered-monitoring-exit-audit";
import { buildSandboxCloseoutRecoveryClearanceAudit } from "../sandbox-closeout-recovery-clearance-audit";
import { buildSandboxCloseoutRecoveryClearanceHistory } from "../sandbox-closeout-recovery-clearance-history";
import { buildSandboxCloseoutRecoveredExitHistory } from "../sandbox-closeout-recovered-exit-history";
import { buildSandboxCloseoutRecoveredLifecycle } from "../sandbox-closeout-recovered-lifecycle";
import { buildSandboxCloseoutRecoveredLifecycleHistory } from "../sandbox-closeout-recovered-lifecycle-history";
import { buildSandboxCloseoutRecoveredReentryAudit } from "../sandbox-closeout-recovered-reentry-audit";
import { buildSandboxCloseoutRecoveryRetirementAudit } from "../sandbox-closeout-recovery-retirement-audit";
import { buildSandboxCloseoutRecoveredRetirementSummary } from "../sandbox-closeout-recovered-retirement-summary";
import { buildSandboxCloseoutRecoveryRetirementQueue } from "../sandbox-closeout-recovery-retirement-queue";
import { buildSandboxCloseoutCompletionLifecycle } from "../sandbox-closeout-completion-lifecycle";
import { buildSandboxCloseoutCompletionResolutionSummary } from "../sandbox-closeout-completion-resolution-summary";
import { buildSandboxCloseoutDispositionSummary } from "../sandbox-closeout-disposition-summary";
import { buildSandboxCloseoutReviewHistory } from "../sandbox-closeout-review-history";
import { buildSandboxCloseoutReviewResolutionSummary } from "../sandbox-closeout-review-resolution-summary";
import { buildSandboxCloseoutReviewSummary } from "../sandbox-closeout-review-summary";
import { buildSandboxCloseoutFollowupSummary } from "../sandbox-closeout-followup-summary";
import { buildSandboxGovernanceStatus } from "../sandbox-governance-status";
import { classifySandboxRecoveryIncidents } from "../sandbox-incident-governance";
import { buildSandboxResolutionEvidenceSummary } from "../sandbox-resolution-evidence";

export type SandboxOperatorHandoffSummary = {
  latestIncidentSummary: string | null;
  latestActionSummary: string | null;
  unresolvedHotspots: string[];
  repeatedBlockedManualRequiredHotspots: string[];
  recommendedNextStep: string;
  governanceWarnings: string[];
  escalationRecommendation: string | null;
  handoffLine: string;
  summary: string;
};

export async function buildSandboxOperatorHandoffSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const governance = await buildSandboxGovernanceStatus({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const incidents = await classifySandboxRecoveryIncidents({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const evidence = await buildSandboxResolutionEvidenceSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const closeoutSummary = await buildSandboxCloseoutSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const closeoutReviewSummary = await buildSandboxCloseoutReviewSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutSummary,
  });
  const closeoutDispositionSummary = await buildSandboxCloseoutDispositionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutSummary,
    closeoutReviewSummary,
  });
  const closeoutReviewHistory = await buildSandboxCloseoutReviewHistory({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const closeoutReviewResolutionSummary = await buildSandboxCloseoutReviewResolutionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutDispositionSummary,
    closeoutReviewHistory,
  });
  const closeoutFollowupSummary = await buildSandboxCloseoutFollowupSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutDispositionSummary,
    closeoutReviewResolutionSummary,
  });
  const closeoutCompletionResolutionSummary =
    await buildSandboxCloseoutCompletionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    });
  const closeoutCompletionDispositionSummary =
    await buildSandboxCloseoutCompletionDispositionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionResolutionSummary,
    });
  const closeoutCompletionLifecycle = await buildSandboxCloseoutCompletionLifecycle({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutCompletionResolutionSummary,
    closeoutCompletionDispositionSummary,
  });
  const closeoutCompletionFinalizationSummary =
    await buildSandboxCloseoutCompletionFinalizationSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionResolutionSummary,
      closeoutCompletionDispositionSummary,
      closeoutCompletionLifecycle,
    });
  const closeoutFinalizationStabilitySummary =
    await buildSandboxCloseoutFinalizationStabilitySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionFinalizationSummary,
    });
  const closeoutStabilityDrift = await buildSandboxCloseoutStabilityDrift({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutFinalizationStabilitySummary,
  });
  const closeoutReopenRecurrence = await buildSandboxCloseoutReopenRecurrence({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutFinalizationStabilitySummary,
  });
  const closeoutStabilityWatchlist = await buildSandboxCloseoutStabilityWatchlist({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutStabilityDrift,
    closeoutReopenRecurrence,
    closeoutFinalizationStabilitySummary,
  });
  const closeoutStabilityRecurrenceAudit =
    await buildSandboxCloseoutStabilityRecurrenceAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
    });
  const closeoutWatchlistResolutionSummary =
    await buildSandboxCloseoutWatchlistResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutFinalizationStabilitySummary,
    });
  const closeoutWatchlistLifecycle = await buildSandboxCloseoutWatchlistLifecycle({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutStabilityDrift,
    closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutWatchlistResolutionSummary,
    });
  const closeoutWatchlistExitAudit = await buildSandboxCloseoutWatchlistExitAudit({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutStabilityDrift,
    closeoutReopenRecurrence,
    closeoutStabilityWatchlist,
    closeoutWatchlistResolutionSummary,
    closeoutWatchlistLifecycle,
  });
  const closeoutWatchlistReAddHistory =
    await buildSandboxCloseoutWatchlistReAddHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutStabilityWatchlist,
      closeoutWatchlistLifecycle,
      closeoutWatchlistExitAudit,
    });
  const closeoutStabilityRecoverySummary =
    await buildSandboxCloseoutStabilityRecoverySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutWatchlistResolutionSummary,
      closeoutWatchlistLifecycle,
    });
  const closeoutRecoveryConfidence =
    await buildSandboxCloseoutRecoveryConfidence({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutStabilityRecoverySummary,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
    });
  const closeoutRecoveryRegressionAudit =
    await buildSandboxCloseoutRecoveryRegressionAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidence,
      closeoutStabilityRecoverySummary,
      closeoutWatchlistReAddHistory,
      closeoutStabilityDrift,
      closeoutReopenRecurrence,
    });
  const closeoutRecoveredMonitoringQueue =
    await buildSandboxCloseoutRecoveredMonitoringQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidence,
      closeoutRecoveryRegressionAudit,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutStabilityRecoverySummary,
    });
  const closeoutRecoveryConfidenceTrend =
    await buildSandboxCloseoutRecoveryConfidenceTrend({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidence,
      closeoutRecoveryRegressionAudit,
      closeoutRecoveredMonitoringQueue,
      closeoutWatchlistReAddHistory,
    });
  const closeoutRegressionResolutionSummary =
    await buildSandboxCloseoutRegressionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryRegressionAudit,
      closeoutRecoveryConfidence,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutRecoveredMonitoringQueue,
    });
  const closeoutRecoveredMonitoringExitAudit =
    await buildSandboxCloseoutRecoveredMonitoringExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringQueue,
      closeoutWatchlistExitAudit,
      closeoutWatchlistReAddHistory,
    });
  const closeoutRecoveryClearanceAudit =
    await buildSandboxCloseoutRecoveryClearanceAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringExitAudit,
      closeoutWatchlistReAddHistory,
      closeoutStabilityRecoverySummary,
    });
  const closeoutRecoveredExitHistory =
    await buildSandboxCloseoutRecoveredExitHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveredMonitoringExitAudit,
      closeoutRecoveryClearanceAudit,
      closeoutRegressionResolutionSummary,
      closeoutWatchlistReAddHistory,
    });
  const closeoutRecoveredLifecycle =
    await buildSandboxCloseoutRecoveredLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceAudit,
      closeoutRecoveredExitHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringExitAudit,
    });
  const closeoutRecoveryClearanceHistory =
    await buildSandboxCloseoutRecoveryClearanceHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceAudit,
      closeoutRecoveredExitHistory,
      closeoutRecoveredLifecycle,
    });
  const closeoutRecoveredReentryAudit =
    await buildSandboxCloseoutRecoveredReentryAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveredExitHistory,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredLifecycle,
    });
  const closeoutRecoveredLifecycleHistory =
    await buildSandboxCloseoutRecoveredLifecycleHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveredLifecycle,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredReentryAudit,
      closeoutRecoveryRegressionAudit,
      closeoutRecoveredMonitoringExitAudit,
    });
  const closeoutRecoveryRetirementAudit =
    await buildSandboxCloseoutRecoveryRetirementAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceAudit,
      closeoutRecoveredExitHistory,
      closeoutRecoveredLifecycle,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
      closeoutRecoveredMonitoringExitAudit,
    });
  const closeoutRecoveredRetirementSummary =
    await buildSandboxCloseoutRecoveredRetirementSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryRetirementAudit,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredReentryAudit,
      closeoutRecoveredLifecycleHistory,
      closeoutRecoveryConfidenceTrend,
      closeoutRegressionResolutionSummary,
    });
  const closeoutRecoveryRetirementQueue =
    await buildSandboxCloseoutRecoveryRetirementQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryRetirementAudit,
      closeoutRecoveredRetirementSummary,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredLifecycleHistory,
    });
  const repeatedHotspots = incidents.incidents
    .filter((incident) => incident.type === "repeated_blocked_hotspot")
    .flatMap((incident) => incident.affectedProfiles)
    .filter((profileId, index, array) => array.indexOf(profileId) === index)
    .sort();
  const latestActionSummary =
    closeoutRecoveryRetirementQueue.summaryLine ??
    closeoutRecoveredRetirementSummary.summaryLine ??
    closeoutRecoveryRetirementAudit.summaryLine ??
    closeoutRecoveredLifecycleHistory.summaryLine ??
    closeoutRecoveredReentryAudit.summaryLine ??
    closeoutRecoveryClearanceHistory.summaryLine ??
    closeoutRecoveredLifecycle.summaryLine ??
    closeoutRecoveredExitHistory.summaryLine ??
    closeoutRecoveryClearanceAudit.summaryLine ??
    closeoutRecoveredMonitoringExitAudit.summaryLine ??
    closeoutRegressionResolutionSummary.summaryLine ??
    closeoutRecoveryConfidenceTrend.summaryLine ??
    closeoutRecoveredMonitoringQueue.summaryLine ??
    closeoutRecoveryRegressionAudit.summaryLine ??
    closeoutRecoveryConfidence.summaryLine ??
    closeoutStabilityRecoverySummary.summaryLine ??
    closeoutWatchlistReAddHistory.summaryLine ??
    closeoutWatchlistExitAudit.summaryLine ??
    closeoutWatchlistLifecycle.summaryLine ??
    closeoutWatchlistResolutionSummary.summaryLine ??
    closeoutStabilityRecurrenceAudit.summaryLine ??
    closeoutStabilityWatchlist.summaryLine ??
    closeoutStabilityDrift.summaryLine ??
    closeoutReopenRecurrence.summaryLine ??
    closeoutFinalizationStabilitySummary.summaryLine ??
    closeoutCompletionFinalizationSummary.summaryLine ??
    closeoutCompletionDispositionSummary.summaryLine ??
    closeoutSummary.latestOperatorActionSummary ??
    evidence.latestOperatorActionTrailSummary;
  const escalationRecommendation =
    closeoutReviewSummary.escalationPending || governance.operatorHandoffRecommended || governance.latestEscalationNeededCount > 0
      ? `Escalate or hand off before further recovery apply attempts.`
      : null;
  const handoffLine =
    governance.latestUnresolvedIncidentCount === 0
      ? `Sandbox recovery handoff: ${closeoutRecoveryRetirementQueue.summaryLine}`
      : `Sandbox recovery handoff: ${closeoutRecoveryRetirementQueue.summaryLine} Hotspots=${governance.unresolvedHotspots.join(", ") || "none"}.`;
  const summary =
    governance.latestUnresolvedIncidentCount === 0
      ? "No unresolved sandbox recovery incident currently requires operator handoff."
      : `Recovery handoff summary: unresolved=${governance.latestUnresolvedIncidentCount}, escalation-needed=${governance.latestEscalationNeededCount}, repeated-hotspots=${repeatedHotspots.join(", ") || "none"}.`;

  return {
    latestIncidentSummary: governance.latestIncidentSummary,
    latestActionSummary,
    unresolvedHotspots: governance.unresolvedHotspots,
    repeatedBlockedManualRequiredHotspots: repeatedHotspots,
    recommendedNextStep:
      closeoutRecoveryRetirementQueue.recommendedNextOperatorStep ||
      closeoutRecoveredRetirementSummary.recommendedNextOperatorStep ||
      closeoutRecoveryRetirementAudit.recommendedNextOperatorStep ||
      closeoutRecoveredLifecycleHistory.recommendedNextOperatorStep ||
      closeoutRecoveredReentryAudit.recommendedNextOperatorStep ||
      closeoutRecoveryClearanceHistory.recommendedNextOperatorStep ||
      closeoutRecoveredLifecycle.recommendedNextOperatorStep ||
      closeoutRecoveredExitHistory.recommendedNextOperatorStep ||
      closeoutRecoveryClearanceAudit.recommendedNextOperatorStep ||
      closeoutRecoveredMonitoringExitAudit.recommendedNextOperatorStep ||
      closeoutRegressionResolutionSummary.recommendedNextOperatorStep ||
      closeoutRecoveryConfidenceTrend.recommendedNextOperatorStep ||
      closeoutRecoveryRegressionAudit.recommendedNextOperatorStep ||
      closeoutRecoveredMonitoringQueue.recommendedNextOperatorStep ||
      closeoutRecoveryConfidence.recommendedNextOperatorStep ||
      closeoutStabilityRecoverySummary.recommendedNextOperatorStep,
    governanceWarnings: governance.governanceWarnings,
    escalationRecommendation,
    handoffLine,
    summary,
  } satisfies SandboxOperatorHandoffSummary;
}

export function formatSandboxOperatorHandoffSummary(result: SandboxOperatorHandoffSummary) {
  return [
    "Sandbox operator handoff",
    `Latest incident: ${result.latestIncidentSummary ?? "none"}`,
    `Latest action: ${result.latestActionSummary ?? "none"}`,
    `Unresolved hotspots: ${result.unresolvedHotspots.join(", ") || "none"}`,
    `Repeated blocked/manual_required hotspots: ${result.repeatedBlockedManualRequiredHotspots.join(", ") || "none"}`,
    `Warnings: ${result.governanceWarnings.join(" | ") || "none"}`,
    `Escalation recommendation: ${result.escalationRecommendation ?? "none"}`,
    `Handoff line: ${result.handoffLine}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.recommendedNextStep}`,
  ].join("\n");
}
