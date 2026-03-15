import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  listSandboxCloseoutReviewActions,
  type SandboxCloseoutReviewActionRecord,
} from "../sandbox-closeout-review-actions";
import { buildSandboxCloseoutOperatorChecklist, type SandboxCloseoutOperatorChecklist } from "../sandbox-closeout-checklist";
import {
  buildSandboxCloseoutReviewQueue,
  type SandboxCloseoutReviewQueue,
} from "../sandbox-closeout-review-queue";
import {
  buildSandboxCloseoutReviewSummary,
  type SandboxCloseoutReviewSummary,
} from "../sandbox-closeout-review-summary";
import { buildSandboxCloseoutSummary, type SandboxCloseoutSummary } from "../sandbox-closeout-summary";
import {
  buildSandboxClosureGatingDecision,
  type SandboxClosureGatingDecision,
} from "../sandbox-closure-gating";
import {
  buildSandboxResolutionEvidenceSummary,
  type SandboxResolutionEvidenceSummary,
} from "../sandbox-resolution-evidence";
import {
  buildSandboxResolutionReadiness,
  type SandboxResolutionReadinessSummary,
} from "../sandbox-resolution-readiness";
import {
  buildSandboxResolutionAuditHistory,
  type SandboxResolutionAuditHistory,
} from "../sandbox-resolution-audit-history";

export type SandboxCloseoutDispositionSummary = {
  latestCloseoutDecision: SandboxCloseoutSummary["latestCloseoutDecision"] | "none";
  latestReviewAction: SandboxCloseoutReviewActionRecord["latestReviewAction"] | "none";
  latestReviewActionStatus: SandboxCloseoutReviewActionRecord["latestReviewActionStatus"] | "not_run";
  latestReviewActionReason: string | null;
  latestIncidentType: OrchestratorState["lastIncidentType"];
  latestIncidentSeverity: OrchestratorState["lastIncidentSeverity"];
  latestIncidentSummary: string | null;
  latestEvidenceSufficiencySummary: string;
  latestReadinessSummary: string;
  latestClosureGatingSummary: string;
  dispositionResult:
    | "closeout_approved"
    | "closeout_rejected"
    | "followup_required"
    | "review_deferred"
    | "reopened_for_review";
  dispositionReasons: string[];
  dispositionWarnings: string[];
  followUpRemainsOpen: boolean;
  reviewRemainsOpen: boolean;
  queueExitAllowed: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
  summary: string;
};

export async function buildSandboxCloseoutDispositionSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutSummary?: SandboxCloseoutSummary;
  closeoutChecklist?: SandboxCloseoutOperatorChecklist;
  closeoutReviewSummary?: SandboxCloseoutReviewSummary;
  closeoutReviewQueue?: SandboxCloseoutReviewQueue;
  resolutionAuditHistory?: SandboxResolutionAuditHistory;
  resolutionEvidenceSummary?: SandboxResolutionEvidenceSummary;
  resolutionReadiness?: SandboxResolutionReadinessSummary;
  closureGatingDecision?: SandboxClosureGatingDecision;
  latestReviewAction?: SandboxCloseoutReviewActionRecord | null;
}) {
  const limit = Math.max(5, params.limit ?? 10);
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
  const resolutionAuditHistory =
    params.resolutionAuditHistory ??
    (await buildSandboxResolutionAuditHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutReviewSummary =
    params.closeoutReviewSummary ??
    (await buildSandboxCloseoutReviewSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutSummary,
      closeoutChecklist,
      resolutionAuditHistory,
    }));
  const latestReviewAction =
    params.latestReviewAction ??
    (await listSandboxCloseoutReviewActions({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;
  const closeoutReviewQueue =
    params.closeoutReviewQueue ??
    (await buildSandboxCloseoutReviewQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutSummary,
      closeoutChecklist,
      resolutionAuditHistory,
      latestReviewAction,
    }));
  const resolutionEvidenceSummary =
    params.resolutionEvidenceSummary ??
    (await buildSandboxResolutionEvidenceSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const resolutionReadiness =
    params.resolutionReadiness ??
    (await buildSandboxResolutionReadiness({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closureGatingDecision =
    params.closureGatingDecision ??
    (await buildSandboxClosureGatingDecision({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));

  let dispositionResult: SandboxCloseoutDispositionSummary["dispositionResult"] = "review_deferred";
  if (
    latestReviewAction?.latestReviewAction === "approve_closeout" &&
    latestReviewAction.latestReviewActionStatus === "accepted" &&
    closeoutChecklist.safeToCloseout &&
    closeoutSummary.latestCloseoutDecision === "closure_ready"
  ) {
    dispositionResult = "closeout_approved";
  } else if (
    latestReviewAction?.latestReviewAction === "reject_closeout" &&
    latestReviewAction.latestReviewActionStatus === "accepted"
  ) {
    dispositionResult = "closeout_rejected";
  } else if (
    latestReviewAction?.latestReviewAction === "request_followup" &&
    latestReviewAction.latestReviewActionStatus === "accepted"
  ) {
    dispositionResult = "followup_required";
  } else if (
    latestReviewAction?.latestReviewAction === "reopen_review" &&
    latestReviewAction.latestReviewActionStatus === "accepted"
  ) {
    dispositionResult = "reopened_for_review";
  }

  const followUpRemainsOpen =
    dispositionResult === "closeout_rejected" ||
    dispositionResult === "followup_required" ||
    closeoutReviewSummary.evidenceFollowUpPending;
  const reviewRemainsOpen =
    dispositionResult !== "closeout_approved" ||
    closeoutReviewSummary.reviewPending ||
    closeoutReviewSummary.escalationPending;
  const queueExitAllowed =
    dispositionResult === "closeout_approved" &&
    closeoutReviewQueue.queueStatus === "empty" &&
    closeoutChecklist.safeToCloseout;
  const dispositionReasons = Array.from(
    new Set(
      [
        latestReviewAction?.summaryLine ?? null,
        latestReviewAction?.latestReviewActionReason ?? null,
        closeoutSummary.summary,
        closeoutReviewSummary.summary,
        closeoutReviewQueue.summaryLine,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const dispositionWarnings = Array.from(
    new Set(
      [
        ...closeoutChecklist.governanceWarnings,
        ...closureGatingDecision.blockedReasons,
        ...resolutionEvidenceSummary.evidenceGaps,
        ...(latestReviewAction === null
          ? ["No formal closeout review action has been recorded yet."]
          : latestReviewAction.latestReviewActionStatus === "accepted"
            ? []
            : [`Latest closeout review action remained ${latestReviewAction.latestReviewActionStatus}.`]),
      ],
    ),
  );
  const recommendedNextOperatorStep =
    dispositionResult === "closeout_approved"
      ? "closeout_complete"
      : closeoutReviewQueue.recommendedNextOperatorStep;
  const summaryLine =
    dispositionResult === "closeout_approved"
      ? "Sandbox closeout disposition: approved and queue-exitable."
      : `Sandbox closeout disposition: ${dispositionResult}; next=${recommendedNextOperatorStep}.`;
  const summary =
    dispositionResult === "closeout_approved"
      ? "Sandbox closeout disposition confirms that a formal review decision approved closure."
      : `Sandbox closeout disposition keeps governance open because result=${dispositionResult}.`;

  return {
    latestCloseoutDecision: closeoutSummary.latestCloseoutDecision,
    latestReviewAction: latestReviewAction?.latestReviewAction ?? "none",
    latestReviewActionStatus: latestReviewAction?.latestReviewActionStatus ?? "not_run",
    latestReviewActionReason: latestReviewAction?.latestReviewActionReason ?? null,
    latestIncidentType: closeoutSummary.latestIncidentType,
    latestIncidentSeverity: closeoutSummary.latestIncidentSeverity,
    latestIncidentSummary: closeoutSummary.latestIncidentSummary,
    latestEvidenceSufficiencySummary: closeoutSummary.evidenceSufficiencySummary,
    latestReadinessSummary: resolutionReadiness.summary,
    latestClosureGatingSummary: closureGatingDecision.summary,
    dispositionResult,
    dispositionReasons,
    dispositionWarnings,
    followUpRemainsOpen,
    reviewRemainsOpen,
    queueExitAllowed,
    recommendedNextOperatorStep,
    summaryLine,
    summary,
  } satisfies SandboxCloseoutDispositionSummary;
}

export function formatSandboxCloseoutDispositionSummary(result: SandboxCloseoutDispositionSummary) {
  return [
    "Sandbox closeout disposition summary",
    `Latest closeout decision: ${result.latestCloseoutDecision}`,
    `Latest review action: ${result.latestReviewAction}/${result.latestReviewActionStatus}`,
    `Latest review reason: ${result.latestReviewActionReason ?? "none"}`,
    `Latest incident: ${result.latestIncidentType}/${result.latestIncidentSeverity ?? "none"}`,
    `Latest incident summary: ${result.latestIncidentSummary ?? "none"}`,
    `Evidence sufficiency: ${result.latestEvidenceSufficiencySummary}`,
    `Readiness: ${result.latestReadinessSummary}`,
    `Closure gating: ${result.latestClosureGatingSummary}`,
    `Disposition result: ${result.dispositionResult}`,
    `Disposition reasons: ${result.dispositionReasons.join(" | ") || "none"}`,
    `Disposition warnings: ${result.dispositionWarnings.join(" | ") || "none"}`,
    `Follow-up remains open: ${result.followUpRemainsOpen}`,
    `Review remains open: ${result.reviewRemainsOpen}`,
    `Queue exit allowed: ${result.queueExitAllowed}`,
    `Summary line: ${result.summaryLine}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
