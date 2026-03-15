import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutCompletionCarryForwardQueue,
  type SandboxCloseoutCompletionCarryForwardQueue,
} from "../sandbox-closeout-completion-carry-forward-queue";
import {
  buildSandboxCloseoutCompletionDecisionHistory,
  type SandboxCloseoutCompletionDecisionHistory,
} from "../sandbox-closeout-completion-decision-history";
import {
  listSandboxCloseoutCompletionDecisionAudit,
  type SandboxCloseoutCompletionDecisionAuditEntry,
} from "../sandbox-closeout-completion-decision-audit";
import {
  buildSandboxCloseoutCompletionDispositionSummary,
  type SandboxCloseoutCompletionDispositionSummary,
} from "../sandbox-closeout-completion-disposition-summary";
import {
  buildSandboxCloseoutCompletionLifecycle,
  type SandboxCloseoutCompletionLifecycle,
} from "../sandbox-closeout-completion-lifecycle";
import {
  buildSandboxCloseoutCompletionResolutionSummary,
  type SandboxCloseoutCompletionResolutionSummary,
} from "../sandbox-closeout-completion-resolution-summary";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

export type SandboxCloseoutCompletionFinalizationSummary = {
  latestCompletionAction:
    | SandboxCloseoutCompletionDecisionHistory["latestCompletionAction"]
    | "none";
  latestDispositionResult:
    | SandboxCloseoutCompletionDecisionHistory["latestDispositionResult"]
    | "none";
  latestLifecycleStatus: SandboxCloseoutCompletionLifecycle["lifecycleStatus"];
  latestCompletionResolutionStatus: SandboxCloseoutCompletionResolutionSummary["resolutionStatus"];
  latestCarryForwardQueueStatus: SandboxCloseoutCompletionCarryForwardQueue["queueStatus"];
  finalizationStatus:
    | "final_complete"
    | "finalized_but_reopenable"
    | "retained"
    | "reopened"
    | "followup_open"
    | "queue_retained";
  completionThreadFinalComplete: boolean;
  completionThreadFinalizedButReopenable: boolean;
  completionThreadRetained: boolean;
  completionThreadReopened: boolean;
  followUpRemainsOpen: boolean;
  queueExitAllowed: boolean;
  caseCanBeTreatedAsReviewComplete: boolean;
  caseCanBeTreatedAsCloseoutComplete: boolean;
  caseCanBeTreatedAsFinalComplete: boolean;
  unresolvedFinalizationReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutCompletionFinalizationSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutCompletionDecisionAudit?: SandboxCloseoutCompletionDecisionAuditEntry | null;
  closeoutCompletionDecisionHistory?: SandboxCloseoutCompletionDecisionHistory;
  closeoutCompletionDispositionSummary?: SandboxCloseoutCompletionDispositionSummary;
  closeoutCompletionLifecycle?: SandboxCloseoutCompletionLifecycle;
  closeoutCompletionCarryForwardQueue?: SandboxCloseoutCompletionCarryForwardQueue;
  closeoutCompletionResolutionSummary?: SandboxCloseoutCompletionResolutionSummary;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutCompletionResolutionSummary =
    params.closeoutCompletionResolutionSummary ??
    (await buildSandboxCloseoutCompletionResolutionSummary({
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
      closeoutCompletionResolutionSummary,
    }));
  const closeoutCompletionDispositionSummary =
    params.closeoutCompletionDispositionSummary ??
    (await buildSandboxCloseoutCompletionDispositionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionResolutionSummary,
      closeoutCompletionCarryForwardQueue,
    }));
  const closeoutCompletionLifecycle =
    params.closeoutCompletionLifecycle ??
    (await buildSandboxCloseoutCompletionLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionResolutionSummary,
      closeoutCompletionCarryForwardQueue,
      closeoutCompletionDispositionSummary,
    }));
  const closeoutCompletionDecisionAudit =
    params.closeoutCompletionDecisionAudit ??
    (await listSandboxCloseoutCompletionDecisionAudit({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;
  const closeoutCompletionDecisionHistory =
    params.closeoutCompletionDecisionHistory ??
    (await buildSandboxCloseoutCompletionDecisionHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));

  const terminalSeverity = TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "");
  const followUpRemainsOpen =
    closeoutCompletionResolutionSummary.followUpRemainsOpen ||
    closeoutCompletionCarryForwardQueue.followUpOpen ||
    (closeoutCompletionDecisionAudit?.missingFollowUpSignals.length ?? 0) > 0;
  const queueRetained =
    closeoutCompletionCarryForwardQueue.queueStatus !== "empty" ||
    !closeoutCompletionLifecycle.carryForwardQueueExitAllowed ||
    (closeoutCompletionDecisionAudit?.queueRetainedReasons.length ?? 0) > 0;
  const reopened =
    closeoutCompletionLifecycle.completionReopened ||
    closeoutCompletionDecisionAudit?.completionReopened === true;
  const retained =
    closeoutCompletionLifecycle.keptCarryForwardOpen ||
    closeoutCompletionDecisionAudit?.completionRetained === true;
  const finalized =
    closeoutCompletionLifecycle.closeoutCompleteFinalized ||
    closeoutCompletionLifecycle.reviewCompleteFinalized ||
    closeoutCompletionDecisionAudit?.completionFinalized === true;
  const finalizedButReopenable =
    finalized &&
    !terminalSeverity &&
    (closeoutCompletionDecisionHistory.repeatedFinalizedToReopenedPatterns.length > 0 ||
      closeoutCompletionDecisionHistory.repeatedReopenCompletionPatterns.length > 0 ||
      closeoutCompletionResolutionSummary.completionThreadReverted);
  const finalComplete =
    closeoutCompletionLifecycle.closeoutCompleteFinalized &&
    closeoutCompletionResolutionSummary.caseCanBeTreatedAsFullyCompleted &&
    !followUpRemainsOpen &&
    !queueRetained &&
    !reopened &&
    !terminalSeverity &&
    !finalizedButReopenable;

  let finalizationStatus: SandboxCloseoutCompletionFinalizationSummary["finalizationStatus"] =
    "queue_retained";
  if (reopened) {
    finalizationStatus = "reopened";
  } else if (followUpRemainsOpen) {
    finalizationStatus = "followup_open";
  } else if (finalComplete) {
    finalizationStatus = "final_complete";
  } else if (finalizedButReopenable) {
    finalizationStatus = "finalized_but_reopenable";
  } else if (retained) {
    finalizationStatus = "retained";
  }

  const unresolvedFinalizationReasons = Array.from(
    new Set(
      [
        ...closeoutCompletionLifecycle.lifecycleReasons,
        ...closeoutCompletionDispositionSummary.dispositionWarnings,
        ...closeoutCompletionCarryForwardQueue.carryForwardReasons,
        ...closeoutCompletionCarryForwardQueue.missingEvidenceSummary,
        ...closeoutCompletionResolutionSummary.unresolvedCompletionReasons,
        ...(closeoutCompletionDecisionAudit?.queueRetainedReasons ?? []),
        ...(closeoutCompletionDecisionAudit?.missingFollowUpSignals ?? []),
        ...(closeoutCompletionDecisionAudit?.missingEvidenceSignals ?? []),
        ...closeoutCompletionDecisionHistory.repeatedFinalizedToReopenedPatterns,
        ...(terminalSeverity ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`] : []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const recommendedNextOperatorStep = finalComplete
    ? "completion_complete"
    : closeoutCompletionLifecycle.recommendedNextOperatorStep;
  const summaryLine =
    finalComplete
      ? "Sandbox closeout completion finalization: thread is final-complete."
      : `Sandbox closeout completion finalization: ${finalizationStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestCompletionAction:
      closeoutCompletionDecisionAudit?.latestCompletionAction ??
      closeoutCompletionDecisionHistory.latestCompletionAction,
    latestDispositionResult:
      closeoutCompletionDecisionAudit?.dispositionSnapshot.dispositionResult ??
      closeoutCompletionDecisionHistory.latestDispositionResult,
    latestLifecycleStatus: closeoutCompletionLifecycle.lifecycleStatus,
    latestCompletionResolutionStatus:
      closeoutCompletionResolutionSummary.resolutionStatus,
    latestCarryForwardQueueStatus: closeoutCompletionCarryForwardQueue.queueStatus,
    finalizationStatus,
    completionThreadFinalComplete: finalComplete,
    completionThreadFinalizedButReopenable: finalizedButReopenable,
    completionThreadRetained: retained,
    completionThreadReopened: reopened,
    followUpRemainsOpen,
    queueExitAllowed: closeoutCompletionLifecycle.carryForwardQueueExitAllowed,
    caseCanBeTreatedAsReviewComplete:
      closeoutCompletionResolutionSummary.latestReviewCompleteStatus,
    caseCanBeTreatedAsCloseoutComplete:
      closeoutCompletionResolutionSummary.latestCloseoutCompleteStatus,
    caseCanBeTreatedAsFinalComplete: finalComplete,
    unresolvedFinalizationReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutCompletionFinalizationSummary;
}

export function formatSandboxCloseoutCompletionFinalizationSummary(
  result: SandboxCloseoutCompletionFinalizationSummary,
) {
  return [
    "Sandbox closeout completion finalization summary",
    `Latest completion action: ${result.latestCompletionAction}`,
    `Latest disposition result: ${result.latestDispositionResult}`,
    `Latest lifecycle status: ${result.latestLifecycleStatus}`,
    `Latest completion resolution status: ${result.latestCompletionResolutionStatus}`,
    `Latest carry-forward queue status: ${result.latestCarryForwardQueueStatus}`,
    `Finalization status: ${result.finalizationStatus}`,
    `Final-complete: ${result.completionThreadFinalComplete}`,
    `Finalized but reopenable: ${result.completionThreadFinalizedButReopenable}`,
    `Retained: ${result.completionThreadRetained}`,
    `Reopened: ${result.completionThreadReopened}`,
    `Follow-up remains open: ${result.followUpRemainsOpen}`,
    `Queue exit allowed: ${result.queueExitAllowed}`,
    `Review-complete: ${result.caseCanBeTreatedAsReviewComplete}`,
    `Closeout-complete: ${result.caseCanBeTreatedAsCloseoutComplete}`,
    `Final-complete allowed: ${result.caseCanBeTreatedAsFinalComplete}`,
    `Unresolved finalization reasons: ${result.unresolvedFinalizationReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
