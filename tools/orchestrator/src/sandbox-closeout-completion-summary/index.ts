import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxClosureGatingDecision,
  type SandboxClosureGatingDecision,
} from "../sandbox-closure-gating";
import type { SandboxCloseoutCompletionAudit } from "../sandbox-closeout-completion-audit";
import {
  buildSandboxCloseoutDispositionSummary,
  type SandboxCloseoutDispositionSummary,
} from "../sandbox-closeout-disposition-summary";
import {
  buildSandboxCloseoutFollowupQueue,
  type SandboxCloseoutFollowupQueue,
} from "../sandbox-closeout-followup-queue";
import {
  buildSandboxCloseoutFollowupSummary,
  type SandboxCloseoutFollowupSummary,
} from "../sandbox-closeout-followup-summary";
import {
  buildSandboxCloseoutReviewLifecycle,
  type SandboxCloseoutReviewLifecycle,
} from "../sandbox-closeout-review-lifecycle";
import {
  buildSandboxCloseoutReviewResolutionSummary,
  type SandboxCloseoutReviewResolutionSummary,
} from "../sandbox-closeout-review-resolution-summary";
import {
  buildSandboxResolutionEvidenceSummary,
  type SandboxResolutionEvidenceSummary,
} from "../sandbox-resolution-evidence";
import type { SandboxCloseoutSettlementAudit } from "../sandbox-closeout-settlement-audit";

export type SandboxCloseoutCompletionSummary = {
  latestReviewAction: SandboxCloseoutReviewResolutionSummary["latestReviewAction"];
  latestDispositionResult: SandboxCloseoutReviewResolutionSummary["latestDispositionResult"];
  latestLifecycleStatus: SandboxCloseoutReviewResolutionSummary["latestLifecycleStatus"];
  latestSettlementStatus: SandboxCloseoutSettlementAudit["settlementStatus"];
  latestFollowupStatus: SandboxCloseoutFollowupSummary["followupStatus"];
  completionStatus:
    | "review_complete"
    | "closeout_complete"
    | "completion_blocked"
    | "followup_still_open"
    | "queue_still_retained";
  reviewCompleteReached: boolean;
  closeoutCompleteReached: boolean;
  completionBlocked: boolean;
  completionReasons: string[];
  completionEvidenceGaps: string[];
  completionGovernanceWarnings: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutCompletionSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutDispositionSummary?: SandboxCloseoutDispositionSummary;
  closeoutReviewLifecycle?: SandboxCloseoutReviewLifecycle;
  closeoutReviewResolutionSummary?: SandboxCloseoutReviewResolutionSummary;
  closeoutFollowupSummary?: SandboxCloseoutFollowupSummary;
  closeoutFollowupQueue?: SandboxCloseoutFollowupQueue;
  resolutionEvidenceSummary?: SandboxResolutionEvidenceSummary;
  closureGatingDecision?: SandboxClosureGatingDecision;
  latestSettlementAudit?: SandboxCloseoutSettlementAudit | null;
  latestCompletionAudit?: SandboxCloseoutCompletionAudit | null;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutDispositionSummary =
    params.closeoutDispositionSummary ??
    (await buildSandboxCloseoutDispositionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutReviewLifecycle =
    params.closeoutReviewLifecycle ??
    (await buildSandboxCloseoutReviewLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutDispositionSummary,
    }));
  const closeoutReviewResolutionSummary =
    params.closeoutReviewResolutionSummary ??
    (await buildSandboxCloseoutReviewResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutDispositionSummary,
      closeoutReviewLifecycle,
    }));
  const closeoutFollowupSummary =
    params.closeoutFollowupSummary ??
    (await buildSandboxCloseoutFollowupSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutDispositionSummary,
      closeoutReviewLifecycle,
      closeoutReviewResolutionSummary,
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
      closeoutReviewResolutionSummary,
      latestSettlementAudit: params.latestSettlementAudit,
    }));
  const resolutionEvidenceSummary =
    params.resolutionEvidenceSummary ??
    (await buildSandboxResolutionEvidenceSummary({
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

  const latestSettlementStatus =
    params.latestSettlementAudit?.settlementStatus ??
    (closeoutFollowupSummary.closeoutCanBeTreatedAsComplete
      ? "closeout_complete"
      : closeoutFollowupSummary.reviewCanBeTreatedAsComplete
        ? "review_complete"
        : closeoutFollowupSummary.followUpBlockingSettlement
          ? "settlement_blocked"
          : closeoutFollowupSummary.followUpOpen
            ? "followup_open"
            : "settlement_allowed");
  const reviewCompleteReached =
    params.latestCompletionAudit?.reviewCompleteAllowed ??
    closeoutFollowupSummary.reviewCanBeTreatedAsComplete;
  const closeoutCompleteReached =
    params.latestCompletionAudit?.closeoutCompleteAllowed ??
    closeoutFollowupSummary.closeoutCanBeTreatedAsComplete;
  const completionStatus: SandboxCloseoutCompletionSummary["completionStatus"] = closeoutCompleteReached
    ? "closeout_complete"
    : reviewCompleteReached
      ? "review_complete"
      : closeoutFollowupSummary.followUpOpen
        ? "followup_still_open"
        : closeoutFollowupQueue.queueStatus !== "empty"
          ? "queue_still_retained"
          : "completion_blocked";
  const completionBlocked = !closeoutCompleteReached;
  const completionReasons = Array.from(
    new Set(
      [
        ...(params.latestCompletionAudit?.completionBlockedReasons ?? []),
        ...closeoutFollowupSummary.followUpReasons,
        ...closeoutFollowupQueue.blockedReasonsSummary,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const completionEvidenceGaps = Array.from(
    new Set(
      [
        ...(params.latestCompletionAudit?.missingEvidenceSummary ?? []),
        ...closeoutFollowupSummary.followUpEvidenceGaps,
        ...closeoutFollowupQueue.missingEvidenceSummary,
        ...resolutionEvidenceSummary.evidenceGapCodes,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const completionGovernanceWarnings = Array.from(
    new Set(
      [
        ...(params.latestCompletionAudit?.queueRetainedReasons ?? []),
        ...closeoutFollowupSummary.followUpGovernanceWarnings,
        ...closureGatingDecision.blockedReasons,
        ...closeoutReviewLifecycle.lifecycleReasons,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const recommendedNextOperatorStep =
    completionStatus === "closeout_complete"
      ? "completion_complete"
      : closeoutFollowupQueue.recommendedNextOperatorStep;
  const summaryLine =
    completionStatus === "closeout_complete"
      ? "Sandbox closeout completion summary: review and closeout are complete."
      : completionStatus === "review_complete"
        ? "Sandbox closeout completion summary: review is complete, but closeout completion still has pending governance obligations."
        : `Sandbox closeout completion summary: ${completionStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestReviewAction: closeoutReviewResolutionSummary.latestReviewAction,
    latestDispositionResult: closeoutReviewResolutionSummary.latestDispositionResult,
    latestLifecycleStatus: closeoutReviewResolutionSummary.latestLifecycleStatus,
    latestSettlementStatus,
    latestFollowupStatus: closeoutFollowupSummary.followupStatus,
    completionStatus,
    reviewCompleteReached,
    closeoutCompleteReached,
    completionBlocked,
    completionReasons,
    completionEvidenceGaps,
    completionGovernanceWarnings,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutCompletionSummary;
}

export function formatSandboxCloseoutCompletionSummary(result: SandboxCloseoutCompletionSummary) {
  return [
    "Sandbox closeout completion summary",
    `Latest review action: ${result.latestReviewAction}`,
    `Latest disposition result: ${result.latestDispositionResult}`,
    `Latest lifecycle status: ${result.latestLifecycleStatus}`,
    `Latest settlement status: ${result.latestSettlementStatus}`,
    `Latest follow-up status: ${result.latestFollowupStatus}`,
    `Completion status: ${result.completionStatus}`,
    `Review complete reached: ${result.reviewCompleteReached}`,
    `Closeout complete reached: ${result.closeoutCompleteReached}`,
    `Completion blocked: ${result.completionBlocked}`,
    `Completion reasons: ${result.completionReasons.join(" | ") || "none"}`,
    `Completion evidence gaps: ${result.completionEvidenceGaps.join(" | ") || "none"}`,
    `Completion governance warnings: ${result.completionGovernanceWarnings.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
