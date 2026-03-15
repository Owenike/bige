import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutCompletionCarryForwardQueue,
  type SandboxCloseoutCompletionCarryForwardQueue,
} from "../sandbox-closeout-completion-carry-forward-queue";
import {
  buildSandboxCloseoutCompletionFinalizationSummary,
  type SandboxCloseoutCompletionFinalizationSummary,
} from "../sandbox-closeout-completion-finalization-summary";
import {
  buildSandboxCloseoutFinalizationAuditHistory,
  type SandboxCloseoutFinalizationAuditHistory,
} from "../sandbox-closeout-finalization-audit-history";
import {
  buildSandboxCloseoutFinalizationStabilitySummary,
  type SandboxCloseoutFinalizationStabilitySummary,
} from "../sandbox-closeout-finalization-stability-summary";
import {
  buildSandboxCloseoutFollowupSummary,
  type SandboxCloseoutFollowupSummary,
} from "../sandbox-closeout-followup-summary";

export type SandboxCloseoutPostFinalizationFollowupQueueEntry = {
  queuedAt: string | null;
  queueStatus:
    | "finalized_but_reopenable"
    | "reopened_after_finalization"
    | "post_finalization_followup_open"
    | "carry_forward_retained";
  finalCompleteReached: boolean;
  stableFinalComplete: boolean;
  reopenedAfterFinalization: boolean;
  postFinalizationFollowUpOpen: boolean;
  carryForwardRetained: boolean;
  blockedReasonsSummary: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export type SandboxCloseoutPostFinalizationFollowupQueue = {
  entries: SandboxCloseoutPostFinalizationFollowupQueueEntry[];
  latestQueueEntry: SandboxCloseoutPostFinalizationFollowupQueueEntry | null;
  queueStatus:
    | "empty"
    | SandboxCloseoutPostFinalizationFollowupQueueEntry["queueStatus"];
  finalCompleteReached: boolean;
  stableFinalComplete: boolean;
  reopenedAfterFinalization: boolean;
  postFinalizationFollowUpOpen: boolean;
  carryForwardRetained: boolean;
  blockedReasonsSummary: string[];
  missingEvidenceSummary: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutPostFinalizationFollowupQueue(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutFinalizationAuditHistory?: SandboxCloseoutFinalizationAuditHistory;
  closeoutFinalizationStabilitySummary?: SandboxCloseoutFinalizationStabilitySummary;
  closeoutCompletionFinalizationSummary?: SandboxCloseoutCompletionFinalizationSummary;
  closeoutCompletionCarryForwardQueue?: SandboxCloseoutCompletionCarryForwardQueue;
  closeoutFollowupSummary?: SandboxCloseoutFollowupSummary;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutFinalizationAuditHistory =
    params.closeoutFinalizationAuditHistory ??
    (await buildSandboxCloseoutFinalizationAuditHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutCompletionCarryForwardQueue =
    params.closeoutCompletionCarryForwardQueue ??
    (await buildSandboxCloseoutCompletionCarryForwardQueue({
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
  const closeoutCompletionFinalizationSummary =
    params.closeoutCompletionFinalizationSummary ??
    (await buildSandboxCloseoutCompletionFinalizationSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutFinalizationStabilitySummary =
    params.closeoutFinalizationStabilitySummary ??
    (await buildSandboxCloseoutFinalizationStabilitySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationAuditHistory,
      closeoutCompletionFinalizationSummary,
      closeoutCompletionCarryForwardQueue,
      closeoutFollowupSummary,
    }));

  const finalCompleteReached =
    closeoutCompletionFinalizationSummary.completionThreadFinalComplete ||
    closeoutFinalizationAuditHistory.entries.some(
      (entry) =>
        entry.finalizationStatus === "final_complete" ||
        entry.finalizationStatus === "finalized_but_reopenable",
    );
  let queueStatus: SandboxCloseoutPostFinalizationFollowupQueue["queueStatus"] = "empty";
  if (!closeoutFinalizationStabilitySummary.completionThreadStableFinalComplete && finalCompleteReached) {
    if (closeoutFinalizationStabilitySummary.completionThreadReopenedAfterFinalization) {
      queueStatus = "reopened_after_finalization";
    } else if (closeoutFinalizationStabilitySummary.postFinalizationFollowUpRemainsOpen) {
      queueStatus = "post_finalization_followup_open";
    } else if (closeoutFinalizationStabilitySummary.queueRemainsRetained) {
      queueStatus = "carry_forward_retained";
    } else {
      queueStatus = "finalized_but_reopenable";
    }
  }

  const blockedReasonsSummary = Array.from(
    new Set(
      [
        ...closeoutFinalizationStabilitySummary.unresolvedStabilityReasons,
        ...closeoutCompletionCarryForwardQueue.carryForwardReasons,
        ...(closeoutFollowupSummary.followUpOpen ? closeoutFollowupSummary.followUpReasons : []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const missingEvidenceSummary = Array.from(
    new Set(
      [
        ...closeoutCompletionCarryForwardQueue.missingEvidenceSummary,
        ...closeoutFollowupSummary.followUpEvidenceGaps,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const latestQueueEntry =
    queueStatus === "empty"
      ? null
      : ({
          queuedAt: closeoutFinalizationAuditHistory.latestEntry?.auditedAt ?? null,
          queueStatus,
          finalCompleteReached,
          stableFinalComplete:
            closeoutFinalizationStabilitySummary.completionThreadStableFinalComplete,
          reopenedAfterFinalization:
            closeoutFinalizationStabilitySummary.completionThreadReopenedAfterFinalization,
          postFinalizationFollowUpOpen:
            closeoutFinalizationStabilitySummary.postFinalizationFollowUpRemainsOpen,
          carryForwardRetained: closeoutFinalizationStabilitySummary.queueRemainsRetained,
          blockedReasonsSummary,
          missingEvidenceSummary,
          recommendedNextOperatorStep:
            closeoutFinalizationStabilitySummary.recommendedNextOperatorStep,
          summaryLine: closeoutFinalizationStabilitySummary.summaryLine,
        } satisfies SandboxCloseoutPostFinalizationFollowupQueueEntry);
  const entries = latestQueueEntry ? [latestQueueEntry] : [];
  const summaryLine =
    latestQueueEntry === null
      ? "Sandbox closeout post-finalization follow-up queue is empty."
      : `Sandbox closeout post-finalization follow-up queue: status=${latestQueueEntry.queueStatus}, next=${latestQueueEntry.recommendedNextOperatorStep}.`;

  return {
    entries,
    latestQueueEntry,
    queueStatus,
    finalCompleteReached,
    stableFinalComplete:
      closeoutFinalizationStabilitySummary.completionThreadStableFinalComplete,
    reopenedAfterFinalization:
      closeoutFinalizationStabilitySummary.completionThreadReopenedAfterFinalization,
    postFinalizationFollowUpOpen:
      closeoutFinalizationStabilitySummary.postFinalizationFollowUpRemainsOpen,
    carryForwardRetained: closeoutFinalizationStabilitySummary.queueRemainsRetained,
    blockedReasonsSummary,
    missingEvidenceSummary,
    recommendedNextOperatorStep:
      closeoutFinalizationStabilitySummary.recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutPostFinalizationFollowupQueue;
}

export function formatSandboxCloseoutPostFinalizationFollowupQueue(
  result: SandboxCloseoutPostFinalizationFollowupQueue,
) {
  return [
    "Sandbox closeout post-finalization follow-up queue",
    `Queue status: ${result.queueStatus}`,
    `Final-complete reached: ${result.finalCompleteReached}`,
    `Stable-final-complete: ${result.stableFinalComplete}`,
    `Reopened after finalization: ${result.reopenedAfterFinalization}`,
    `Post-finalization follow-up open: ${result.postFinalizationFollowUpOpen}`,
    `Carry-forward retained: ${result.carryForwardRetained}`,
    `Blocked reasons: ${result.blockedReasonsSummary.join(" | ") || "none"}`,
    `Missing evidence: ${result.missingEvidenceSummary.join(" | ") || "none"}`,
    `Latest queue entry: ${result.latestQueueEntry?.queuedAt ?? "none"} ${result.latestQueueEntry?.summaryLine ?? ""}`.trimEnd(),
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
