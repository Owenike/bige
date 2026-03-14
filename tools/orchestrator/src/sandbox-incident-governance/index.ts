import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { compareSandboxRestorePoints } from "../sandbox-compare";
import { querySandboxHistory, type SandboxHistoryEntry } from "../sandbox-history";
import { inspectSandboxRestorePointRetention } from "../sandbox-restore-retention";

export type SandboxIncidentSeverity = "info" | "warning" | "blocked" | "manual_required" | "critical";
export type SandboxIncidentType =
  | "recovery_observed"
  | "restore_point_missing"
  | "restore_point_expired"
  | "restore_point_invalid"
  | "rollback_governance_failed"
  | "guardrails_failed"
  | "default_profile_safety_failed"
  | "batch_partial_restore"
  | "high_risk_compare"
  | "repeated_blocked_hotspot";

export type SandboxRecoveryIncident = {
  id: string;
  type: SandboxIncidentType;
  severity: SandboxIncidentSeverity;
  summary: string;
  suggestedNextAction: string;
  restorePointId: string | null;
  affectedProfiles: string[];
  sourceKind: "history" | "compare" | "retention" | "hotspot";
  result: string;
  reason: string | null;
  timestamp: string;
  requiresEscalation: boolean;
};

export type SandboxIncidentGovernanceResult = {
  incidents: SandboxRecoveryIncident[];
  latestIncident: SandboxRecoveryIncident | null;
  unresolvedCount: number;
  escalationNeededCount: number;
  summary: string;
  suggestedNextAction: string;
};

function buildIncidentId(entry: {
  sourceKind: string;
  timestamp: string;
  type: string;
  restorePointId?: string | null;
  result?: string;
}) {
  return [
    "sandbox-incident",
    entry.sourceKind,
    entry.timestamp,
    entry.type,
    entry.restorePointId ?? "none",
    entry.result ?? "none",
  ].join(":");
}

function buildIncident(params: Omit<SandboxRecoveryIncident, "id">): SandboxRecoveryIncident {
  return {
    ...params,
    id: buildIncidentId(params),
  };
}

function classifyHistoryEntry(entry: SandboxHistoryEntry): SandboxRecoveryIncident | null {
  const reason = entry.reason ?? null;
  const hasDefaultProfileRisk = /default profile/i.test(entry.summary) || /default profile/i.test(reason ?? "");
  const hasGuardrailsRisk = /guardrail/i.test(entry.summary) || /guardrail/i.test(reason ?? "");
  const hasMissingRestorePoint = /restore_point_missing/i.test(reason ?? "");
  const hasExpiredRestorePoint = /restore_point_expired/i.test(reason ?? "");
  const hasInvalidRestorePoint = /restore_point_invalid/i.test(reason ?? "");

  if (entry.result === "partially_restored") {
    return buildIncident({
      type: "batch_partial_restore",
      severity: "warning",
      summary: `Partial sandbox recovery detected for restore point '${entry.restorePointId ?? "none"}'.`,
      suggestedNextAction: "Run sandbox:batch-recovery:validate or review blocked profiles before another apply.",
      restorePointId: entry.restorePointId,
      affectedProfiles: entry.affectedProfiles,
      sourceKind: "history",
      result: entry.result,
      reason,
      timestamp: entry.timestamp,
      requiresEscalation: false,
    });
  }

  if (hasMissingRestorePoint) {
    return buildIncident({
      type: "restore_point_missing",
      severity: "manual_required",
      summary: entry.summary,
      suggestedNextAction: "Create or locate a valid restore point before recovery actions.",
      restorePointId: entry.restorePointId,
      affectedProfiles: entry.affectedProfiles,
      sourceKind: "history",
      result: entry.result,
      reason,
      timestamp: entry.timestamp,
      requiresEscalation: true,
    });
  }

  if (hasExpiredRestorePoint) {
    return buildIncident({
      type: "restore_point_expired",
      severity: "manual_required",
      summary: entry.summary,
      suggestedNextAction: "Create a fresh restore point or review the stale restore point manually.",
      restorePointId: entry.restorePointId,
      affectedProfiles: entry.affectedProfiles,
      sourceKind: "history",
      result: entry.result,
      reason,
      timestamp: entry.timestamp,
      requiresEscalation: true,
    });
  }

  if (hasInvalidRestorePoint) {
    return buildIncident({
      type: "restore_point_invalid",
      severity: "manual_required",
      summary: entry.summary,
      suggestedNextAction: "Repair the restore point contents or select a different restore point before recovery.",
      restorePointId: entry.restorePointId,
      affectedProfiles: entry.affectedProfiles,
      sourceKind: "history",
      result: entry.result,
      reason,
      timestamp: entry.timestamp,
      requiresEscalation: true,
    });
  }

  if (hasDefaultProfileRisk) {
    return buildIncident({
      type: "default_profile_safety_failed",
      severity: "critical",
      summary: entry.summary,
      suggestedNextAction: "Escalate or request review before any rollback/apply touching the default sandbox profile.",
      restorePointId: entry.restorePointId,
      affectedProfiles: entry.affectedProfiles,
      sourceKind: "history",
      result: entry.result,
      reason,
      timestamp: entry.timestamp,
      requiresEscalation: true,
    });
  }

  if (hasGuardrailsRisk || entry.result === "blocked" || entry.result === "failed") {
    return buildIncident({
      type: hasGuardrailsRisk ? "guardrails_failed" : "rollback_governance_failed",
      severity: "blocked",
      summary: entry.summary,
      suggestedNextAction: hasGuardrailsRisk
        ? "Inspect sandbox guardrails and rerun preview after fixing the unsafe target/profile."
        : "Inspect rollback governance or rerun preview/validate before apply.",
      restorePointId: entry.restorePointId,
      affectedProfiles: entry.affectedProfiles,
      sourceKind: "history",
      result: entry.result,
      reason,
      timestamp: entry.timestamp,
      requiresEscalation: false,
    });
  }

  if (entry.result === "manual_required") {
    return buildIncident({
      type: "rollback_governance_failed",
      severity: "manual_required",
      summary: entry.summary,
      suggestedNextAction: "Request review or escalate before retrying recovery.",
      restorePointId: entry.restorePointId,
      affectedProfiles: entry.affectedProfiles,
      sourceKind: "history",
      result: entry.result,
      reason,
      timestamp: entry.timestamp,
      requiresEscalation: true,
    });
  }

  if (["previewed", "validated", "restored", "no_op"].includes(entry.result)) {
    return buildIncident({
      type: "recovery_observed",
      severity: "info",
      summary: entry.summary,
      suggestedNextAction: entry.result === "validated" ? "Apply only if governance and guardrails still hold." : "No operator action is required.",
      restorePointId: entry.restorePointId,
      affectedProfiles: entry.affectedProfiles,
      sourceKind: "history",
      result: entry.result,
      reason,
      timestamp: entry.timestamp,
      requiresEscalation: false,
    });
  }

  return null;
}

export async function classifySandboxRecoveryIncidents(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const history = await querySandboxHistory({
    configPath: params.configPath,
    kind: "all",
    limit: Math.max(limit * 3, 25),
  });
  const retention = await inspectSandboxRestorePointRetention({
    configPath: params.configPath,
    state: params.state,
  });
  const incidents: SandboxRecoveryIncident[] = [];
  const blockedCounter = new Map<string, number>();

  for (const entry of history.entries) {
    const incident = classifyHistoryEntry(entry);
    if (!incident) {
      continue;
    }
    incidents.push(incident);
    if (["blocked", "manual_required", "critical"].includes(incident.severity)) {
      for (const profileId of incident.affectedProfiles) {
        blockedCounter.set(profileId, (blockedCounter.get(profileId) ?? 0) + 1);
      }
    }
  }

  for (const restorePointId of retention.expiredRestorePointIds) {
    incidents.push(
      buildIncident({
        type: "restore_point_expired",
        severity: "manual_required",
        summary: `Restore point '${restorePointId}' is expired and should not be used for rollback apply.`,
        suggestedNextAction: "Create a fresh restore point or review the expired point manually before recovery.",
        restorePointId,
        affectedProfiles: [],
        sourceKind: "retention",
        result: "expired",
        reason: "sandbox_restore_point_expired",
        timestamp: `retention:${restorePointId}`,
        requiresEscalation: true,
      }),
    );
  }

  for (const [profileId, count] of blockedCounter.entries()) {
    if (count < 2) {
      continue;
    }
    incidents.push(
      buildIncident({
        type: "repeated_blocked_hotspot",
        severity: "warning",
        summary: `Profile '${profileId}' was blocked or manual_required ${count} time(s) across recent recovery events.`,
        suggestedNextAction: "Inspect this profile's governance and guardrails before the next recovery attempt.",
        restorePointId: null,
        affectedProfiles: [profileId],
        sourceKind: "hotspot",
        result: "repeated",
        reason: null,
        timestamp: `hotspot:${profileId}`,
        requiresEscalation: false,
      }),
    );
  }

  if (params.loadedRegistry && params.state.lastRestorePointId) {
    const compare = await compareSandboxRestorePoints({
      configPath: params.configPath,
      loadedRegistry: params.loadedRegistry,
      restorePointId: params.state.lastRestorePointId,
    });
    if (
      compare.status === "ready" &&
      (compare.impactSummary.defaultProfileImpact !== null ||
        compare.impactSummary.blockedProfileIds.length > 0 ||
        compare.impactSummary.manualRequiredProfileIds.length > 0)
    ) {
      incidents.push(
        buildIncident({
          type: "high_risk_compare",
          severity: compare.impactSummary.defaultProfileImpact ? "critical" : "warning",
          summary: compare.summary,
          suggestedNextAction:
            compare.impactSummary.defaultProfileImpact !== null
              ? "Escalate or request review before applying a rollback that changes the default sandbox profile."
              : "Run rollback preview/validate and inspect blocked/manual_required indicators before apply.",
          restorePointId: params.state.lastRestorePointId,
          affectedProfiles: compare.impactSummary.affectedProfileIds,
          sourceKind: "compare",
          result: compare.status,
          reason: compare.failureReason,
          timestamp: `compare:${params.state.lastRestorePointId}`,
          requiresEscalation: compare.impactSummary.defaultProfileImpact !== null,
        }),
      );
    }
  }

  const deduped = Array.from(new Map(incidents.map((incident) => [incident.id, incident])).values())
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, limit);
  const latestIncident = deduped[0] ?? null;
  const escalationNeededCount = deduped.filter((incident) => incident.requiresEscalation).length;
  const summary =
    deduped.length === 0
      ? "No sandbox recovery incidents detected."
      : `Sandbox recovery incidents: ${deduped.length} item(s), escalation needed for ${escalationNeededCount}.`;
  const suggestedNextAction =
    latestIncident?.severity === "critical"
      ? "Escalate the latest critical recovery incident before any further rollback/apply."
      : latestIncident?.severity === "manual_required"
        ? "Request review or resolve the manual_required incident before retrying recovery."
        : latestIncident?.severity === "blocked"
          ? "Run preview or validate only after fixing the blocked governance/guardrails issue."
          : latestIncident?.severity === "warning"
            ? "Inspect the warning incident before the next apply."
            : "No recovery incident escalation is currently required.";

  return {
    incidents: deduped,
    latestIncident,
    unresolvedCount: deduped.length,
    escalationNeededCount,
    summary,
    suggestedNextAction,
  } satisfies SandboxIncidentGovernanceResult;
}

export function formatSandboxIncidentGovernance(result: SandboxIncidentGovernanceResult) {
  return [
    `Sandbox recovery incidents: ${result.unresolvedCount}`,
    `Escalation needed: ${result.escalationNeededCount}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.suggestedNextAction}`,
    ...(result.incidents.length > 0
      ? ["Incidents:", ...result.incidents.map((incident) => `- ${incident.severity} ${incident.type} ${incident.summary}`)]
      : []),
  ].join("\n");
}
