import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxResolutionAuditHistory,
  type SandboxResolutionAuditHistory,
} from "../sandbox-resolution-audit-history";
import { buildSandboxCloseoutOperatorChecklist, type SandboxCloseoutOperatorChecklist } from "../sandbox-closeout-checklist";
import { buildSandboxCloseoutSummary, type SandboxCloseoutSummary } from "../sandbox-closeout-summary";

export type SandboxCloseoutReviewSummary = {
  latestCloseoutDecision: SandboxCloseoutSummary["latestCloseoutDecision"] | "none";
  latestIncidentType: OrchestratorState["lastIncidentType"];
  latestIncidentSeverity: OrchestratorState["lastIncidentSeverity"];
  latestIncidentSummary: string | null;
  latestOperatorActionSummary: string | null;
  reviewPending: boolean;
  escalationPending: boolean;
  evidenceFollowUpPending: boolean;
  repeatedReviewHotspots: string[];
  repeatedBlockedHotspots: string[];
  repeatedResolvedNotReadyHotspots: string[];
  governanceWarnings: string[];
  recommendedNextReviewAction: string;
  reviewStatus: "closeout_ready" | "review_pending" | "escalation_pending" | "resolved_but_followup_needed";
  reviewSummaryLine: string;
  summary: string;
};

export async function buildSandboxCloseoutReviewSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  resolutionAuditHistory?: SandboxResolutionAuditHistory;
  closeoutSummary?: SandboxCloseoutSummary;
  closeoutChecklist?: SandboxCloseoutOperatorChecklist;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const resolutionAuditHistory =
    params.resolutionAuditHistory ??
    (await buildSandboxResolutionAuditHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutSummary =
    params.closeoutSummary ??
    (await buildSandboxCloseoutSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutChecklist =
    params.closeoutChecklist ??
    (await buildSandboxCloseoutOperatorChecklist({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));

  const reviewPending =
    !closeoutChecklist.requestReviewSatisfied ||
    resolutionAuditHistory.repeatedReviewRequiredReasons.length > 0;
  const escalationPending =
    !closeoutChecklist.escalationSatisfied ||
    resolutionAuditHistory.repeatedBlockedReasons.some((reason) => /Escalation/i.test(reason));
  const evidenceFollowUpPending = !closeoutChecklist.noEvidenceGaps;
  const reviewStatus = closeoutChecklist.safeToCloseout
    ? "closeout_ready"
    : escalationPending
      ? "escalation_pending"
      : closeoutSummary.latestCloseoutDecision === "resolved_not_ready" || evidenceFollowUpPending
        ? "resolved_but_followup_needed"
        : "review_pending";
  const recommendedNextReviewAction =
    reviewStatus === "closeout_ready"
      ? "closeout_ready"
      : closeoutChecklist.recommendedNextStep;
  const reviewSummaryLine =
    reviewStatus === "closeout_ready"
      ? `Sandbox closeout review: ${closeoutSummary.latestCloseoutDecision} and ready to complete.`
      : `Sandbox closeout review: ${reviewStatus}, latest decision=${closeoutSummary.latestCloseoutDecision}, next=${recommendedNextReviewAction}.`;
  const summary =
    reviewStatus === "closeout_ready"
      ? "Sandbox closeout review summary confirms that no further review or follow-up is pending."
      : `Sandbox closeout review summary keeps follow-up open because status=${reviewStatus}.`;

  return {
    latestCloseoutDecision: closeoutSummary.latestCloseoutDecision,
    latestIncidentType: closeoutSummary.latestIncidentType,
    latestIncidentSeverity: closeoutSummary.latestIncidentSeverity,
    latestIncidentSummary: closeoutSummary.latestIncidentSummary,
    latestOperatorActionSummary: closeoutSummary.latestOperatorActionSummary,
    reviewPending,
    escalationPending,
    evidenceFollowUpPending,
    repeatedReviewHotspots: resolutionAuditHistory.repeatedReviewRequiredReasons,
    repeatedBlockedHotspots: resolutionAuditHistory.repeatedBlockedReasons,
    repeatedResolvedNotReadyHotspots: resolutionAuditHistory.repeatedResolvedNotReadyReasons,
    governanceWarnings: closeoutChecklist.governanceWarnings,
    recommendedNextReviewAction,
    reviewStatus,
    reviewSummaryLine,
    summary,
  } satisfies SandboxCloseoutReviewSummary;
}

export function formatSandboxCloseoutReviewSummary(result: SandboxCloseoutReviewSummary) {
  return [
    "Sandbox closeout review summary",
    `Latest closeout decision: ${result.latestCloseoutDecision}`,
    `Latest incident: ${result.latestIncidentType}/${result.latestIncidentSeverity ?? "none"}`,
    `Latest incident summary: ${result.latestIncidentSummary ?? "none"}`,
    `Latest operator action summary: ${result.latestOperatorActionSummary ?? "none"}`,
    `Review status: ${result.reviewStatus}`,
    `Review pending: ${result.reviewPending}`,
    `Escalation pending: ${result.escalationPending}`,
    `Evidence follow-up pending: ${result.evidenceFollowUpPending}`,
    `Repeated review hotspots: ${result.repeatedReviewHotspots.join(" | ") || "none"}`,
    `Repeated blocked hotspots: ${result.repeatedBlockedHotspots.join(" | ") || "none"}`,
    `Repeated resolved_not_ready hotspots: ${result.repeatedResolvedNotReadyHotspots.join(" | ") || "none"}`,
    `Governance warnings: ${result.governanceWarnings.join(" | ") || "none"}`,
    `Summary line: ${result.reviewSummaryLine}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.recommendedNextReviewAction}`,
  ].join("\n");
}
