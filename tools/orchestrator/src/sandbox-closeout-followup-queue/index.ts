import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutFollowupSummary,
  type SandboxCloseoutFollowupSummary,
} from "../sandbox-closeout-followup-summary";
import {
  buildSandboxCloseoutReviewQueue,
  type SandboxCloseoutReviewQueue,
} from "../sandbox-closeout-review-queue";
import {
  buildSandboxCloseoutReviewResolutionSummary,
  type SandboxCloseoutReviewResolutionSummary,
} from "../sandbox-closeout-review-resolution-summary";
import type { SandboxCloseoutSettlementAudit } from "../sandbox-closeout-settlement-audit";

export type SandboxCloseoutFollowupQueueEntry = {
  settlementAuditId: string | null;
  queuedAt: string | null;
  queueStatus:
    | "followup_open"
    | "settlement_blocked"
    | "review_complete_pending"
    | "closeout_complete";
  followUpRequired: boolean;
  followUpOpen: boolean;
  settlementBlocked: boolean;
  reviewComplete: boolean;
  closeoutComplete: boolean;
  blockedReasonsSummary: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export type SandboxCloseoutFollowupQueue = {
  entries: SandboxCloseoutFollowupQueueEntry[];
  latestQueueEntry: SandboxCloseoutFollowupQueueEntry | null;
  queueStatus:
    | "empty"
    | "followup_open"
    | "settlement_blocked"
    | "review_complete_pending"
    | "closeout_complete";
  followUpRequired: boolean;
  followUpOpen: boolean;
  settlementBlocked: boolean;
  reviewComplete: boolean;
  closeoutComplete: boolean;
  blockedReasonsSummary: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutFollowupQueue(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutFollowupSummary?: SandboxCloseoutFollowupSummary;
  closeoutReviewResolutionSummary?: SandboxCloseoutReviewResolutionSummary;
  closeoutReviewQueue?: SandboxCloseoutReviewQueue;
  latestSettlementAudit?: SandboxCloseoutSettlementAudit | null;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutReviewResolutionSummary =
    params.closeoutReviewResolutionSummary ??
    (await buildSandboxCloseoutReviewResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutFollowupSummary =
    params.closeoutFollowupSummary ??
    (await buildSandboxCloseoutFollowupSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutReviewResolutionSummary,
      latestSettlementAudit: params.latestSettlementAudit,
    }));
  const closeoutReviewQueue =
    params.closeoutReviewQueue ??
    (await buildSandboxCloseoutReviewQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));

  const queueStatus: SandboxCloseoutFollowupQueue["queueStatus"] =
    !closeoutFollowupSummary.followUpRequired && closeoutFollowupSummary.closeoutCanBeTreatedAsComplete
      ? "empty"
      : closeoutFollowupSummary.followUpBlockingSettlement
        ? "settlement_blocked"
        : closeoutFollowupSummary.followUpOpen
          ? "followup_open"
          : closeoutFollowupSummary.reviewCanBeTreatedAsComplete
            ? "review_complete_pending"
            : "followup_open";
  const latestQueueEntry =
    queueStatus === "empty"
      ? null
      : ({
          settlementAuditId: params.latestSettlementAudit?.id ?? null,
          queuedAt: params.latestSettlementAudit?.auditedAt ?? closeoutReviewQueue.latestQueueEntry?.auditedAt ?? null,
          queueStatus,
          followUpRequired: closeoutFollowupSummary.followUpRequired,
          followUpOpen: closeoutFollowupSummary.followUpOpen,
          settlementBlocked: closeoutFollowupSummary.followUpBlockingSettlement,
          reviewComplete: closeoutFollowupSummary.reviewCanBeTreatedAsComplete,
          closeoutComplete: closeoutFollowupSummary.closeoutCanBeTreatedAsComplete,
          blockedReasonsSummary:
            params.latestSettlementAudit?.settlementBlockedReasons ?? closeoutFollowupSummary.followUpReasons,
          missingEvidenceSummary:
            params.latestSettlementAudit?.missingEvidenceSummary ?? closeoutFollowupSummary.followUpEvidenceGaps,
          recommendedNextOperatorStep: closeoutFollowupSummary.recommendedNextOperatorStep,
          summaryLine: closeoutFollowupSummary.summaryLine,
        } satisfies SandboxCloseoutFollowupQueueEntry);
  const entries = latestQueueEntry ? [latestQueueEntry] : [];
  const summaryLine =
    latestQueueEntry === null
      ? "Sandbox closeout follow-up queue is empty."
      : `Sandbox closeout follow-up queue: status=${latestQueueEntry.queueStatus}, next=${latestQueueEntry.recommendedNextOperatorStep}.`;

  return {
    entries,
    latestQueueEntry,
    queueStatus,
    followUpRequired: closeoutFollowupSummary.followUpRequired,
    followUpOpen: closeoutFollowupSummary.followUpOpen,
    settlementBlocked: closeoutFollowupSummary.followUpBlockingSettlement,
    reviewComplete: closeoutFollowupSummary.reviewCanBeTreatedAsComplete,
    closeoutComplete: closeoutFollowupSummary.closeoutCanBeTreatedAsComplete,
    blockedReasonsSummary: latestQueueEntry?.blockedReasonsSummary ?? [],
    missingEvidenceSummary: latestQueueEntry?.missingEvidenceSummary ?? [],
    recommendedNextOperatorStep: closeoutFollowupSummary.recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutFollowupQueue;
}

export function formatSandboxCloseoutFollowupQueue(result: SandboxCloseoutFollowupQueue) {
  return [
    "Sandbox closeout follow-up queue",
    `Queue status: ${result.queueStatus}`,
    `Follow-up required: ${result.followUpRequired}`,
    `Follow-up open: ${result.followUpOpen}`,
    `Settlement blocked: ${result.settlementBlocked}`,
    `Review complete: ${result.reviewComplete}`,
    `Closeout complete: ${result.closeoutComplete}`,
    `Blocked reasons: ${result.blockedReasonsSummary.join(" | ") || "none"}`,
    `Missing evidence: ${result.missingEvidenceSummary.join(" | ") || "none"}`,
    `Latest queue entry: ${result.latestQueueEntry?.queuedAt ?? "none"} ${result.latestQueueEntry?.summaryLine ?? ""}`.trimEnd(),
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
