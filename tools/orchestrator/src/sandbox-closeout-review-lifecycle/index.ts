import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutDispositionSummary,
  type SandboxCloseoutDispositionSummary,
} from "../sandbox-closeout-disposition-summary";
import {
  buildSandboxCloseoutReviewQueue,
  type SandboxCloseoutReviewQueue,
} from "../sandbox-closeout-review-queue";
import {
  buildSandboxCloseoutReviewSummary,
  type SandboxCloseoutReviewSummary,
} from "../sandbox-closeout-review-summary";
import { listSandboxCloseoutReviewActions, type SandboxCloseoutReviewActionRecord } from "../sandbox-closeout-review-actions";

export type SandboxCloseoutReviewLifecycle = {
  queueShouldRemain: boolean;
  queueExitAllowed: boolean;
  closeoutCompleted: boolean;
  returnedToFollowUp: boolean;
  keptOpenForFollowUp: boolean;
  deferredKeepsReviewPending: boolean;
  reopenedForReview: boolean;
  lifecycleStatus:
    | "closeout_complete"
    | "followup_open"
    | "review_pending"
    | "queue_reopened"
    | "blocked";
  lifecycleReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutReviewLifecycle(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutReviewSummary?: SandboxCloseoutReviewSummary;
  closeoutReviewQueue?: SandboxCloseoutReviewQueue;
  closeoutDispositionSummary?: SandboxCloseoutDispositionSummary;
  latestReviewAction?: SandboxCloseoutReviewActionRecord | null;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const latestReviewAction =
    params.latestReviewAction ??
    (await listSandboxCloseoutReviewActions({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;
  const closeoutReviewSummary =
    params.closeoutReviewSummary ??
    (await buildSandboxCloseoutReviewSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutReviewQueue =
    params.closeoutReviewQueue ??
    (await buildSandboxCloseoutReviewQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      latestReviewAction,
    }));
  const closeoutDispositionSummary =
    params.closeoutDispositionSummary ??
    (await buildSandboxCloseoutDispositionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutReviewSummary,
      closeoutReviewQueue,
      latestReviewAction,
    }));

  const closeoutCompleted = closeoutDispositionSummary.dispositionResult === "closeout_approved";
  const returnedToFollowUp = closeoutDispositionSummary.dispositionResult === "closeout_rejected";
  const keptOpenForFollowUp = closeoutDispositionSummary.dispositionResult === "followup_required";
  const deferredKeepsReviewPending = closeoutDispositionSummary.dispositionResult === "review_deferred";
  const reopenedForReview = closeoutDispositionSummary.dispositionResult === "reopened_for_review";
  const queueShouldRemain = !closeoutDispositionSummary.queueExitAllowed;
  const lifecycleStatus =
    closeoutCompleted
      ? "closeout_complete"
      : closeoutReviewQueue.queueStatus === "blocked"
        ? "blocked"
        : reopenedForReview
          ? "queue_reopened"
          : returnedToFollowUp || keptOpenForFollowUp
            ? "followup_open"
            : "review_pending";
  const lifecycleReasons = Array.from(
    new Set(
      [
        closeoutDispositionSummary.summaryLine,
        ...closeoutDispositionSummary.dispositionReasons,
        ...closeoutDispositionSummary.dispositionWarnings,
      ],
    ),
  );
  const summaryLine =
    lifecycleStatus === "closeout_complete"
      ? "Sandbox closeout lifecycle: queue may exit and closeout is complete."
      : `Sandbox closeout lifecycle: ${lifecycleStatus}; queue remains=${queueShouldRemain}.`;

  return {
    queueShouldRemain,
    queueExitAllowed: closeoutDispositionSummary.queueExitAllowed,
    closeoutCompleted,
    returnedToFollowUp,
    keptOpenForFollowUp,
    deferredKeepsReviewPending,
    reopenedForReview,
    lifecycleStatus,
    lifecycleReasons,
    recommendedNextOperatorStep: closeoutDispositionSummary.recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutReviewLifecycle;
}

export function formatSandboxCloseoutReviewLifecycle(result: SandboxCloseoutReviewLifecycle) {
  return [
    "Sandbox closeout review lifecycle",
    `Lifecycle status: ${result.lifecycleStatus}`,
    `Queue should remain: ${result.queueShouldRemain}`,
    `Queue exit allowed: ${result.queueExitAllowed}`,
    `Closeout completed: ${result.closeoutCompleted}`,
    `Returned to follow-up: ${result.returnedToFollowUp}`,
    `Kept open for follow-up: ${result.keptOpenForFollowUp}`,
    `Deferred keeps review pending: ${result.deferredKeepsReviewPending}`,
    `Reopened for review: ${result.reopenedForReview}`,
    `Lifecycle reasons: ${result.lifecycleReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
