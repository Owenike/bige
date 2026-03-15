import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutCompletionCarryForwardQueue,
  type SandboxCloseoutCompletionCarryForwardQueue,
} from "../sandbox-closeout-completion-carry-forward-queue";
import {
  buildSandboxCloseoutCompletionDispositionSummary,
  type SandboxCloseoutCompletionDispositionSummary,
} from "../sandbox-closeout-completion-disposition-summary";
import {
  listSandboxCloseoutCompletionActions,
  type SandboxCloseoutCompletionActionRecord,
} from "../sandbox-closeout-completion-actions";
import {
  buildSandboxCloseoutCompletionHistory,
  type SandboxCloseoutCompletionHistory,
} from "../sandbox-closeout-completion-history";
import {
  buildSandboxCloseoutCompletionResolutionSummary,
  type SandboxCloseoutCompletionResolutionSummary,
} from "../sandbox-closeout-completion-resolution-summary";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

export type SandboxCloseoutCompletionLifecycle = {
  carryForwardQueueShouldRemain: boolean;
  carryForwardQueueExitAllowed: boolean;
  reviewCompleteFinalized: boolean;
  closeoutCompleteFinalized: boolean;
  keptCarryForwardOpen: boolean;
  completionReopened: boolean;
  lifecycleStatus:
    | "review_complete_finalized"
    | "closeout_complete_finalized"
    | "carry_forward_retained"
    | "completion_reopened"
    | "blocked";
  lifecycleReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutCompletionLifecycle(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutCompletionHistory?: SandboxCloseoutCompletionHistory;
  closeoutCompletionResolutionSummary?: SandboxCloseoutCompletionResolutionSummary;
  closeoutCompletionCarryForwardQueue?: SandboxCloseoutCompletionCarryForwardQueue;
  closeoutCompletionDispositionSummary?: SandboxCloseoutCompletionDispositionSummary;
  latestCompletionAction?: SandboxCloseoutCompletionActionRecord | null;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const closeoutCompletionHistory =
    params.closeoutCompletionHistory ??
    (await buildSandboxCloseoutCompletionHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutCompletionResolutionSummary =
    params.closeoutCompletionResolutionSummary ??
    (await buildSandboxCloseoutCompletionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionHistory,
    }));
  const closeoutCompletionCarryForwardQueue =
    params.closeoutCompletionCarryForwardQueue ??
    (await buildSandboxCloseoutCompletionCarryForwardQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionHistory,
      closeoutCompletionResolutionSummary,
    }));
  const latestCompletionAction =
    params.latestCompletionAction ??
    (await listSandboxCloseoutCompletionActions({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;
  const closeoutCompletionDispositionSummary =
    params.closeoutCompletionDispositionSummary ??
    (await buildSandboxCloseoutCompletionDispositionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionHistory,
      closeoutCompletionResolutionSummary,
      closeoutCompletionCarryForwardQueue,
      latestCompletionAction,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "");
  const closeoutCompleteFinalized =
    !terminalSeverity &&
    closeoutCompletionDispositionSummary.dispositionResult ===
      "closeout_complete_confirmed" &&
    closeoutCompletionDispositionSummary.completionQueueExitAllowed;
  const reviewCompleteFinalized =
    !terminalSeverity &&
    closeoutCompletionDispositionSummary.dispositionResult ===
      "review_complete_confirmed";
  const completionReopened =
    closeoutCompletionDispositionSummary.dispositionResult === "completion_reopened";
  const keptCarryForwardOpen =
    closeoutCompletionDispositionSummary.dispositionResult === "carry_forward_retained" ||
    closeoutCompletionCarryForwardQueue.queueStatus !== "empty";
  const carryForwardQueueShouldRemain =
    terminalSeverity ||
    completionReopened ||
    keptCarryForwardOpen ||
    (reviewCompleteFinalized &&
      (!closeoutCompletionResolutionSummary.latestCloseoutCompleteStatus ||
        closeoutCompletionCarryForwardQueue.queueStatus !== "empty"));
  const lifecycleStatus: SandboxCloseoutCompletionLifecycle["lifecycleStatus"] =
    terminalSeverity
      ? "blocked"
      : closeoutCompleteFinalized
        ? "closeout_complete_finalized"
        : reviewCompleteFinalized
          ? "review_complete_finalized"
          : completionReopened
            ? "completion_reopened"
            : keptCarryForwardOpen
              ? "carry_forward_retained"
              : "blocked";
  const lifecycleReasons = Array.from(
    new Set(
      [
        closeoutCompletionDispositionSummary.summaryLine,
        ...closeoutCompletionDispositionSummary.dispositionReasons,
        ...closeoutCompletionDispositionSummary.dispositionWarnings,
        ...closeoutCompletionResolutionSummary.unresolvedCompletionReasons,
        ...closeoutCompletionCarryForwardQueue.carryForwardReasons,
        ...(terminalSeverity ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`] : []),
      ],
    ),
  );
  const recommendedNextOperatorStep = closeoutCompleteFinalized
    ? "completion_complete"
    : closeoutCompletionDispositionSummary.recommendedNextOperatorStep;
  const summaryLine =
    lifecycleStatus === "closeout_complete_finalized"
      ? "Sandbox closeout completion lifecycle: closeout-complete finalized and queue may exit."
      : lifecycleStatus === "review_complete_finalized"
        ? `Sandbox closeout completion lifecycle: review-complete finalized; carry-forward remains=${carryForwardQueueShouldRemain}.`
        : `Sandbox closeout completion lifecycle: ${lifecycleStatus}; carry-forward remains=${carryForwardQueueShouldRemain}.`;

  return {
    carryForwardQueueShouldRemain,
    carryForwardQueueExitAllowed:
      closeoutCompletionDispositionSummary.completionQueueExitAllowed,
    reviewCompleteFinalized,
    closeoutCompleteFinalized,
    keptCarryForwardOpen,
    completionReopened,
    lifecycleStatus,
    lifecycleReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutCompletionLifecycle;
}

export function formatSandboxCloseoutCompletionLifecycle(
  result: SandboxCloseoutCompletionLifecycle,
) {
  return [
    "Sandbox closeout completion lifecycle",
    `Lifecycle status: ${result.lifecycleStatus}`,
    `Carry-forward queue should remain: ${result.carryForwardQueueShouldRemain}`,
    `Carry-forward queue exit allowed: ${result.carryForwardQueueExitAllowed}`,
    `Review-complete finalized: ${result.reviewCompleteFinalized}`,
    `Closeout-complete finalized: ${result.closeoutCompleteFinalized}`,
    `Kept carry-forward open: ${result.keptCarryForwardOpen}`,
    `Completion reopened: ${result.completionReopened}`,
    `Lifecycle reasons: ${result.lifecycleReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
