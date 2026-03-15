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
import type { SandboxCloseoutCompletionAudit } from "../sandbox-closeout-completion-audit";
import type { SandboxCloseoutSettlementAudit } from "../sandbox-closeout-settlement-audit";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);
const COMPLETE_STATUSES = new Set([
  "review_complete_allowed",
  "closeout_complete_allowed",
]);

export type SandboxCloseoutCompletionResolutionSummary = {
  latestCompletionStatus: SandboxCloseoutCompletionHistory["latestCompletionStatus"];
  latestReviewCompleteStatus: boolean;
  latestCloseoutCompleteStatus: boolean;
  latestSettlementStatus: SandboxCloseoutCompletionSummary["latestSettlementStatus"];
  latestFollowupStatus: SandboxCloseoutFollowupSummary["followupStatus"];
  latestQueueStatus: SandboxCloseoutCompletionQueue["queueStatus"];
  resolutionStatus:
    | "completion_settled"
    | "completion_reverted"
    | "review_complete_only"
    | "closeout_complete"
    | "followup_open"
    | "queue_retained";
  completionThreadSettled: boolean;
  completionThreadReverted: boolean;
  followUpRemainsOpen: boolean;
  queueRemainsRetained: boolean;
  caseCanBeTreatedAsFullyCompleted: boolean;
  unresolvedCompletionReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutCompletionResolutionSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutCompletionHistory?: SandboxCloseoutCompletionHistory;
  closeoutCompletionSummary?: SandboxCloseoutCompletionSummary;
  closeoutCompletionQueue?: SandboxCloseoutCompletionQueue;
  closeoutFollowupSummary?: SandboxCloseoutFollowupSummary;
  closeoutFollowupQueue?: SandboxCloseoutFollowupQueue;
  latestSettlementAudit?: SandboxCloseoutSettlementAudit | null;
  latestCompletionAudit?: SandboxCloseoutCompletionAudit | null;
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
  const closeoutCompletionQueue =
    params.closeoutCompletionQueue ??
    (await buildSandboxCloseoutCompletionQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionSummary,
      closeoutFollowupSummary,
      closeoutFollowupQueue,
      latestSettlementAudit: params.latestSettlementAudit,
      latestCompletionAudit: params.latestCompletionAudit,
    }));

  const latestEntry = closeoutCompletionHistory.latestEntry;
  const latestCompletionStatus =
    latestEntry?.completionStatus ?? closeoutCompletionHistory.latestCompletionStatus;
  const followUpRemainsOpen =
    closeoutFollowupSummary.followUpOpen || closeoutCompletionQueue.followUpOpen;
  const queueRemainsRetained = closeoutCompletionQueue.queueStatus !== "empty";
  const priorCompleteExists = closeoutCompletionHistory.entries
    .slice(1)
    .some((entry) => COMPLETE_STATUSES.has(entry.completionStatus));
  const completionThreadReverted =
    latestEntry !== null &&
    !COMPLETE_STATUSES.has(latestEntry.completionStatus) &&
    (priorCompleteExists || closeoutCompletionHistory.repeatedRevertFromCompletePatterns.length > 0);
  const terminalSeverity = TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "");
  let resolutionStatus: SandboxCloseoutCompletionResolutionSummary["resolutionStatus"] =
    "queue_retained";
  if (
    closeoutCompletionSummary.closeoutCompleteReached &&
    !followUpRemainsOpen &&
    !queueRemainsRetained &&
    !completionThreadReverted &&
    !terminalSeverity
  ) {
    resolutionStatus = "closeout_complete";
  } else if (completionThreadReverted) {
    resolutionStatus = "completion_reverted";
  } else if (followUpRemainsOpen) {
    resolutionStatus = "followup_open";
  } else if (closeoutCompletionSummary.reviewCompleteReached) {
    resolutionStatus = "review_complete_only";
  }
  const completionThreadSettled = resolutionStatus === "closeout_complete";
  const caseCanBeTreatedAsFullyCompleted = completionThreadSettled;
  const unresolvedCompletionReasons = Array.from(
    new Set(
      [
        ...closeoutCompletionSummary.completionReasons,
        ...closeoutCompletionSummary.completionEvidenceGaps,
        ...closeoutCompletionQueue.blockedReasonsSummary,
        ...closeoutCompletionQueue.missingEvidenceSummary,
        ...closeoutFollowupSummary.followUpReasons,
        ...closeoutFollowupSummary.followUpEvidenceGaps,
        ...closeoutFollowupQueue.blockedReasonsSummary,
        ...(params.latestSettlementAudit?.settlementBlockedReasons ?? []),
        ...(completionThreadReverted
          ? closeoutCompletionHistory.repeatedRevertFromCompletePatterns.length > 0
            ? closeoutCompletionHistory.repeatedRevertFromCompletePatterns
            : [`reverted_from_complete:${latestCompletionStatus}`]
          : []),
        ...(terminalSeverity ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`] : []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const recommendedNextOperatorStep = completionThreadSettled
    ? "completion_complete"
    : closeoutCompletionQueue.recommendedNextOperatorStep;
  const summaryLine =
    completionThreadSettled
      ? "Sandbox closeout completion resolution: thread is settled and fully completed."
      : `Sandbox closeout completion resolution: ${resolutionStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    latestCompletionStatus,
    latestReviewCompleteStatus: closeoutCompletionSummary.reviewCompleteReached,
    latestCloseoutCompleteStatus: closeoutCompletionSummary.closeoutCompleteReached,
    latestSettlementStatus: closeoutCompletionSummary.latestSettlementStatus,
    latestFollowupStatus: closeoutFollowupSummary.followupStatus,
    latestQueueStatus: closeoutCompletionQueue.queueStatus,
    resolutionStatus,
    completionThreadSettled,
    completionThreadReverted,
    followUpRemainsOpen,
    queueRemainsRetained,
    caseCanBeTreatedAsFullyCompleted,
    unresolvedCompletionReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutCompletionResolutionSummary;
}

export function formatSandboxCloseoutCompletionResolutionSummary(
  result: SandboxCloseoutCompletionResolutionSummary,
) {
  return [
    "Sandbox closeout completion resolution summary",
    `Latest completion status: ${result.latestCompletionStatus}`,
    `Latest review-complete status: ${result.latestReviewCompleteStatus}`,
    `Latest closeout-complete status: ${result.latestCloseoutCompleteStatus}`,
    `Latest settlement status: ${result.latestSettlementStatus}`,
    `Latest follow-up status: ${result.latestFollowupStatus}`,
    `Latest queue status: ${result.latestQueueStatus}`,
    `Resolution status: ${result.resolutionStatus}`,
    `Completion thread settled: ${result.completionThreadSettled}`,
    `Completion thread reverted: ${result.completionThreadReverted}`,
    `Follow-up remains open: ${result.followUpRemainsOpen}`,
    `Queue remains retained: ${result.queueRemainsRetained}`,
    `Fully completed: ${result.caseCanBeTreatedAsFullyCompleted}`,
    `Unresolved completion reasons: ${result.unresolvedCompletionReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
