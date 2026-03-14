import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { buildSandboxGovernanceStatus } from "../sandbox-governance-status";
import { classifySandboxRecoveryIncidents } from "../sandbox-incident-governance";
import { resolveSandboxIncidentPolicy } from "../sandbox-incident-policy";
import { listSandboxOperatorActions } from "../sandbox-operator-actions";

export type SandboxResolutionEvidenceGapCode =
  | "unresolved_incident_remaining"
  | "escalation_still_needed"
  | "manual_review_still_required"
  | "rerun_preview_missing"
  | "rerun_validate_missing"
  | "rerun_apply_missing"
  | "request_review_missing"
  | "escalate_missing"
  | "mark_resolved_without_clearance";

export type SandboxResolutionEvidenceSummary = {
  latestIncidentType: OrchestratorState["lastIncidentType"];
  latestIncidentSeverity: OrchestratorState["lastIncidentSeverity"];
  latestIncidentSummary: string | null;
  latestOperatorAction: OrchestratorState["lastOperatorAction"];
  latestOperatorActionStatus: OrchestratorState["lastOperatorActionStatus"];
  latestOperatorActionTrailSummary: string | null;
  rerunPreviewAttempted: boolean;
  rerunValidateAttempted: boolean;
  rerunApplyAttempted: boolean;
  requestReviewAttempted: boolean;
  escalateAttempted: boolean;
  rerunEvidenceExists: boolean;
  validationEvidenceExists: boolean;
  applyEvidenceExists: boolean;
  unresolvedHotspots: string[];
  repeatedBlockedManualRequiredHotspots: string[];
  closureConfidence: "low" | "medium" | "high";
  evidenceGapCodes: SandboxResolutionEvidenceGapCode[];
  evidenceGaps: string[];
  recommendedEvidenceToCollectNext: string[];
  summary: string;
};

function gapDescription(code: SandboxResolutionEvidenceGapCode) {
  switch (code) {
    case "unresolved_incident_remaining":
      return "There is still at least one unresolved recovery incident.";
    case "escalation_still_needed":
      return "Escalation is still required before safe closure.";
    case "manual_review_still_required":
      return "Manual review is still required before safe closure.";
    case "rerun_preview_missing":
      return "Preview evidence is still missing for the current recovery decision.";
    case "rerun_validate_missing":
      return "Validate evidence is still missing for the current recovery decision.";
    case "rerun_apply_missing":
      return "Apply evidence is still missing for the current recovery decision.";
    case "request_review_missing":
      return "A review request should be recorded before closure.";
    case "escalate_missing":
      return "An escalation should be recorded before closure.";
    case "mark_resolved_without_clearance":
      return "The incident was marked resolved, but governance still does not consider it closure-ready.";
  }
}

function nextEvidenceForGap(code: SandboxResolutionEvidenceGapCode) {
  switch (code) {
    case "unresolved_incident_remaining":
      return "rerun_preview";
    case "escalation_still_needed":
    case "escalate_missing":
      return "escalate";
    case "manual_review_still_required":
    case "request_review_missing":
      return "request_review";
    case "rerun_preview_missing":
      return "rerun_preview";
    case "rerun_validate_missing":
      return "rerun_validate";
    case "rerun_apply_missing":
      return "rerun_apply";
    case "mark_resolved_without_clearance":
      return "closure_check";
  }
}

export async function buildSandboxResolutionEvidenceSummary(params: {
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
  const governance = await buildSandboxGovernanceStatus({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const actions = await listSandboxOperatorActions({
    configPath: params.configPath,
    limit: Math.max(limit * 2, 20),
  });

  const policy = resolveSandboxIncidentPolicy(incidents.latestIncident);
  const rerunPreviewAttempted = actions.records.some((record) => record.action === "rerun_preview");
  const rerunValidateAttempted = actions.records.some((record) => record.action === "rerun_validate");
  const rerunApplyAttempted = actions.records.some((record) => record.action === "rerun_apply");
  const requestReviewAttempted = actions.records.some((record) => record.action === "request_review");
  const escalateAttempted = actions.records.some((record) => record.action === "escalate");
  const rerunEvidenceExists = rerunPreviewAttempted || rerunValidateAttempted || rerunApplyAttempted;
  const validationEvidenceExists = rerunValidateAttempted;
  const applyEvidenceExists = rerunApplyAttempted;
  const evidenceGapCodes: SandboxResolutionEvidenceGapCode[] = [];

  if (governance.latestUnresolvedIncidentCount > 0) {
    evidenceGapCodes.push("unresolved_incident_remaining");
  }
  if (governance.latestEscalationNeededCount > 0) {
    evidenceGapCodes.push("escalation_still_needed");
  }
  if (governance.manualReviewRequired) {
    evidenceGapCodes.push("manual_review_still_required");
  }
  if (policy.allowRerunPreview && !rerunPreviewAttempted) {
    evidenceGapCodes.push("rerun_preview_missing");
  }
  if (policy.allowRerunValidate && !validationEvidenceExists) {
    evidenceGapCodes.push("rerun_validate_missing");
  }
  if (policy.allowRerunApply && !applyEvidenceExists) {
    evidenceGapCodes.push("rerun_apply_missing");
  }
  if (policy.requireRequestReview && !requestReviewAttempted) {
    evidenceGapCodes.push("request_review_missing");
  }
  if (policy.requireEscalate && !escalateAttempted) {
    evidenceGapCodes.push("escalate_missing");
  }
  if (
    governance.latestOperatorAction === "mark_resolved" &&
    (policy.manualRequiredTerminalState ||
      policy.blockedTerminalState ||
      governance.latestEscalationNeededCount > 0)
  ) {
    evidenceGapCodes.push("mark_resolved_without_clearance");
  }

  const repeatedBlockedManualRequiredHotspots = incidents.incidents
    .filter((incident) => incident.type === "repeated_blocked_hotspot")
    .flatMap((incident) => incident.affectedProfiles)
    .filter((profileId, index, array) => array.indexOf(profileId) === index)
    .sort();
  const evidenceGaps = evidenceGapCodes.map(gapDescription);
  const recommendedEvidenceToCollectNext = Array.from(
    new Set(evidenceGapCodes.map(nextEvidenceForGap).filter(Boolean)),
  );
  const closureConfidence =
    evidenceGapCodes.length === 0
      ? "high"
      : evidenceGapCodes.length <= 2 && governance.latestEscalationNeededCount === 0
        ? "medium"
        : "low";
  const latestOperatorActionTrailSummary = actions.records[0]
    ? `${actions.records[0].actedAt} ${actions.records[0].action} ${actions.records[0].status} ${actions.records[0].summary}`
    : null;
  const summary =
    evidenceGapCodes.length === 0
      ? "Sandbox resolution evidence is complete enough for closure evaluation."
      : `Sandbox resolution evidence has ${evidenceGapCodes.length} gap(s): ${evidenceGapCodes.join(", ")}.`;

  return {
    latestIncidentType: governance.latestIncidentType,
    latestIncidentSeverity: governance.latestIncidentSeverity,
    latestIncidentSummary: governance.latestIncidentSummary,
    latestOperatorAction: governance.latestOperatorAction,
    latestOperatorActionStatus: governance.latestOperatorActionStatus,
    latestOperatorActionTrailSummary,
    rerunPreviewAttempted,
    rerunValidateAttempted,
    rerunApplyAttempted,
    requestReviewAttempted,
    escalateAttempted,
    rerunEvidenceExists,
    validationEvidenceExists,
    applyEvidenceExists,
    unresolvedHotspots: governance.unresolvedHotspots,
    repeatedBlockedManualRequiredHotspots,
    closureConfidence,
    evidenceGapCodes,
    evidenceGaps,
    recommendedEvidenceToCollectNext,
    summary,
  } satisfies SandboxResolutionEvidenceSummary;
}

export function formatSandboxResolutionEvidenceSummary(result: SandboxResolutionEvidenceSummary) {
  return [
    "Sandbox resolution evidence",
    `Latest incident: ${result.latestIncidentType}/${result.latestIncidentSeverity ?? "none"}`,
    `Latest incident summary: ${result.latestIncidentSummary ?? "none"}`,
    `Latest operator action: ${result.latestOperatorAction}/${result.latestOperatorActionStatus}`,
    `Latest operator action trail: ${result.latestOperatorActionTrailSummary ?? "none"}`,
    `Rerun preview attempted: ${result.rerunPreviewAttempted}`,
    `Rerun validate attempted: ${result.rerunValidateAttempted}`,
    `Rerun apply attempted: ${result.rerunApplyAttempted}`,
    `Request review attempted: ${result.requestReviewAttempted}`,
    `Escalate attempted: ${result.escalateAttempted}`,
    `Rerun evidence exists: ${result.rerunEvidenceExists}`,
    `Validation evidence exists: ${result.validationEvidenceExists}`,
    `Apply evidence exists: ${result.applyEvidenceExists}`,
    `Closure confidence: ${result.closureConfidence}`,
    `Unresolved hotspots: ${result.unresolvedHotspots.join(", ") || "none"}`,
    `Repeated blocked/manual_required hotspots: ${result.repeatedBlockedManualRequiredHotspots.join(", ") || "none"}`,
    `Evidence gaps: ${result.evidenceGaps.join(" | ") || "none"}`,
    `Recommended evidence next: ${result.recommendedEvidenceToCollectNext.join(", ") || "none"}`,
    `Summary: ${result.summary}`,
  ].join("\n");
}
