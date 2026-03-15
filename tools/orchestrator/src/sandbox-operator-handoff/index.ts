import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { buildSandboxCloseoutSummary } from "../sandbox-closeout-summary";
import { buildSandboxCloseoutCompletionDispositionSummary } from "../sandbox-closeout-completion-disposition-summary";
import { buildSandboxCloseoutCompletionFinalizationSummary } from "../sandbox-closeout-completion-finalization-summary";
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
  const repeatedHotspots = incidents.incidents
    .filter((incident) => incident.type === "repeated_blocked_hotspot")
    .flatMap((incident) => incident.affectedProfiles)
    .filter((profileId, index, array) => array.indexOf(profileId) === index)
    .sort();
  const latestActionSummary =
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
      ? `Sandbox recovery handoff: ${closeoutCompletionFinalizationSummary.summaryLine}`
      : `Sandbox recovery handoff: ${closeoutCompletionFinalizationSummary.summaryLine} Hotspots=${governance.unresolvedHotspots.join(", ") || "none"}.`;
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
      closeoutCompletionFinalizationSummary.recommendedNextOperatorStep,
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
