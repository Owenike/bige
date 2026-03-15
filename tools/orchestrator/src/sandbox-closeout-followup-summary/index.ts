import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxClosureGatingDecision,
  type SandboxClosureGatingDecision,
} from "../sandbox-closure-gating";
import {
  buildSandboxCloseoutDispositionSummary,
  type SandboxCloseoutDispositionSummary,
} from "../sandbox-closeout-disposition-summary";
import {
  buildSandboxCloseoutReviewLifecycle,
  type SandboxCloseoutReviewLifecycle,
} from "../sandbox-closeout-review-lifecycle";
import {
  buildSandboxCloseoutReviewQueue,
  type SandboxCloseoutReviewQueue,
} from "../sandbox-closeout-review-queue";
import {
  buildSandboxCloseoutReviewResolutionSummary,
  type SandboxCloseoutReviewResolutionSummary,
} from "../sandbox-closeout-review-resolution-summary";
import {
  buildSandboxResolutionEvidenceSummary,
  type SandboxResolutionEvidenceSummary,
} from "../sandbox-resolution-evidence";
import type { SandboxCloseoutSettlementAudit } from "../sandbox-closeout-settlement-audit";

export type SandboxCloseoutFollowupSummary = {
  latestReviewAction: SandboxCloseoutReviewResolutionSummary["latestReviewAction"];
  latestDispositionResult: SandboxCloseoutReviewResolutionSummary["latestDispositionResult"];
  latestLifecycleStatus: SandboxCloseoutReviewResolutionSummary["latestLifecycleStatus"];
  latestReviewResolutionStatus: SandboxCloseoutReviewResolutionSummary["resolutionStatus"];
  followupStatus:
    | "no_followup_needed"
    | "followup_open"
    | "followup_blocking_settlement"
    | "followup_blocking_closeout_complete";
  followUpOpen: boolean;
  followUpRequired: boolean;
  followUpBlockingSettlement: boolean;
  followUpReasons: string[];
  followUpEvidenceGaps: string[];
  followUpGovernanceWarnings: string[];
  recommendedNextOperatorStep: string;
  reviewCanBeTreatedAsComplete: boolean;
  closeoutCanBeTreatedAsComplete: boolean;
  summaryLine: string;
};

export async function buildSandboxCloseoutFollowupSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutDispositionSummary?: SandboxCloseoutDispositionSummary;
  closeoutReviewLifecycle?: SandboxCloseoutReviewLifecycle;
  closeoutReviewQueue?: SandboxCloseoutReviewQueue;
  closeoutReviewResolutionSummary?: SandboxCloseoutReviewResolutionSummary;
  resolutionEvidenceSummary?: SandboxResolutionEvidenceSummary;
  closureGatingDecision?: SandboxClosureGatingDecision;
  latestSettlementAudit?: SandboxCloseoutSettlementAudit | null;
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
  const closeoutReviewQueue =
    params.closeoutReviewQueue ??
    (await buildSandboxCloseoutReviewQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
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
      closeoutReviewQueue,
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

  const terminalSeverity =
    params.state.lastIncidentSeverity === "critical" ||
    params.state.lastIncidentSeverity === "manual_required" ||
    params.state.lastIncidentSeverity === "blocked";
  const followUpOpen =
    closeoutReviewResolutionSummary.followUpRemainsOpen ||
    closeoutDispositionSummary.followUpRemainsOpen ||
    closeoutReviewQueue.evidenceFollowUpRequired;
  const followUpRequired =
    followUpOpen ||
    closeoutReviewQueue.reviewRequired ||
    closeoutReviewQueue.escalationRequired ||
    resolutionEvidenceSummary.evidenceGapCodes.length > 0;
  const reviewCanBeTreatedAsComplete =
    closeoutReviewResolutionSummary.reviewThreadSettled &&
    !followUpOpen &&
    !terminalSeverity;
  const closeoutCanBeTreatedAsComplete =
    reviewCanBeTreatedAsComplete &&
    closeoutReviewResolutionSummary.closeoutCanBeTreatedAsFullyReviewed &&
    closureGatingDecision.closureAllowed;
  const followUpBlockingSettlement =
    followUpRequired && !closeoutReviewResolutionSummary.reviewThreadSettled;
  const followupStatus: SandboxCloseoutFollowupSummary["followupStatus"] =
    !followUpRequired && closeoutCanBeTreatedAsComplete
      ? "no_followup_needed"
      : followUpBlockingSettlement
        ? "followup_blocking_settlement"
        : followUpOpen && reviewCanBeTreatedAsComplete
          ? "followup_blocking_closeout_complete"
          : "followup_open";
  const followUpReasons = Array.from(
    new Set(
      [
        ...closeoutReviewResolutionSummary.unresolvedReviewReasons,
        ...closeoutReviewQueue.blockedReasonsSummary,
        ...(params.latestSettlementAudit?.settlementBlockedReasons ?? []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const followUpEvidenceGaps = Array.from(
    new Set(
      [
        ...closeoutReviewQueue.missingEvidenceSummary,
        ...resolutionEvidenceSummary.evidenceGapCodes,
        ...(params.latestSettlementAudit?.missingEvidenceSummary ?? []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const followUpGovernanceWarnings = Array.from(
    new Set(
      [
        ...closeoutDispositionSummary.dispositionWarnings,
        ...closeoutReviewLifecycle.lifecycleReasons,
        ...closureGatingDecision.blockedReasons,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const recommendedNextOperatorStep =
    followupStatus === "no_followup_needed"
      ? "closeout_complete"
      : closeoutReviewResolutionSummary.recommendedNextOperatorStep;
  const summaryLine =
    followupStatus === "no_followup_needed"
      ? "Sandbox closeout follow-up summary: no open follow-up remains."
      : `Sandbox closeout follow-up summary: ${followupStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestReviewAction: closeoutReviewResolutionSummary.latestReviewAction,
    latestDispositionResult: closeoutReviewResolutionSummary.latestDispositionResult,
    latestLifecycleStatus: closeoutReviewResolutionSummary.latestLifecycleStatus,
    latestReviewResolutionStatus: closeoutReviewResolutionSummary.resolutionStatus,
    followupStatus,
    followUpOpen,
    followUpRequired,
    followUpBlockingSettlement,
    followUpReasons,
    followUpEvidenceGaps,
    followUpGovernanceWarnings,
    recommendedNextOperatorStep,
    reviewCanBeTreatedAsComplete,
    closeoutCanBeTreatedAsComplete,
    summaryLine,
  } satisfies SandboxCloseoutFollowupSummary;
}

export function formatSandboxCloseoutFollowupSummary(result: SandboxCloseoutFollowupSummary) {
  return [
    "Sandbox closeout follow-up summary",
    `Latest review action: ${result.latestReviewAction}`,
    `Latest disposition result: ${result.latestDispositionResult}`,
    `Latest lifecycle status: ${result.latestLifecycleStatus}`,
    `Latest review resolution status: ${result.latestReviewResolutionStatus}`,
    `Follow-up status: ${result.followupStatus}`,
    `Follow-up open: ${result.followUpOpen}`,
    `Follow-up required: ${result.followUpRequired}`,
    `Follow-up blocking settlement: ${result.followUpBlockingSettlement}`,
    `Review complete: ${result.reviewCanBeTreatedAsComplete}`,
    `Closeout complete: ${result.closeoutCanBeTreatedAsComplete}`,
    `Follow-up reasons: ${result.followUpReasons.join(" | ") || "none"}`,
    `Follow-up evidence gaps: ${result.followUpEvidenceGaps.join(" | ") || "none"}`,
    `Follow-up governance warnings: ${result.followUpGovernanceWarnings.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
