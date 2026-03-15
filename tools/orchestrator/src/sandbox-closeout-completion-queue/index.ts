import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import type { SandboxCloseoutCompletionAudit } from "../sandbox-closeout-completion-audit";
import {
  buildSandboxCloseoutCompletionSummary,
  type SandboxCloseoutCompletionSummary,
} from "../sandbox-closeout-completion-summary";
import {
  buildSandboxCloseoutFollowupQueue,
  type SandboxCloseoutFollowupQueue,
} from "../sandbox-closeout-followup-queue";
import {
  buildSandboxCloseoutFollowupSummary,
  type SandboxCloseoutFollowupSummary,
} from "../sandbox-closeout-followup-summary";
import type { SandboxCloseoutSettlementAudit } from "../sandbox-closeout-settlement-audit";

export type SandboxCloseoutCompletionQueueEntry = {
  completionAuditId: string | null;
  queuedAt: string | null;
  queueStatus:
    | "review_complete_required"
    | "closeout_complete_required"
    | "followup_open"
    | "completion_blocked"
    | "queue_retained";
  reviewCompleteRequired: boolean;
  closeoutCompleteRequired: boolean;
  followUpOpen: boolean;
  settlementBlocked: boolean;
  completionBlocked: boolean;
  blockedReasonsSummary: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export type SandboxCloseoutCompletionQueue = {
  entries: SandboxCloseoutCompletionQueueEntry[];
  latestQueueEntry: SandboxCloseoutCompletionQueueEntry | null;
  queueStatus:
    | "empty"
    | "review_complete_required"
    | "closeout_complete_required"
    | "followup_open"
    | "completion_blocked"
    | "queue_retained";
  reviewCompleteRequired: boolean;
  closeoutCompleteRequired: boolean;
  followUpOpen: boolean;
  settlementBlocked: boolean;
  completionBlocked: boolean;
  blockedReasonsSummary: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutCompletionQueue(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutCompletionSummary?: SandboxCloseoutCompletionSummary;
  closeoutFollowupSummary?: SandboxCloseoutFollowupSummary;
  closeoutFollowupQueue?: SandboxCloseoutFollowupQueue;
  latestSettlementAudit?: SandboxCloseoutSettlementAudit | null;
  latestCompletionAudit?: SandboxCloseoutCompletionAudit | null;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutFollowupSummary =
    params.closeoutFollowupSummary ??
    (await buildSandboxCloseoutFollowupSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      latestSettlementAudit: params.latestSettlementAudit,
    }));
  const closeoutFollowupQueue =
    params.closeoutFollowupQueue ??
    (await buildSandboxCloseoutFollowupQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFollowupSummary,
      latestSettlementAudit: params.latestSettlementAudit,
    }));
  const closeoutCompletionSummary =
    params.closeoutCompletionSummary ??
    (await buildSandboxCloseoutCompletionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFollowupSummary,
      closeoutFollowupQueue,
      latestSettlementAudit: params.latestSettlementAudit,
      latestCompletionAudit: params.latestCompletionAudit,
    }));

  const queueStatus: SandboxCloseoutCompletionQueue["queueStatus"] =
    closeoutCompletionSummary.closeoutCompleteReached
      ? "empty"
      : closeoutCompletionSummary.latestFollowupStatus === "followup_blocking_settlement" ||
          closeoutCompletionSummary.latestFollowupStatus === "followup_open"
        ? "followup_open"
        : closeoutCompletionSummary.completionStatus === "queue_still_retained"
          ? "queue_retained"
          : closeoutCompletionSummary.completionStatus === "completion_blocked"
            ? "completion_blocked"
            : closeoutCompletionSummary.reviewCompleteReached
              ? "closeout_complete_required"
              : "review_complete_required";
  const latestQueueEntry =
    queueStatus === "empty"
      ? null
      : ({
          completionAuditId: params.latestCompletionAudit?.id ?? null,
          queuedAt: params.latestCompletionAudit?.auditedAt ?? params.latestSettlementAudit?.auditedAt ?? null,
          queueStatus,
          reviewCompleteRequired: !closeoutCompletionSummary.reviewCompleteReached,
          closeoutCompleteRequired: !closeoutCompletionSummary.closeoutCompleteReached,
          followUpOpen: closeoutFollowupSummary.followUpOpen,
          settlementBlocked: closeoutFollowupSummary.followUpBlockingSettlement,
          completionBlocked: closeoutCompletionSummary.completionBlocked,
          blockedReasonsSummary: closeoutCompletionSummary.completionReasons,
          missingEvidenceSummary: closeoutCompletionSummary.completionEvidenceGaps,
          recommendedNextOperatorStep: closeoutCompletionSummary.recommendedNextOperatorStep,
          summaryLine: closeoutCompletionSummary.summaryLine,
        } satisfies SandboxCloseoutCompletionQueueEntry);
  const entries = latestQueueEntry ? [latestQueueEntry] : [];
  const summaryLine =
    latestQueueEntry === null
      ? "Sandbox closeout completion queue is empty."
      : `Sandbox closeout completion queue: status=${latestQueueEntry.queueStatus}, next=${latestQueueEntry.recommendedNextOperatorStep}.`;

  return {
    entries,
    latestQueueEntry,
    queueStatus,
    reviewCompleteRequired: latestQueueEntry?.reviewCompleteRequired ?? false,
    closeoutCompleteRequired: latestQueueEntry?.closeoutCompleteRequired ?? false,
    followUpOpen: latestQueueEntry?.followUpOpen ?? false,
    settlementBlocked: latestQueueEntry?.settlementBlocked ?? false,
    completionBlocked: latestQueueEntry?.completionBlocked ?? false,
    blockedReasonsSummary: latestQueueEntry?.blockedReasonsSummary ?? [],
    missingEvidenceSummary: latestQueueEntry?.missingEvidenceSummary ?? [],
    recommendedNextOperatorStep: closeoutCompletionSummary.recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutCompletionQueue;
}

export function formatSandboxCloseoutCompletionQueue(result: SandboxCloseoutCompletionQueue) {
  return [
    "Sandbox closeout completion queue",
    `Queue status: ${result.queueStatus}`,
    `Review-complete required: ${result.reviewCompleteRequired}`,
    `Closeout-complete required: ${result.closeoutCompleteRequired}`,
    `Follow-up open: ${result.followUpOpen}`,
    `Settlement blocked: ${result.settlementBlocked}`,
    `Completion blocked: ${result.completionBlocked}`,
    `Blocked reasons: ${result.blockedReasonsSummary.join(" | ") || "none"}`,
    `Missing evidence: ${result.missingEvidenceSummary.join(" | ") || "none"}`,
    `Latest queue entry: ${result.latestQueueEntry?.queuedAt ?? "none"} ${result.latestQueueEntry?.summaryLine ?? ""}`.trimEnd(),
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
