import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { buildSandboxGovernanceStatus } from "../sandbox-governance-status";
import { classifySandboxRecoveryIncidents } from "../sandbox-incident-governance";
import { resolveSandboxIncidentPolicy } from "../sandbox-incident-policy";
import { buildSandboxResolutionEvidenceSummary } from "../sandbox-resolution-evidence";

export type SandboxClosureGatingReasonCode =
  | "blocked_terminal_incident"
  | "manual_required_terminal_incident"
  | "unresolved_incident_remaining"
  | "escalation_still_needed"
  | "manual_review_still_required"
  | "request_review_required"
  | "rerun_validate_required"
  | "rerun_apply_required"
  | "resolved_without_clearance";

export type SandboxClosureGatingDecision = {
  latestIncidentType: OrchestratorState["lastIncidentType"];
  latestIncidentSeverity: OrchestratorState["lastIncidentSeverity"];
  latestIncidentSummary: string | null;
  latestOperatorAction: OrchestratorState["lastOperatorAction"];
  latestOperatorActionStatus: OrchestratorState["lastOperatorActionStatus"];
  closureAllowed: boolean;
  closureStatus: "closure_ready" | "operator_flow" | "review_required" | "blocked" | "resolved_not_ready";
  blockedTerminalState: boolean;
  manualRequiredTerminalState: boolean;
  requestReviewRequired: boolean;
  rerunValidateRequired: boolean;
  rerunApplyRequired: boolean;
  escalateRequired: boolean;
  blockedReasonCodes: SandboxClosureGatingReasonCode[];
  blockedReasons: string[];
  recommendedNextStep: string;
  summary: string;
};

function describeBlockedReason(code: SandboxClosureGatingReasonCode) {
  switch (code) {
    case "blocked_terminal_incident":
      return "The latest incident is in a blocked terminal state and cannot be safely closed.";
    case "manual_required_terminal_incident":
      return "The latest incident is in a manual-required terminal state and cannot be safely closed.";
    case "unresolved_incident_remaining":
      return "There are still unresolved incidents in the recovery trail.";
    case "escalation_still_needed":
      return "Escalation is still required before closure.";
    case "manual_review_still_required":
      return "Manual review is still required before closure.";
    case "request_review_required":
      return "A review request should be recorded before closure.";
    case "rerun_validate_required":
      return "Validation evidence is still required before closure.";
    case "rerun_apply_required":
      return "Apply evidence is still required before closure.";
    case "resolved_without_clearance":
      return "The incident was marked resolved, but governance still does not consider it closure-ready.";
  }
}

function nextStepForBlockedReason(code: SandboxClosureGatingReasonCode) {
  switch (code) {
    case "blocked_terminal_incident":
      return "rerun_preview";
    case "manual_required_terminal_incident":
    case "manual_review_still_required":
    case "request_review_required":
      return "request_review";
    case "escalation_still_needed":
      return "escalate";
    case "rerun_validate_required":
      return "rerun_validate";
    case "rerun_apply_required":
      return "rerun_apply";
    case "resolved_without_clearance":
      return "sandbox:resolution:evidence";
    case "unresolved_incident_remaining":
      return "sandbox:incident:policy";
  }
}

export async function buildSandboxClosureGatingDecision(params: {
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
  const evidence = await buildSandboxResolutionEvidenceSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const policy = resolveSandboxIncidentPolicy(incidents.latestIncident);
  const blockedReasonCodes: SandboxClosureGatingReasonCode[] = [];

  if (policy.blockedTerminalState) {
    blockedReasonCodes.push("blocked_terminal_incident");
  }
  if (policy.manualRequiredTerminalState) {
    blockedReasonCodes.push("manual_required_terminal_incident");
  }
  if (governance.latestUnresolvedIncidentCount > 0) {
    blockedReasonCodes.push("unresolved_incident_remaining");
  }
  if (governance.latestEscalationNeededCount > 0) {
    blockedReasonCodes.push("escalation_still_needed");
  }
  if (governance.manualReviewRequired) {
    blockedReasonCodes.push("manual_review_still_required");
  }
  if (policy.requireRequestReview && !evidence.requestReviewAttempted) {
    blockedReasonCodes.push("request_review_required");
  }
  if (policy.allowRerunValidate && !evidence.validationEvidenceExists) {
    blockedReasonCodes.push("rerun_validate_required");
  }
  if (policy.allowRerunApply && !evidence.applyEvidenceExists) {
    blockedReasonCodes.push("rerun_apply_required");
  }
  if (
    governance.latestOperatorAction === "mark_resolved" &&
    (blockedReasonCodes.length > 0 || policy.blockedTerminalState || policy.manualRequiredTerminalState)
  ) {
    blockedReasonCodes.push("resolved_without_clearance");
  }

  const dedupedCodes = Array.from(new Set(blockedReasonCodes));
  const blockedReasons = dedupedCodes.map(describeBlockedReason);
  const closureAllowed =
    dedupedCodes.length === 0 &&
    (governance.latestIncidentSeverity === null ||
      governance.latestIncidentSeverity === "info" ||
      governance.latestOperatorAction === "mark_resolved");
  const closureStatus =
    closureAllowed
      ? "closure_ready"
      : governance.latestOperatorAction === "mark_resolved"
        ? "resolved_not_ready"
        : policy.blockedTerminalState
          ? "blocked"
          : policy.manualRequiredTerminalState || policy.requireRequestReview || policy.requireEscalate
            ? "review_required"
            : "operator_flow";
  const recommendedNextStep =
    dedupedCodes.length > 0
      ? nextStepForBlockedReason(dedupedCodes[0]) ?? governance.recommendedNextStep
      : governance.recommendedNextStep;
  const summary =
    closureAllowed
      ? "Sandbox closure gating allows this incident set to be treated as closure-ready."
      : `Sandbox closure gating blocked closure with ${dedupedCodes.length} reason(s): ${dedupedCodes.join(", ")}.`;

  return {
    latestIncidentType: governance.latestIncidentType,
    latestIncidentSeverity: governance.latestIncidentSeverity,
    latestIncidentSummary: governance.latestIncidentSummary,
    latestOperatorAction: governance.latestOperatorAction,
    latestOperatorActionStatus: governance.latestOperatorActionStatus,
    closureAllowed,
    closureStatus,
    blockedTerminalState: policy.blockedTerminalState,
    manualRequiredTerminalState: policy.manualRequiredTerminalState,
    requestReviewRequired: policy.requireRequestReview,
    rerunValidateRequired: policy.allowRerunValidate && !evidence.validationEvidenceExists,
    rerunApplyRequired: policy.allowRerunApply && !evidence.applyEvidenceExists,
    escalateRequired: policy.requireEscalate,
    blockedReasonCodes: dedupedCodes,
    blockedReasons,
    recommendedNextStep,
    summary,
  } satisfies SandboxClosureGatingDecision;
}

export function formatSandboxClosureGatingDecision(result: SandboxClosureGatingDecision) {
  return [
    "Sandbox closure gating",
    `Latest incident: ${result.latestIncidentType}/${result.latestIncidentSeverity ?? "none"}`,
    `Latest incident summary: ${result.latestIncidentSummary ?? "none"}`,
    `Latest operator action: ${result.latestOperatorAction}/${result.latestOperatorActionStatus}`,
    `Closure allowed: ${result.closureAllowed}`,
    `Closure status: ${result.closureStatus}`,
    `Blocked terminal: ${result.blockedTerminalState}`,
    `Manual required terminal: ${result.manualRequiredTerminalState}`,
    `Request review required: ${result.requestReviewRequired}`,
    `Rerun validate required: ${result.rerunValidateRequired}`,
    `Rerun apply required: ${result.rerunApplyRequired}`,
    `Escalate required: ${result.escalateRequired}`,
    `Blocked reason codes: ${result.blockedReasonCodes.join(", ") || "none"}`,
    `Blocked reasons: ${result.blockedReasons.join(" | ") || "none"}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.recommendedNextStep}`,
  ].join("\n");
}
