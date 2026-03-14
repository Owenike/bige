import type {
  SandboxIncidentSeverity,
  SandboxIncidentType,
  SandboxRecoveryIncident,
} from "../sandbox-incident-governance";
import type { SandboxOperatorAction } from "../sandbox-operator-actions";

export type SandboxIncidentPolicyDecision = {
  incidentId: string | null;
  incidentType: SandboxIncidentType | "none";
  incidentSeverity: SandboxIncidentSeverity | null;
  recommendedAction: SandboxOperatorAction | "none";
  allowRerunPreview: boolean;
  allowRerunValidate: boolean;
  allowRerunApply: boolean;
  requireRequestReview: boolean;
  requireEscalate: boolean;
  blockedTerminalState: boolean;
  manualRequiredTerminalState: boolean;
  summary: string;
  suggestedNextAction: string;
};

function buildNoIncidentPolicy(): SandboxIncidentPolicyDecision {
  return {
    incidentId: null,
    incidentType: "none",
    incidentSeverity: null,
    recommendedAction: "none",
    allowRerunPreview: false,
    allowRerunValidate: false,
    allowRerunApply: false,
    requireRequestReview: false,
    requireEscalate: false,
    blockedTerminalState: false,
    manualRequiredTerminalState: false,
    summary: "No active recovery incident policy is currently required.",
    suggestedNextAction: "No incident-specific operator action is required.",
  };
}

function buildPolicy(params: Omit<SandboxIncidentPolicyDecision, "summary" | "suggestedNextAction">): SandboxIncidentPolicyDecision {
  const rerunAllowance = [
    params.allowRerunPreview ? "preview" : null,
    params.allowRerunValidate ? "validate" : null,
    params.allowRerunApply ? "apply" : null,
  ].filter((value): value is string => value !== null);
  const summary = [
    `Incident policy for ${params.incidentType}/${params.incidentSeverity ?? "none"}`,
    `recommends ${params.recommendedAction}`,
    `rerun=${rerunAllowance.join(",") || "none"}`,
    `requestReview=${params.requireRequestReview}`,
    `escalate=${params.requireEscalate}`,
    `blockedTerminal=${params.blockedTerminalState}`,
    `manualRequiredTerminal=${params.manualRequiredTerminalState}`,
  ].join(", ");
  let suggestedNextAction = "Acknowledge the incident and continue monitoring recovery diagnostics.";
  if (params.recommendedAction === "rerun_preview") {
    suggestedNextAction = "Rerun preview only after confirming governance and guardrails still hold.";
  } else if (params.recommendedAction === "rerun_validate") {
    suggestedNextAction = "Rerun validate before any apply decision so recovery gates are re-checked.";
  } else if (params.recommendedAction === "rerun_apply") {
    suggestedNextAction = "Rerun apply only if governance, guardrails, and restore point safety still pass.";
  } else if (params.recommendedAction === "request_review") {
    suggestedNextAction = "Request review before any additional recovery apply attempt.";
  } else if (params.recommendedAction === "escalate") {
    suggestedNextAction = "Escalate the incident and hand off to another operator before retrying recovery.";
  } else if (params.recommendedAction === "mark_resolved") {
    suggestedNextAction = "Mark the incident resolved only after confirming the recovery issue is gone.";
  }
  return {
    ...params,
    summary,
    suggestedNextAction,
  };
}

export function resolveSandboxIncidentPolicy(
  incident: SandboxRecoveryIncident | null | undefined,
): SandboxIncidentPolicyDecision {
  if (!incident) {
    return buildNoIncidentPolicy();
  }

  const hasRestorePoint = Boolean(incident.restorePointId);

  if (incident.severity === "critical") {
    return buildPolicy({
      incidentId: incident.id,
      incidentType: incident.type,
      incidentSeverity: incident.severity,
      recommendedAction: "escalate",
      allowRerunPreview: false,
      allowRerunValidate: false,
      allowRerunApply: false,
      requireRequestReview: true,
      requireEscalate: true,
      blockedTerminalState: true,
      manualRequiredTerminalState: true,
    });
  }

  if (incident.severity === "manual_required") {
    return buildPolicy({
      incidentId: incident.id,
      incidentType: incident.type,
      incidentSeverity: incident.severity,
      recommendedAction: "request_review",
      allowRerunPreview: false,
      allowRerunValidate: false,
      allowRerunApply: false,
      requireRequestReview: true,
      requireEscalate: incident.requiresEscalation,
      blockedTerminalState: false,
      manualRequiredTerminalState: true,
    });
  }

  if (incident.severity === "blocked") {
    return buildPolicy({
      incidentId: incident.id,
      incidentType: incident.type,
      incidentSeverity: incident.severity,
      recommendedAction: hasRestorePoint ? "rerun_preview" : "request_review",
      allowRerunPreview: hasRestorePoint,
      allowRerunValidate: hasRestorePoint && incident.type !== "guardrails_failed",
      allowRerunApply: false,
      requireRequestReview: !hasRestorePoint,
      requireEscalate: false,
      blockedTerminalState: true,
      manualRequiredTerminalState: false,
    });
  }

  if (incident.severity === "warning") {
    const recommendValidate = incident.type === "batch_partial_restore";
    const recommendReview = incident.type === "repeated_blocked_hotspot";
    return buildPolicy({
      incidentId: incident.id,
      incidentType: incident.type,
      incidentSeverity: incident.severity,
      recommendedAction: recommendReview
        ? "request_review"
        : recommendValidate && hasRestorePoint
          ? "rerun_validate"
          : hasRestorePoint
            ? "rerun_preview"
            : "acknowledge",
      allowRerunPreview: hasRestorePoint,
      allowRerunValidate: hasRestorePoint && (recommendValidate || incident.type === "high_risk_compare"),
      allowRerunApply: false,
      requireRequestReview: recommendReview,
      requireEscalate: false,
      blockedTerminalState: false,
      manualRequiredTerminalState: false,
    });
  }

  return buildPolicy({
    incidentId: incident.id,
    incidentType: incident.type,
    incidentSeverity: incident.severity,
    recommendedAction: "acknowledge",
    allowRerunPreview: false,
    allowRerunValidate: false,
    allowRerunApply: false,
    requireRequestReview: false,
    requireEscalate: false,
    blockedTerminalState: false,
    manualRequiredTerminalState: false,
  });
}

export function formatSandboxIncidentPolicy(policy: SandboxIncidentPolicyDecision) {
  return [
    "Sandbox incident policy",
    `Incident: ${policy.incidentId ?? "none"}`,
    `Type: ${policy.incidentType}`,
    `Severity: ${policy.incidentSeverity ?? "none"}`,
    `Recommended action: ${policy.recommendedAction}`,
    `Rerun preview: ${policy.allowRerunPreview}`,
    `Rerun validate: ${policy.allowRerunValidate}`,
    `Rerun apply: ${policy.allowRerunApply}`,
    `Request review required: ${policy.requireRequestReview}`,
    `Escalate required: ${policy.requireEscalate}`,
    `Blocked terminal: ${policy.blockedTerminalState}`,
    `Manual required terminal: ${policy.manualRequiredTerminalState}`,
    `Summary: ${policy.summary}`,
    `Next action: ${policy.suggestedNextAction}`,
  ].join("\n");
}
