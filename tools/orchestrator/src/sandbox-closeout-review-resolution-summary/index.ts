import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutDispositionSummary,
  type SandboxCloseoutDispositionSummary,
} from "../sandbox-closeout-disposition-summary";
import {
  buildSandboxCloseoutReviewHistory,
  type SandboxCloseoutReviewHistory,
} from "../sandbox-closeout-review-history";
import {
  buildSandboxCloseoutReviewLifecycle,
  type SandboxCloseoutReviewLifecycle,
} from "../sandbox-closeout-review-lifecycle";
import {
  buildSandboxCloseoutReviewQueue,
  type SandboxCloseoutReviewQueue,
} from "../sandbox-closeout-review-queue";

export type SandboxCloseoutReviewResolutionSummary = {
  latestReviewAction: SandboxCloseoutReviewHistory["latestReviewAction"];
  latestDispositionResult: SandboxCloseoutReviewHistory["latestDispositionResult"];
  latestLifecycleStatus: SandboxCloseoutReviewLifecycle["lifecycleStatus"];
  latestReviewQueueStatus: SandboxCloseoutReviewQueue["queueStatus"];
  resolutionStatus:
    | "review_settled"
    | "review_reopened"
    | "followup_open"
    | "deferred_pending"
    | "rejected_not_resolved";
  reviewThreadSettled: boolean;
  reviewThreadReopened: boolean;
  followUpRemainsOpen: boolean;
  queueExitAllowed: boolean;
  closeoutCanBeTreatedAsFullyReviewed: boolean;
  unresolvedReviewReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutReviewResolutionSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutDispositionSummary?: SandboxCloseoutDispositionSummary;
  closeoutReviewLifecycle?: SandboxCloseoutReviewLifecycle;
  closeoutReviewQueue?: SandboxCloseoutReviewQueue;
  closeoutReviewHistory?: SandboxCloseoutReviewHistory;
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
  const closeoutReviewHistory =
    params.closeoutReviewHistory ??
    (await buildSandboxCloseoutReviewHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));

  const latestIncidentSeverity =
    closeoutReviewHistory.latestEntry?.latestIncidentSeverity ?? params.state.lastIncidentSeverity;
  const terminalSeverity =
    latestIncidentSeverity === "critical" ||
    latestIncidentSeverity === "manual_required" ||
    latestIncidentSeverity === "blocked";
  const reviewThreadReopened =
    closeoutReviewLifecycle.reopenedForReview ||
    closeoutReviewHistory.latestEntry?.reviewThreadReopened === true;
  const followUpRemainsOpen =
    closeoutDispositionSummary.followUpRemainsOpen ||
    closeoutReviewHistory.latestEntry?.followUpRequested === true ||
    closeoutReviewQueue.evidenceFollowUpRequired;
  let resolutionStatus: SandboxCloseoutReviewResolutionSummary["resolutionStatus"] = "deferred_pending";
  if (reviewThreadReopened) {
    resolutionStatus = "review_reopened";
  } else if (
    closeoutDispositionSummary.dispositionResult === "closeout_rejected" ||
    closeoutReviewLifecycle.returnedToFollowUp
  ) {
    resolutionStatus = "rejected_not_resolved";
  } else if (followUpRemainsOpen || closeoutReviewLifecycle.keptOpenForFollowUp) {
    resolutionStatus = "followup_open";
  } else if (
    closeoutDispositionSummary.dispositionResult === "closeout_approved" &&
    closeoutReviewLifecycle.queueExitAllowed &&
    !terminalSeverity &&
    closeoutReviewQueue.queueStatus === "empty"
  ) {
    resolutionStatus = "review_settled";
  }
  const reviewThreadSettled = resolutionStatus === "review_settled";
  const unresolvedReviewReasons = Array.from(
    new Set(
      [
        ...closeoutDispositionSummary.dispositionWarnings,
        ...closeoutReviewLifecycle.lifecycleReasons,
        ...closeoutReviewQueue.blockedReasonsSummary,
        ...closeoutReviewQueue.missingEvidenceSummary,
        ...(terminalSeverity ? [`terminal_incident_severity:${latestIncidentSeverity}`] : []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const queueExitAllowed =
    reviewThreadSettled &&
    closeoutReviewLifecycle.queueExitAllowed &&
    closeoutDispositionSummary.queueExitAllowed;
  const closeoutCanBeTreatedAsFullyReviewed = reviewThreadSettled && queueExitAllowed;
  const recommendedNextOperatorStep = reviewThreadSettled
    ? "closeout_complete"
    : closeoutReviewLifecycle.recommendedNextOperatorStep;
  const summaryLine =
    reviewThreadSettled
      ? "Sandbox closeout review resolution: thread is settled and fully reviewed."
      : `Sandbox closeout review resolution: ${resolutionStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestReviewAction: closeoutReviewHistory.latestReviewAction,
    latestDispositionResult: closeoutReviewHistory.latestDispositionResult,
    latestLifecycleStatus: closeoutReviewLifecycle.lifecycleStatus,
    latestReviewQueueStatus: closeoutReviewQueue.queueStatus,
    resolutionStatus,
    reviewThreadSettled,
    reviewThreadReopened,
    followUpRemainsOpen,
    queueExitAllowed,
    closeoutCanBeTreatedAsFullyReviewed,
    unresolvedReviewReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutReviewResolutionSummary;
}

export function formatSandboxCloseoutReviewResolutionSummary(
  result: SandboxCloseoutReviewResolutionSummary,
) {
  return [
    "Sandbox closeout review resolution summary",
    `Latest review action: ${result.latestReviewAction}`,
    `Latest disposition result: ${result.latestDispositionResult}`,
    `Latest lifecycle status: ${result.latestLifecycleStatus}`,
    `Latest review queue status: ${result.latestReviewQueueStatus}`,
    `Resolution status: ${result.resolutionStatus}`,
    `Review thread settled: ${result.reviewThreadSettled}`,
    `Review thread reopened: ${result.reviewThreadReopened}`,
    `Follow-up remains open: ${result.followUpRemainsOpen}`,
    `Queue exit allowed: ${result.queueExitAllowed}`,
    `Fully reviewed: ${result.closeoutCanBeTreatedAsFullyReviewed}`,
    `Unresolved review reasons: ${result.unresolvedReviewReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
