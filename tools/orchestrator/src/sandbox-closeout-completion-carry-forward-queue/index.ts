import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutCompletionHistory,
  type SandboxCloseoutCompletionHistory,
} from "../sandbox-closeout-completion-history";
import {
  buildSandboxCloseoutCompletionQueue,
  type SandboxCloseoutCompletionQueue,
} from "../sandbox-closeout-completion-queue";
import {
  buildSandboxCloseoutCompletionResolutionSummary,
  type SandboxCloseoutCompletionResolutionSummary,
} from "../sandbox-closeout-completion-resolution-summary";
import {
  buildSandboxCloseoutFollowupQueue,
  type SandboxCloseoutFollowupQueue,
} from "../sandbox-closeout-followup-queue";
import {
  buildSandboxCloseoutFollowupSummary,
  type SandboxCloseoutFollowupSummary,
} from "../sandbox-closeout-followup-summary";

export type SandboxCloseoutCompletionCarryForwardQueueEntry = {
  completionAuditId: string | null;
  queuedAt: string | null;
  queueStatus:
    | "review_complete_required"
    | "closeout_complete_required"
    | "followup_open"
    | "completion_reverted"
    | "queue_retained";
  reviewCompleteRequired: boolean;
  closeoutCompleteRequired: boolean;
  followUpOpen: boolean;
  settlementBlocked: boolean;
  completionReverted: boolean;
  carryForwardReasons: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export type SandboxCloseoutCompletionCarryForwardQueue = {
  entries: SandboxCloseoutCompletionCarryForwardQueueEntry[];
  latestQueueEntry: SandboxCloseoutCompletionCarryForwardQueueEntry | null;
  queueStatus:
    | "empty"
    | "review_complete_required"
    | "closeout_complete_required"
    | "followup_open"
    | "completion_reverted"
    | "queue_retained";
  reviewCompleteRequired: boolean;
  closeoutCompleteRequired: boolean;
  followUpOpen: boolean;
  settlementBlocked: boolean;
  completionReverted: boolean;
  carryForwardReasons: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutCompletionCarryForwardQueue(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutCompletionHistory?: SandboxCloseoutCompletionHistory;
  closeoutCompletionResolutionSummary?: SandboxCloseoutCompletionResolutionSummary;
  closeoutCompletionQueue?: SandboxCloseoutCompletionQueue;
  closeoutFollowupSummary?: SandboxCloseoutFollowupSummary;
  closeoutFollowupQueue?: SandboxCloseoutFollowupQueue;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutCompletionHistory =
    params.closeoutCompletionHistory ??
    (await buildSandboxCloseoutCompletionHistory({
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
    }));
  const closeoutFollowupQueue =
    params.closeoutFollowupQueue ??
    (await buildSandboxCloseoutFollowupQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFollowupSummary,
    }));
  const closeoutCompletionQueue =
    params.closeoutCompletionQueue ??
    (await buildSandboxCloseoutCompletionQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFollowupSummary,
      closeoutFollowupQueue,
    }));
  const closeoutCompletionResolutionSummary =
    params.closeoutCompletionResolutionSummary ??
    (await buildSandboxCloseoutCompletionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionHistory,
      closeoutCompletionQueue,
      closeoutFollowupSummary,
      closeoutFollowupQueue,
    }));

  const queueStatus: SandboxCloseoutCompletionCarryForwardQueue["queueStatus"] =
    closeoutCompletionResolutionSummary.caseCanBeTreatedAsFullyCompleted
      ? "empty"
      : closeoutCompletionResolutionSummary.completionThreadReverted
        ? "completion_reverted"
        : closeoutCompletionResolutionSummary.followUpRemainsOpen
          ? "followup_open"
          : !closeoutCompletionResolutionSummary.latestReviewCompleteStatus
            ? "review_complete_required"
            : !closeoutCompletionResolutionSummary.latestCloseoutCompleteStatus
              ? "closeout_complete_required"
              : "queue_retained";
  const latestEntry = closeoutCompletionHistory.latestEntry;
  const carryForwardReasons = Array.from(
    new Set(
      [
        ...closeoutCompletionResolutionSummary.unresolvedCompletionReasons,
        ...closeoutCompletionQueue.blockedReasonsSummary,
        ...closeoutFollowupSummary.followUpReasons,
        ...closeoutFollowupQueue.blockedReasonsSummary,
        ...(closeoutCompletionResolutionSummary.completionThreadReverted
          ? closeoutCompletionHistory.repeatedRevertFromCompletePatterns.length > 0
            ? closeoutCompletionHistory.repeatedRevertFromCompletePatterns
            : [`reverted_from_complete:${closeoutCompletionResolutionSummary.latestCompletionStatus}`]
          : []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const missingEvidenceSummary = Array.from(
    new Set(
      [
        ...closeoutCompletionQueue.missingEvidenceSummary,
        ...closeoutFollowupQueue.missingEvidenceSummary,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const latestQueueEntry =
    queueStatus === "empty"
      ? null
      : ({
          completionAuditId: latestEntry?.id ?? null,
          queuedAt: latestEntry?.auditedAt ?? null,
          queueStatus,
          reviewCompleteRequired: !closeoutCompletionResolutionSummary.latestReviewCompleteStatus,
          closeoutCompleteRequired: !closeoutCompletionResolutionSummary.latestCloseoutCompleteStatus,
          followUpOpen: closeoutCompletionResolutionSummary.followUpRemainsOpen,
          settlementBlocked: closeoutFollowupSummary.followUpBlockingSettlement,
          completionReverted: closeoutCompletionResolutionSummary.completionThreadReverted,
          carryForwardReasons,
          missingEvidenceSummary,
          recommendedNextOperatorStep:
            closeoutCompletionResolutionSummary.recommendedNextOperatorStep,
          summaryLine: closeoutCompletionResolutionSummary.summaryLine,
        } satisfies SandboxCloseoutCompletionCarryForwardQueueEntry);
  const entries = latestQueueEntry ? [latestQueueEntry] : [];
  const summaryLine =
    latestQueueEntry === null
      ? "Sandbox closeout completion carry-forward queue is empty."
      : `Sandbox closeout completion carry-forward queue: status=${latestQueueEntry.queueStatus}, next=${latestQueueEntry.recommendedNextOperatorStep}.`;

  return {
    entries,
    latestQueueEntry,
    queueStatus,
    reviewCompleteRequired: latestQueueEntry?.reviewCompleteRequired ?? false,
    closeoutCompleteRequired: latestQueueEntry?.closeoutCompleteRequired ?? false,
    followUpOpen: latestQueueEntry?.followUpOpen ?? false,
    settlementBlocked: latestQueueEntry?.settlementBlocked ?? false,
    completionReverted: latestQueueEntry?.completionReverted ?? false,
    carryForwardReasons,
    missingEvidenceSummary,
    recommendedNextOperatorStep:
      closeoutCompletionResolutionSummary.recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutCompletionCarryForwardQueue;
}

export function formatSandboxCloseoutCompletionCarryForwardQueue(
  result: SandboxCloseoutCompletionCarryForwardQueue,
) {
  return [
    "Sandbox closeout completion carry-forward queue",
    `Queue status: ${result.queueStatus}`,
    `Review-complete required: ${result.reviewCompleteRequired}`,
    `Closeout-complete required: ${result.closeoutCompleteRequired}`,
    `Follow-up open: ${result.followUpOpen}`,
    `Settlement blocked: ${result.settlementBlocked}`,
    `Completion reverted: ${result.completionReverted}`,
    `Carry-forward reasons: ${result.carryForwardReasons.join(" | ") || "none"}`,
    `Missing evidence: ${result.missingEvidenceSummary.join(" | ") || "none"}`,
    `Latest queue entry: ${result.latestQueueEntry?.queuedAt ?? "none"} ${result.latestQueueEntry?.summaryLine ?? ""}`.trimEnd(),
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
