import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import type { SandboxCloseoutReviewActionRecord } from "../sandbox-closeout-review-actions";
import { listSandboxCloseoutReviewActions } from "../sandbox-closeout-review-actions";
import {
  buildSandboxResolutionAuditHistory,
  type SandboxResolutionAuditHistory,
} from "../sandbox-resolution-audit-history";
import { buildSandboxCloseoutOperatorChecklist, type SandboxCloseoutOperatorChecklist } from "../sandbox-closeout-checklist";
import { buildSandboxCloseoutSummary, type SandboxCloseoutSummary } from "../sandbox-closeout-summary";

export type SandboxCloseoutReviewQueueEntry = {
  auditId: string;
  auditedAt: string;
  queueStatus: "review_pending" | "escalation_pending" | "evidence_follow_up" | "blocked";
  closeoutDecisionStatus: string;
  reviewRequired: boolean;
  escalationRequired: boolean;
  evidenceFollowUpRequired: boolean;
  blockedReasonsSummary: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export type SandboxCloseoutReviewQueue = {
  entries: SandboxCloseoutReviewQueueEntry[];
  latestQueueEntry: SandboxCloseoutReviewQueueEntry | null;
  queueStatus: "empty" | "review_pending" | "escalation_pending" | "evidence_follow_up" | "blocked";
  closeoutDecisionStatus: SandboxCloseoutSummary["latestCloseoutDecision"] | "none";
  reviewRequired: boolean;
  escalationRequired: boolean;
  evidenceFollowUpRequired: boolean;
  blockedReasonsSummary: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

function buildQueueStatus(params: {
  reviewRequired: boolean;
  escalationRequired: boolean;
  evidenceFollowUpRequired: boolean;
  closeoutDecisionStatus: string;
}) {
  if (params.closeoutDecisionStatus === "blocked") {
    return "blocked";
  }
  if (params.escalationRequired) {
    return "escalation_pending";
  }
  if (params.reviewRequired) {
    return "review_pending";
  }
  if (params.evidenceFollowUpRequired) {
    return "evidence_follow_up";
  }
  return "review_pending";
}

export async function buildSandboxCloseoutReviewQueue(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  resolutionAuditHistory?: SandboxResolutionAuditHistory;
  closeoutSummary?: SandboxCloseoutSummary;
  closeoutChecklist?: SandboxCloseoutOperatorChecklist;
  latestReviewAction?: SandboxCloseoutReviewActionRecord | null;
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
  const latestReviewAction =
    params.latestReviewAction ??
    (await listSandboxCloseoutReviewActions({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;

  let entries = resolutionAuditHistory.entries
    .filter(
      (record) =>
        record.closeoutDecision !== "closure_ready" ||
        record.reviewRequired ||
        record.escalationRequired ||
        record.validationEvidenceRequired,
    )
    .map((record) => {
      const evidenceFollowUpRequired =
        record.validationEvidenceRequired ||
        record.resolutionEvidenceSnapshot.evidenceGapCodes.length > 0;
      const queueStatus = buildQueueStatus({
        reviewRequired: record.reviewRequired,
        escalationRequired: record.escalationRequired,
        evidenceFollowUpRequired,
        closeoutDecisionStatus: record.closeoutDecision,
      });
      return {
        auditId: record.id,
        auditedAt: record.auditedAt,
        queueStatus,
        closeoutDecisionStatus: record.closeoutDecision,
        reviewRequired: record.reviewRequired,
        escalationRequired: record.escalationRequired,
        evidenceFollowUpRequired,
        blockedReasonsSummary: record.closeoutBlockedReasons,
        missingEvidenceSummary: record.resolutionEvidenceSnapshot.evidenceGaps,
        recommendedNextOperatorStep:
          record.resolutionReadinessSnapshot.recommendedNextStepBeforeClosure,
        summaryLine: record.summaryLine,
      } satisfies SandboxCloseoutReviewQueueEntry;
    });
  const latestAuditId = resolutionAuditHistory.latestEntry?.id ?? null;
  if (
    latestReviewAction &&
    latestReviewAction.auditId === latestAuditId &&
    entries.length === 0 &&
    resolutionAuditHistory.latestEntry
  ) {
    const record = resolutionAuditHistory.latestEntry;
    const evidenceFollowUpRequired =
      latestReviewAction.latestReviewAction === "reject_closeout" ||
      latestReviewAction.latestReviewAction === "request_followup" ||
      record.validationEvidenceRequired ||
      record.resolutionEvidenceSnapshot.evidenceGapCodes.length > 0;
    const reviewRequired =
      latestReviewAction.latestReviewAction === "defer_review" ||
      latestReviewAction.latestReviewAction === "reopen_review" ||
      record.reviewRequired;
    const escalationRequired = record.escalationRequired;
    const queueStatus =
      latestReviewAction.latestReviewAction === "reject_closeout" ||
      latestReviewAction.latestReviewAction === "request_followup"
        ? "evidence_follow_up"
        : latestReviewAction.latestReviewAction === "defer_review" ||
            latestReviewAction.latestReviewAction === "reopen_review"
          ? "review_pending"
          : buildQueueStatus({
              reviewRequired,
              escalationRequired,
              evidenceFollowUpRequired,
              closeoutDecisionStatus: record.closeoutDecision,
            });
    entries = [
      {
        auditId: record.id,
        auditedAt: record.auditedAt,
        queueStatus,
        closeoutDecisionStatus: record.closeoutDecision,
        reviewRequired,
        escalationRequired,
        evidenceFollowUpRequired,
        blockedReasonsSummary: record.closeoutBlockedReasons,
        missingEvidenceSummary: record.resolutionEvidenceSnapshot.evidenceGaps,
        recommendedNextOperatorStep: latestReviewAction.suggestedNextAction,
        summaryLine: `${record.summaryLine} ReviewAction=${latestReviewAction.latestReviewAction}/${latestReviewAction.latestReviewActionStatus}.`,
      },
    ];
  }
  if (
    latestReviewAction?.latestReviewAction === "approve_closeout" &&
    latestReviewAction.latestReviewActionStatus === "accepted" &&
    latestReviewAction.auditId === latestAuditId
  ) {
    entries = [];
  } else if (
    latestReviewAction &&
    latestReviewAction.auditId === latestAuditId &&
    entries[0]
  ) {
    const firstEntry = entries[0];
    const actionAdjustedStatus =
      latestReviewAction.latestReviewAction === "reject_closeout" ||
      latestReviewAction.latestReviewAction === "request_followup"
        ? "evidence_follow_up"
        : latestReviewAction.latestReviewAction === "defer_review" ||
            latestReviewAction.latestReviewAction === "reopen_review"
          ? "review_pending"
          : firstEntry.queueStatus;
    entries = [
      {
        ...firstEntry,
        queueStatus: actionAdjustedStatus,
        reviewRequired:
          latestReviewAction.latestReviewAction === "defer_review" ||
          latestReviewAction.latestReviewAction === "reopen_review"
            ? true
            : firstEntry.reviewRequired,
        evidenceFollowUpRequired:
          latestReviewAction.latestReviewAction === "reject_closeout" ||
          latestReviewAction.latestReviewAction === "request_followup"
            ? true
            : firstEntry.evidenceFollowUpRequired,
        recommendedNextOperatorStep: latestReviewAction.suggestedNextAction,
        summaryLine: `${firstEntry.summaryLine} ReviewAction=${latestReviewAction.latestReviewAction}/${latestReviewAction.latestReviewActionStatus}.`,
      },
      ...entries.slice(1),
    ];
  }
  const latestQueueEntry = entries[0] ?? null;
  const queueStatus = latestQueueEntry?.queueStatus ?? "empty";
  const reviewRequired =
    latestQueueEntry?.reviewRequired ?? !closeoutChecklist.requestReviewSatisfied;
  const escalationRequired =
    latestQueueEntry?.escalationRequired ?? !closeoutChecklist.escalationSatisfied;
  const evidenceFollowUpRequired =
    latestQueueEntry?.evidenceFollowUpRequired ?? !closeoutChecklist.noEvidenceGaps;
  const blockedReasonsSummary =
    latestQueueEntry?.blockedReasonsSummary ?? closeoutChecklist.blockedReasonCodes;
  const missingEvidenceSummary =
    latestQueueEntry?.missingEvidenceSummary ?? closeoutChecklist.evidenceGapCodes;
  const recommendedNextOperatorStep =
    latestQueueEntry?.recommendedNextOperatorStep ?? closeoutChecklist.recommendedNextStep;
  const summaryLine =
    latestQueueEntry === null
      ? "Sandbox closeout review queue is empty."
      : `Sandbox closeout review queue: status=${latestQueueEntry.queueStatus}, decision=${latestQueueEntry.closeoutDecisionStatus}, next=${latestQueueEntry.recommendedNextOperatorStep}.`;

  return {
    entries,
    latestQueueEntry,
    queueStatus,
    closeoutDecisionStatus: closeoutSummary.latestCloseoutDecision,
    reviewRequired,
    escalationRequired,
    evidenceFollowUpRequired,
    blockedReasonsSummary,
    missingEvidenceSummary,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutReviewQueue;
}

export function formatSandboxCloseoutReviewQueue(result: SandboxCloseoutReviewQueue) {
  return [
    "Sandbox closeout review queue",
    `Queue status: ${result.queueStatus}`,
    `Closeout decision status: ${result.closeoutDecisionStatus}`,
    `Review required: ${result.reviewRequired}`,
    `Escalation required: ${result.escalationRequired}`,
    `Evidence follow-up required: ${result.evidenceFollowUpRequired}`,
    `Blocked reasons: ${result.blockedReasonsSummary.join(" | ") || "none"}`,
    `Missing evidence: ${result.missingEvidenceSummary.join(" | ") || "none"}`,
    `Latest queue entry: ${result.latestQueueEntry?.auditedAt ?? "none"} ${result.latestQueueEntry?.summaryLine ?? ""}`.trimEnd(),
    ...result.entries.map(
      (entry) =>
        `- ${entry.auditedAt} ${entry.queueStatus} ${entry.closeoutDecisionStatus} review=${entry.reviewRequired} escalate=${entry.escalationRequired} evidence=${entry.evidenceFollowUpRequired} :: ${entry.summaryLine}`,
    ),
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
