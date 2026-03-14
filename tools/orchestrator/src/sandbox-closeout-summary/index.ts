import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { buildSandboxGovernanceStatus } from "../sandbox-governance-status";
import { buildSandboxClosureGatingDecision } from "../sandbox-closure-gating";
import { buildSandboxResolutionEvidenceSummary } from "../sandbox-resolution-evidence";
import { buildSandboxResolutionReadiness } from "../sandbox-resolution-readiness";
import { listSandboxResolutionAuditLogs, type SandboxResolutionAuditLog } from "../sandbox-resolution-audit";

export type SandboxCloseoutSummary = {
  latestCloseoutDecision: "closure_ready" | "operator_flow" | "review_required" | "blocked" | "resolved_not_ready";
  latestIncidentType: OrchestratorState["lastIncidentType"];
  latestIncidentSeverity: OrchestratorState["lastIncidentSeverity"];
  latestIncidentSummary: string | null;
  latestOperatorActionSummary: string | null;
  evidenceSufficiencySummary: string;
  readinessSummary: string;
  gatingSummary: string;
  unresolvedHotspotSummary: string;
  openGovernanceWarnings: string[];
  recommendedNextStepAfterCloseoutCheck: string;
  handoffLine: string;
  latestAuditSummaryLine: string | null;
  latestAuditTimestamp: string | null;
  summary: string;
};

export async function buildSandboxCloseoutSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  latestAuditLog?: SandboxResolutionAuditLog | null;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const governance = await buildSandboxGovernanceStatus({
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
  const readiness = await buildSandboxResolutionReadiness({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const gating = await buildSandboxClosureGatingDecision({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const latestAudit =
    params.latestAuditLog ??
    (await listSandboxResolutionAuditLogs({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;
  const evidenceSufficiencySummary =
    evidence.evidenceGapCodes.length === 0
      ? "Evidence is sufficient for closure review."
      : `Evidence gaps remain: ${evidence.evidenceGapCodes.join(", ")}.`;
  const unresolvedHotspotSummary = governance.unresolvedHotspots.join(", ") || "none";
  const handoffLine = gating.closureAllowed
    ? `Sandbox closeout handoff: latest ${readiness.latestIncidentType}/${readiness.latestIncidentSeverity ?? "none"} is closure-ready.`
    : `Sandbox closeout handoff: latest ${readiness.latestIncidentType}/${readiness.latestIncidentSeverity ?? "none"} is ${gating.closureStatus}; next=${readiness.recommendedNextStepBeforeClosure}.`;
  const summary = gating.closureAllowed
    ? "Sandbox closeout summary confirms that current evidence, readiness, and gating all allow safe closure."
    : `Sandbox closeout summary keeps this incident in ${gating.closureStatus} because closure is not yet safe.`;

  return {
    latestCloseoutDecision: gating.closureStatus,
    latestIncidentType: readiness.latestIncidentType,
    latestIncidentSeverity: readiness.latestIncidentSeverity,
    latestIncidentSummary: readiness.latestIncidentSummary,
    latestOperatorActionSummary: evidence.latestOperatorActionTrailSummary,
    evidenceSufficiencySummary,
    readinessSummary: readiness.summary,
    gatingSummary: gating.summary,
    unresolvedHotspotSummary,
    openGovernanceWarnings: governance.governanceWarnings,
    recommendedNextStepAfterCloseoutCheck: readiness.recommendedNextStepBeforeClosure,
    handoffLine,
    latestAuditSummaryLine: latestAudit?.summaryLine ?? null,
    latestAuditTimestamp: latestAudit?.auditedAt ?? null,
    summary,
  } satisfies SandboxCloseoutSummary;
}

export function formatSandboxCloseoutSummary(result: SandboxCloseoutSummary) {
  return [
    "Sandbox closeout summary",
    `Latest closeout decision: ${result.latestCloseoutDecision}`,
    `Latest incident: ${result.latestIncidentType}/${result.latestIncidentSeverity ?? "none"}`,
    `Latest incident summary: ${result.latestIncidentSummary ?? "none"}`,
    `Latest operator action summary: ${result.latestOperatorActionSummary ?? "none"}`,
    `Evidence sufficiency: ${result.evidenceSufficiencySummary}`,
    `Readiness: ${result.readinessSummary}`,
    `Gating: ${result.gatingSummary}`,
    `Unresolved hotspots: ${result.unresolvedHotspotSummary}`,
    `Governance warnings: ${result.openGovernanceWarnings.join(" | ") || "none"}`,
    `Latest audit: ${result.latestAuditTimestamp ?? "none"} ${result.latestAuditSummaryLine ?? ""}`.trimEnd(),
    `Handoff line: ${result.handoffLine}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.recommendedNextStepAfterCloseoutCheck}`,
  ].join("\n");
}
