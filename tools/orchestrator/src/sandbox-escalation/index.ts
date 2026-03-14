import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { classifySandboxRecoveryIncidents } from "../sandbox-incident-governance";
import { listSandboxOperatorActions } from "../sandbox-operator-actions";

export type SandboxEscalationSummary = {
  unresolvedIncidentCount: number;
  escalationNeededCount: number;
  latestIncident: string | null;
  latestOperatorAction: string | null;
  repeatedHotSpots: string[];
  summary: string;
  suggestedNextAction: string;
};

export async function buildSandboxEscalationSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
}) {
  const incidents = await classifySandboxRecoveryIncidents({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit: Math.max(5, params.limit ?? 10),
  });
  const actions = await listSandboxOperatorActions({
    configPath: params.configPath,
    limit: Math.max(10, params.limit ?? 20),
  });

  const latestActionByIncident = new Map<string, (typeof actions.records)[number]>();
  for (const record of actions.records) {
    if (!latestActionByIncident.has(record.incidentId)) {
      latestActionByIncident.set(record.incidentId, record);
    }
  }
  const unresolved = incidents.incidents.filter(
    (incident) => incident.severity !== "info" && latestActionByIncident.get(incident.id)?.action !== "mark_resolved",
  );
  const escalationNeeded = unresolved.filter(
    (incident) =>
      incident.requiresEscalation || incident.severity === "critical" || incident.severity === "manual_required",
  );
  const hotSpotCounter = new Map<string, number>();
  for (const incident of unresolved) {
    for (const profileId of incident.affectedProfiles) {
      hotSpotCounter.set(profileId, (hotSpotCounter.get(profileId) ?? 0) + 1);
    }
  }
  const repeatedHotSpots = Array.from(hotSpotCounter.entries())
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([profileId, count]) => `${profileId}:${count}`);

  const latestIncident = unresolved[0] ?? incidents.latestIncident;
  const latestOperatorAction = actions.records[0] ?? null;
  const summary =
    unresolved.length === 0
      ? "No unresolved sandbox recovery incidents currently need escalation."
      : `Sandbox escalation summary: unresolved=${unresolved.length}, escalation-needed=${escalationNeeded.length}, hotspots=${repeatedHotSpots.join(", ") || "none"}.`;
  const suggestedNextAction =
    escalationNeeded.length > 0
      ? "Escalate or request review for the high-severity unresolved recovery incidents first."
      : unresolved.length > 0
        ? "Acknowledge or resolve the remaining recovery incidents before the next recovery apply."
        : "No escalation follow-up is required right now.";

  return {
    unresolvedIncidentCount: unresolved.length,
    escalationNeededCount: escalationNeeded.length,
    latestIncident: latestIncident ? `${latestIncident.severity} ${latestIncident.type} ${latestIncident.summary}` : null,
    latestOperatorAction: latestOperatorAction
      ? `${latestOperatorAction.actedAt} ${latestOperatorAction.action} ${latestOperatorAction.status}`
      : null,
    repeatedHotSpots,
    summary,
    suggestedNextAction,
  } satisfies SandboxEscalationSummary;
}

export function formatSandboxEscalationSummary(result: SandboxEscalationSummary) {
  return [
    `Sandbox escalation summary`,
    `Unresolved incidents: ${result.unresolvedIncidentCount}`,
    `Escalation needed: ${result.escalationNeededCount}`,
    `Latest incident: ${result.latestIncident ?? "none"}`,
    `Latest operator action: ${result.latestOperatorAction ?? "none"}`,
    `Repeated hotspots: ${result.repeatedHotSpots.join(", ") || "none"}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.suggestedNextAction}`,
  ].join("\n");
}
