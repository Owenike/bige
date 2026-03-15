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
  listSandboxCloseoutCompletionDecisionAudit,
  type SandboxCloseoutCompletionDecisionAuditEntry,
} from "../sandbox-closeout-completion-decision-audit";
import {
  buildSandboxCloseoutFinalizationAuditHistory,
  type SandboxCloseoutFinalizationAuditHistory,
} from "../sandbox-closeout-finalization-audit-history";
import {
  buildSandboxCloseoutFollowupSummary,
  type SandboxCloseoutFollowupSummary,
} from "../sandbox-closeout-followup-summary";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

export type SandboxCloseoutFinalizationStabilitySummary = {
  latestFinalizationStatus:
    | SandboxCloseoutFinalizationAuditHistory["latestFinalizationStatus"]
    | "none";
  latestCompletionDecisionStatus: string;
  latestCarryForwardStatus: SandboxCloseoutCompletionCarryForwardQueue["queueStatus"];
  latestFollowUpStatus: SandboxCloseoutFollowupSummary["followupStatus"];
  latestQueueStatus: SandboxCloseoutCompletionCarryForwardQueue["queueStatus"];
  completionThreadFinalComplete: boolean;
  completionThreadStableFinalComplete: boolean;
  completionThreadFinalizedButReopenable: boolean;
  completionThreadReopenedAfterFinalization: boolean;
  postFinalizationFollowUpRemainsOpen: boolean;
  queueRemainsRetained: boolean;
  stabilityStatus:
    | "stable_final_complete"
    | "final_complete_but_reopenable"
    | "reopened_after_finalization"
    | "post_finalization_followup_open"
    | "queue_retained_after_finalization";
  unresolvedStabilityReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutFinalizationStabilitySummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutFinalizationAuditHistory?: SandboxCloseoutFinalizationAuditHistory;
  closeoutCompletionFinalizationSummary?: SandboxCloseoutCompletionFinalizationSummary;
  closeoutCompletionCarryForwardQueue?: SandboxCloseoutCompletionCarryForwardQueue;
  closeoutFollowupSummary?: SandboxCloseoutFollowupSummary;
  closeoutCompletionDecisionAudit?: SandboxCloseoutCompletionDecisionAuditEntry | null;
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
  const closeoutCompletionDecisionAudit =
    params.closeoutCompletionDecisionAudit ??
    (await listSandboxCloseoutCompletionDecisionAudit({
      configPath: params.configPath,
      limit: 1,
    })).records[0] ??
    null;

  const hasBeenReopenedAfterFinalization =
    closeoutFinalizationAuditHistory.entries.some((entry) => entry.reopenedAfterFinalization) ||
    closeoutCompletionFinalizationSummary.completionThreadReopened;
  const postFinalizationFollowUpRemainsOpen =
    closeoutFollowupSummary.followUpOpen &&
    closeoutFinalizationAuditHistory.entries.some(
      (entry) =>
        entry.completionFinalizationSnapshot.completionFinalized ||
        entry.finalizationStatus === "final_complete" ||
        entry.finalizationStatus === "finalized_but_reopenable",
    );
  const queueRemainsRetained =
    closeoutCompletionCarryForwardQueue.queueStatus !== "empty" ||
    closeoutCompletionFinalizationSummary.completionThreadRetained;
  const terminalSeverity = TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "");
  const stableFinalComplete =
    closeoutCompletionFinalizationSummary.completionThreadFinalComplete &&
    !closeoutCompletionFinalizationSummary.completionThreadFinalizedButReopenable &&
    !hasBeenReopenedAfterFinalization &&
    !postFinalizationFollowUpRemainsOpen &&
    !queueRemainsRetained &&
    !terminalSeverity;

  let stabilityStatus: SandboxCloseoutFinalizationStabilitySummary["stabilityStatus"] =
    "queue_retained_after_finalization";
  if (stableFinalComplete) {
    stabilityStatus = "stable_final_complete";
  } else if (hasBeenReopenedAfterFinalization) {
    stabilityStatus = "reopened_after_finalization";
  } else if (postFinalizationFollowUpRemainsOpen) {
    stabilityStatus = "post_finalization_followup_open";
  } else if (closeoutCompletionFinalizationSummary.completionThreadFinalizedButReopenable) {
    stabilityStatus = "final_complete_but_reopenable";
  }

  const unresolvedStabilityReasons = Array.from(
    new Set(
      [
        ...closeoutCompletionFinalizationSummary.unresolvedFinalizationReasons,
        ...closeoutCompletionCarryForwardQueue.carryForwardReasons,
        ...closeoutCompletionCarryForwardQueue.missingEvidenceSummary,
        ...closeoutFinalizationAuditHistory.repeatedReopenedAfterFinalizationPatterns,
        ...closeoutFinalizationAuditHistory.repeatedRetainedAfterFinalizationPatterns,
        ...closeoutFinalizationAuditHistory.repeatedPostFinalizationFollowUpOpenPatterns,
        ...(closeoutFollowupSummary.followUpOpen ? closeoutFollowupSummary.followUpReasons : []),
        ...(closeoutCompletionDecisionAudit?.missingFollowUpSignals ?? []),
        ...(terminalSeverity ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`] : []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const recommendedNextOperatorStep = stableFinalComplete
    ? "completion_complete"
    : closeoutCompletionFinalizationSummary.recommendedNextOperatorStep;
  const summaryLine =
    stableFinalComplete
      ? "Sandbox closeout finalization stability: thread is stable-final-complete."
      : `Sandbox closeout finalization stability: ${stabilityStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestFinalizationStatus: closeoutFinalizationAuditHistory.latestFinalizationStatus,
    latestCompletionDecisionStatus: closeoutCompletionDecisionAudit
      ? `${closeoutCompletionDecisionAudit.latestCompletionAction}/${closeoutCompletionDecisionAudit.latestCompletionActionStatus}`
      : "none",
    latestCarryForwardStatus: closeoutCompletionCarryForwardQueue.queueStatus,
    latestFollowUpStatus: closeoutFollowupSummary.followupStatus,
    latestQueueStatus: closeoutCompletionCarryForwardQueue.queueStatus,
    completionThreadFinalComplete:
      closeoutCompletionFinalizationSummary.completionThreadFinalComplete,
    completionThreadStableFinalComplete: stableFinalComplete,
    completionThreadFinalizedButReopenable:
      closeoutCompletionFinalizationSummary.completionThreadFinalizedButReopenable,
    completionThreadReopenedAfterFinalization: hasBeenReopenedAfterFinalization,
    postFinalizationFollowUpRemainsOpen,
    queueRemainsRetained,
    stabilityStatus,
    unresolvedStabilityReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutFinalizationStabilitySummary;
}

export function formatSandboxCloseoutFinalizationStabilitySummary(
  result: SandboxCloseoutFinalizationStabilitySummary,
) {
  return [
    "Sandbox closeout finalization stability summary",
    `Latest finalization status: ${result.latestFinalizationStatus}`,
    `Latest completion decision status: ${result.latestCompletionDecisionStatus}`,
    `Latest carry-forward status: ${result.latestCarryForwardStatus}`,
    `Latest follow-up status: ${result.latestFollowUpStatus}`,
    `Latest queue status: ${result.latestQueueStatus}`,
    `Final-complete: ${result.completionThreadFinalComplete}`,
    `Stable-final-complete: ${result.completionThreadStableFinalComplete}`,
    `Finalized but reopenable: ${result.completionThreadFinalizedButReopenable}`,
    `Reopened after finalization: ${result.completionThreadReopenedAfterFinalization}`,
    `Post-finalization follow-up open: ${result.postFinalizationFollowUpRemainsOpen}`,
    `Queue remains retained: ${result.queueRemainsRetained}`,
    `Unresolved stability reasons: ${result.unresolvedStabilityReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
