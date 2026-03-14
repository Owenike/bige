import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { classifySandboxRecoveryIncidents, type SandboxRecoveryIncident } from "../sandbox-incident-governance";
import { resolveSandboxIncidentPolicy, type SandboxIncidentPolicyDecision } from "../sandbox-incident-policy";
import { listSandboxOperatorActions } from "../sandbox-operator-actions";

export type SandboxGovernanceStatusSummary = {
  latestIncidentType: SandboxRecoveryIncident["type"] | "none";
  latestIncidentSeverity: SandboxRecoveryIncident["severity"] | null;
  latestIncidentSummary: string | null;
  latestUnresolvedIncidentCount: number;
  latestEscalationNeededCount: number;
  latestOperatorAction: OrchestratorState["lastOperatorAction"];
  latestOperatorActionStatus: OrchestratorState["lastOperatorActionStatus"];
  recommendedAction: SandboxIncidentPolicyDecision["recommendedAction"];
  rerunRecommended: boolean;
  manualReviewRequired: boolean;
  applyBlocked: boolean;
  operatorHandoffRecommended: boolean;
  escalationSummary: string;
  unresolvedHotspots: string[];
  governanceWarnings: string[];
  recommendedNextStep: string;
  summary: string;
};

function resolveUnresolvedIncidents(params: {
  incidents: SandboxRecoveryIncident[];
  latestActionByIncident: Map<string, { action: string }>;
}) {
  return params.incidents.filter(
    (incident) =>
      incident.severity !== "info" &&
      params.latestActionByIncident.get(incident.id)?.action !== "mark_resolved",
  );
}

export async function buildSandboxGovernanceStatus(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const incidents = await classifySandboxRecoveryIncidents({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const actions = await listSandboxOperatorActions({
    configPath: params.configPath,
    limit: Math.max(10, limit * 2),
  });
  const latestActionByIncident = new Map<string, (typeof actions.records)[number]>();
  for (const record of actions.records) {
    if (!latestActionByIncident.has(record.incidentId)) {
      latestActionByIncident.set(record.incidentId, record);
    }
  }

  const unresolved = resolveUnresolvedIncidents({
    incidents: incidents.incidents,
    latestActionByIncident,
  });
  const latestIncident = unresolved[0] ?? incidents.latestIncident;
  const latestPolicy = resolveSandboxIncidentPolicy(latestIncident);
  const escalationNeeded = unresolved.filter((incident) => resolveSandboxIncidentPolicy(incident).requireEscalate);
  const hotSpotCounter = new Map<string, number>();
  for (const incident of unresolved) {
    for (const profileId of incident.affectedProfiles) {
      hotSpotCounter.set(profileId, (hotSpotCounter.get(profileId) ?? 0) + 1);
    }
  }
  const unresolvedHotspots = Array.from(hotSpotCounter.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([profileId, count]) => `${profileId}:${count}`);
  const latestOperatorAction = actions.records[0] ?? null;
  const governanceWarnings = [
    latestPolicy.manualRequiredTerminalState ? "Manual review is required before another recovery apply." : null,
    latestPolicy.blockedTerminalState ? "Recovery apply is blocked until governance or guardrails are resolved." : null,
    escalationNeeded.length > 0 ? `${escalationNeeded.length} unresolved incident(s) require escalation.` : null,
    unresolvedHotspots.length > 0 ? `Recovery hotspots: ${unresolvedHotspots.join(", ")}` : null,
  ].filter((value): value is string => Boolean(value));
  const recommendedNextStep = latestPolicy.suggestedNextAction;
  const summary =
    unresolved.length === 0
      ? "Sandbox governance status is clear; no unresolved recovery incident is currently blocking operator flow."
      : `Sandbox governance status: unresolved=${unresolved.length}, escalation-needed=${escalationNeeded.length}, recommended=${latestPolicy.recommendedAction}.`;

  return {
    latestIncidentType: latestIncident?.type ?? "none",
    latestIncidentSeverity: latestIncident?.severity ?? null,
    latestIncidentSummary: latestIncident?.summary ?? null,
    latestUnresolvedIncidentCount: unresolved.length,
    latestEscalationNeededCount: escalationNeeded.length,
    latestOperatorAction: latestOperatorAction?.action ?? "none",
    latestOperatorActionStatus: latestOperatorAction?.status ?? "not_run",
    recommendedAction: latestPolicy.recommendedAction,
    rerunRecommended:
      latestPolicy.recommendedAction === "rerun_preview" ||
      latestPolicy.recommendedAction === "rerun_validate" ||
      latestPolicy.recommendedAction === "rerun_apply",
    manualReviewRequired: latestPolicy.requireRequestReview || latestPolicy.manualRequiredTerminalState,
    applyBlocked: latestPolicy.blockedTerminalState || latestPolicy.manualRequiredTerminalState || !latestPolicy.allowRerunApply,
    operatorHandoffRecommended:
      latestPolicy.requireEscalate ||
      latestPolicy.requireRequestReview ||
      unresolvedHotspots.length > 0,
    escalationSummary:
      unresolved.length === 0
        ? "No unresolved sandbox recovery incident currently needs escalation."
        : `Unresolved=${unresolved.length}, escalation-needed=${escalationNeeded.length}, hotspots=${unresolvedHotspots.join(", ") || "none"}.`,
    unresolvedHotspots,
    governanceWarnings,
    recommendedNextStep,
    summary,
  } satisfies SandboxGovernanceStatusSummary;
}

export function formatSandboxGovernanceStatus(result: SandboxGovernanceStatusSummary) {
  return [
    "Sandbox governance status",
    `Latest incident: ${result.latestIncidentType}/${result.latestIncidentSeverity ?? "none"}`,
    `Latest incident summary: ${result.latestIncidentSummary ?? "none"}`,
    `Unresolved incidents: ${result.latestUnresolvedIncidentCount}`,
    `Escalation needed: ${result.latestEscalationNeededCount}`,
    `Latest operator action: ${result.latestOperatorAction}/${result.latestOperatorActionStatus}`,
    `Recommended action: ${result.recommendedAction}`,
    `Rerun recommended: ${result.rerunRecommended}`,
    `Manual review required: ${result.manualReviewRequired}`,
    `Apply blocked: ${result.applyBlocked}`,
    `Operator handoff recommended: ${result.operatorHandoffRecommended}`,
    `Escalation summary: ${result.escalationSummary}`,
    `Hotspots: ${result.unresolvedHotspots.join(", ") || "none"}`,
    `Warnings: ${result.governanceWarnings.join(" | ") || "none"}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.recommendedNextStep}`,
  ].join("\n");
}
