import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { buildSandboxClosureGatingDecision } from "../sandbox-closure-gating";
import { buildSandboxGovernanceStatus } from "../sandbox-governance-status";
import { buildSandboxResolutionEvidenceSummary } from "../sandbox-resolution-evidence";

export type SandboxResolutionReadinessSummary = {
  latestIncidentType: OrchestratorState["lastIncidentType"];
  latestIncidentSeverity: OrchestratorState["lastIncidentSeverity"];
  latestIncidentSummary: string | null;
  latestOperatorAction: OrchestratorState["lastOperatorAction"];
  latestOperatorActionStatus: OrchestratorState["lastOperatorActionStatus"];
  unresolvedIncidentsRemain: boolean;
  escalationStillNeeded: boolean;
  manualReviewStillRequired: boolean;
  rerunEvidenceExists: boolean;
  validationEvidenceExists: boolean;
  applyEvidenceExists: boolean;
  closureAllowed: boolean;
  closureBlockedReasonCodes: string[];
  closureBlockedReasons: string[];
  readinessStatus: "closure_ready" | "operator_flow" | "review_required" | "blocked" | "resolved_not_ready";
  readinessConfidence: "low" | "medium" | "high";
  recommendedNextStepBeforeClosure: string;
  summary: string;
};

export async function buildSandboxResolutionReadiness(params: {
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
  const evidence = await buildSandboxResolutionEvidenceSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const closure = await buildSandboxClosureGatingDecision({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const summary =
    closure.closureAllowed
      ? "Sandbox resolution readiness is closure-ready."
      : `Sandbox resolution readiness is ${closure.closureStatus}; closure is blocked by ${closure.blockedReasonCodes.join(", ") || "operator_flow"}.`;

  return {
    latestIncidentType: governance.latestIncidentType,
    latestIncidentSeverity: governance.latestIncidentSeverity,
    latestIncidentSummary: governance.latestIncidentSummary,
    latestOperatorAction: governance.latestOperatorAction,
    latestOperatorActionStatus: governance.latestOperatorActionStatus,
    unresolvedIncidentsRemain: governance.latestUnresolvedIncidentCount > 0,
    escalationStillNeeded: governance.latestEscalationNeededCount > 0,
    manualReviewStillRequired: governance.manualReviewRequired,
    rerunEvidenceExists: evidence.rerunEvidenceExists,
    validationEvidenceExists: evidence.validationEvidenceExists,
    applyEvidenceExists: evidence.applyEvidenceExists,
    closureAllowed: closure.closureAllowed,
    closureBlockedReasonCodes: closure.blockedReasonCodes,
    closureBlockedReasons: closure.blockedReasons,
    readinessStatus: closure.closureStatus,
    readinessConfidence: evidence.closureConfidence,
    recommendedNextStepBeforeClosure: closure.recommendedNextStep,
    summary,
  } satisfies SandboxResolutionReadinessSummary;
}

export function formatSandboxResolutionReadiness(result: SandboxResolutionReadinessSummary) {
  return [
    "Sandbox resolution readiness",
    `Latest incident: ${result.latestIncidentType}/${result.latestIncidentSeverity ?? "none"}`,
    `Latest incident summary: ${result.latestIncidentSummary ?? "none"}`,
    `Latest operator action: ${result.latestOperatorAction}/${result.latestOperatorActionStatus}`,
    `Unresolved incidents remain: ${result.unresolvedIncidentsRemain}`,
    `Escalation still needed: ${result.escalationStillNeeded}`,
    `Manual review still required: ${result.manualReviewStillRequired}`,
    `Rerun evidence exists: ${result.rerunEvidenceExists}`,
    `Validation evidence exists: ${result.validationEvidenceExists}`,
    `Apply evidence exists: ${result.applyEvidenceExists}`,
    `Closure allowed: ${result.closureAllowed}`,
    `Readiness status: ${result.readinessStatus}`,
    `Readiness confidence: ${result.readinessConfidence}`,
    `Closure blocked reason codes: ${result.closureBlockedReasonCodes.join(", ") || "none"}`,
    `Closure blocked reasons: ${result.closureBlockedReasons.join(" | ") || "none"}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.recommendedNextStepBeforeClosure}`,
  ].join("\n");
}
