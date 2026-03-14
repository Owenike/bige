import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { buildSandboxGovernanceStatus } from "../sandbox-governance-status";
import { buildSandboxClosureGatingDecision } from "../sandbox-closure-gating";
import { buildSandboxResolutionEvidenceSummary } from "../sandbox-resolution-evidence";
import { buildSandboxResolutionReadiness } from "../sandbox-resolution-readiness";

export type SandboxCloseoutChecklistItem = {
  key:
    | "rerun_preview_evidence"
    | "rerun_validate_evidence"
    | "rerun_apply_evidence"
    | "unresolved_incidents"
    | "request_review"
    | "escalation"
    | "blocked_terminal"
    | "manual_required_terminal"
    | "evidence_gaps"
    | "governance_warnings";
  satisfied: boolean;
  summary: string;
  suggestedNextAction: string;
};

export type SandboxCloseoutOperatorChecklist = {
  latestIncidentType: OrchestratorState["lastIncidentType"];
  latestIncidentSeverity: OrchestratorState["lastIncidentSeverity"];
  latestIncidentSummary: string | null;
  latestOperatorAction: OrchestratorState["lastOperatorAction"];
  latestOperatorActionStatus: OrchestratorState["lastOperatorActionStatus"];
  rerunPreviewEvidenceSatisfied: boolean;
  rerunValidateEvidenceSatisfied: boolean;
  rerunApplyEvidenceSatisfied: boolean;
  unresolvedIncidentsCleared: boolean;
  requestReviewSatisfied: boolean;
  escalationSatisfied: boolean;
  noBlockedTerminalState: boolean;
  noManualRequiredTerminalState: boolean;
  noEvidenceGaps: boolean;
  noGovernanceWarnings: boolean;
  safeToCloseout: boolean;
  blockedReasonCodes: string[];
  evidenceGapCodes: string[];
  governanceWarnings: string[];
  items: SandboxCloseoutChecklistItem[];
  recommendedNextStep: string;
  summary: string;
};

function buildChecklistItem(
  key: SandboxCloseoutChecklistItem["key"],
  satisfied: boolean,
  summary: string,
  suggestedNextAction: string,
) {
  return { key, satisfied, summary, suggestedNextAction } satisfies SandboxCloseoutChecklistItem;
}

export async function buildSandboxCloseoutOperatorChecklist(params: {
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
  const readiness = await buildSandboxResolutionReadiness({
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
  const rerunPreviewEvidenceSatisfied =
    !evidence.evidenceGapCodes.includes("rerun_preview_missing");
  const rerunValidateEvidenceSatisfied =
    !evidence.evidenceGapCodes.includes("rerun_validate_missing");
  const rerunApplyEvidenceSatisfied =
    !evidence.evidenceGapCodes.includes("rerun_apply_missing");
  const unresolvedIncidentsCleared = !readiness.unresolvedIncidentsRemain;
  const requestReviewSatisfied =
    !closure.requestReviewRequired || evidence.requestReviewAttempted;
  const escalationSatisfied =
    !closure.escalateRequired || evidence.escalateAttempted;
  const noBlockedTerminalState = !closure.blockedTerminalState;
  const noManualRequiredTerminalState = !closure.manualRequiredTerminalState;
  const noEvidenceGaps = evidence.evidenceGapCodes.length === 0;
  const noGovernanceWarnings = governance.governanceWarnings.length === 0;
  const items: SandboxCloseoutChecklistItem[] = [
    buildChecklistItem(
      "rerun_preview_evidence",
      rerunPreviewEvidenceSatisfied,
      rerunPreviewEvidenceSatisfied ? "Preview evidence is complete." : "Preview evidence is still missing.",
      rerunPreviewEvidenceSatisfied ? "none" : "rerun_preview",
    ),
    buildChecklistItem(
      "rerun_validate_evidence",
      rerunValidateEvidenceSatisfied,
      rerunValidateEvidenceSatisfied ? "Validate evidence is complete." : "Validate evidence is still missing.",
      rerunValidateEvidenceSatisfied ? "none" : "rerun_validate",
    ),
    buildChecklistItem(
      "rerun_apply_evidence",
      rerunApplyEvidenceSatisfied,
      rerunApplyEvidenceSatisfied ? "Apply evidence is complete." : "Apply evidence is still missing.",
      rerunApplyEvidenceSatisfied ? "none" : "rerun_apply",
    ),
    buildChecklistItem(
      "unresolved_incidents",
      unresolvedIncidentsCleared,
      unresolvedIncidentsCleared ? "No unresolved incidents remain." : "Unresolved incidents still remain.",
      unresolvedIncidentsCleared ? "none" : "sandbox:incident:policy",
    ),
    buildChecklistItem(
      "request_review",
      requestReviewSatisfied,
      requestReviewSatisfied ? "No outstanding review request is required." : "A review request is still required.",
      requestReviewSatisfied ? "none" : "request_review",
    ),
    buildChecklistItem(
      "escalation",
      escalationSatisfied,
      escalationSatisfied ? "No outstanding escalation is required." : "Escalation is still required.",
      escalationSatisfied ? "none" : "escalate",
    ),
    buildChecklistItem(
      "blocked_terminal",
      noBlockedTerminalState,
      noBlockedTerminalState ? "No blocked terminal state is active." : "A blocked terminal state is still active.",
      noBlockedTerminalState ? "none" : "rerun_preview",
    ),
    buildChecklistItem(
      "manual_required_terminal",
      noManualRequiredTerminalState,
      noManualRequiredTerminalState ? "No manual-required terminal state is active." : "A manual-required terminal state is still active.",
      noManualRequiredTerminalState ? "none" : "request_review",
    ),
    buildChecklistItem(
      "evidence_gaps",
      noEvidenceGaps,
      noEvidenceGaps ? "No evidence gaps remain." : "Evidence gaps still remain.",
      noEvidenceGaps ? "none" : readiness.recommendedNextStepBeforeClosure,
    ),
    buildChecklistItem(
      "governance_warnings",
      noGovernanceWarnings,
      noGovernanceWarnings ? "No open governance warnings remain." : "Open governance warnings still need operator review.",
      noGovernanceWarnings ? "none" : governance.recommendedNextStep,
    ),
  ];
  const safeToCloseout =
    readiness.closureAllowed &&
    closure.closureAllowed &&
    items.every((item) => item.satisfied);
  const summary = safeToCloseout
    ? "Sandbox closeout checklist is fully satisfied."
    : `Sandbox closeout checklist has ${items.filter((item) => !item.satisfied).length} unsatisfied item(s).`;

  return {
    latestIncidentType: readiness.latestIncidentType,
    latestIncidentSeverity: readiness.latestIncidentSeverity,
    latestIncidentSummary: readiness.latestIncidentSummary,
    latestOperatorAction: readiness.latestOperatorAction,
    latestOperatorActionStatus: readiness.latestOperatorActionStatus,
    rerunPreviewEvidenceSatisfied,
    rerunValidateEvidenceSatisfied,
    rerunApplyEvidenceSatisfied,
    unresolvedIncidentsCleared,
    requestReviewSatisfied,
    escalationSatisfied,
    noBlockedTerminalState,
    noManualRequiredTerminalState,
    noEvidenceGaps,
    noGovernanceWarnings,
    safeToCloseout,
    blockedReasonCodes: closure.blockedReasonCodes,
    evidenceGapCodes: evidence.evidenceGapCodes,
    governanceWarnings: governance.governanceWarnings,
    items,
    recommendedNextStep: safeToCloseout ? "closure_ready" : readiness.recommendedNextStepBeforeClosure,
    summary,
  } satisfies SandboxCloseoutOperatorChecklist;
}

export function formatSandboxCloseoutOperatorChecklist(result: SandboxCloseoutOperatorChecklist) {
  return [
    "Sandbox closeout operator checklist",
    `Latest incident: ${result.latestIncidentType}/${result.latestIncidentSeverity ?? "none"}`,
    `Latest incident summary: ${result.latestIncidentSummary ?? "none"}`,
    `Latest operator action: ${result.latestOperatorAction}/${result.latestOperatorActionStatus}`,
    `Safe to closeout: ${result.safeToCloseout}`,
    `Blocked reason codes: ${result.blockedReasonCodes.join(", ") || "none"}`,
    `Evidence gap codes: ${result.evidenceGapCodes.join(", ") || "none"}`,
    `Governance warnings: ${result.governanceWarnings.join(" | ") || "none"}`,
    ...result.items.map(
      (item) => `- ${item.key}: ${item.satisfied} :: ${item.summary} -> ${item.suggestedNextAction}`,
    ),
    `Summary: ${result.summary}`,
    `Next action: ${result.recommendedNextStep}`,
  ].join("\n");
}
