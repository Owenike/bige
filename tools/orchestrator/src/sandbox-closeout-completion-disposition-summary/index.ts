import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutCompletionCarryForwardQueue,
  type SandboxCloseoutCompletionCarryForwardQueue,
} from "../sandbox-closeout-completion-carry-forward-queue";
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
import {
  buildSandboxCloseoutCompletionSummary,
  type SandboxCloseoutCompletionSummary,
} from "../sandbox-closeout-completion-summary";
import {
  buildSandboxCloseoutFollowupSummary,
  type SandboxCloseoutFollowupSummary,
} from "../sandbox-closeout-followup-summary";
import type { SandboxCloseoutSettlementAudit } from "../sandbox-closeout-settlement-audit";

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);

export type SandboxCloseoutCompletionDispositionSummary = {
  latestCompletionAction:
    | SandboxCloseoutCompletionActionRecord["latestCompletionAction"]
    | "none";
  latestCompletionActionStatus:
    | SandboxCloseoutCompletionActionRecord["latestCompletionActionStatus"]
    | "not_run";
  latestCompletionActionReason: string | null;
  latestCompletionStatus: SandboxCloseoutCompletionResolutionSummary["latestCompletionStatus"];
  latestReviewCompleteStatus: boolean;
  latestCloseoutCompleteStatus: boolean;
  latestSettlementStatus: SandboxCloseoutCompletionSummary["latestSettlementStatus"];
  latestFollowupStatus: SandboxCloseoutFollowupSummary["followupStatus"];
  latestQueueStatus: SandboxCloseoutCompletionCarryForwardQueue["queueStatus"];
  dispositionResult:
    | "review_complete_confirmed"
    | "closeout_complete_confirmed"
    | "carry_forward_retained"
    | "completion_reopened";
  dispositionReasons: string[];
  dispositionWarnings: string[];
  carryForwardRemainsOpen: boolean;
  completionQueueExitAllowed: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
  summary: string;
};

export async function buildSandboxCloseoutCompletionDispositionSummary(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutCompletionHistory?: SandboxCloseoutCompletionHistory;
  closeoutCompletionResolutionSummary?: SandboxCloseoutCompletionResolutionSummary;
  closeoutCompletionCarryForwardQueue?: SandboxCloseoutCompletionCarryForwardQueue;
  closeoutCompletionSummary?: SandboxCloseoutCompletionSummary;
  closeoutFollowupSummary?: SandboxCloseoutFollowupSummary;
  latestSettlementAudit?: SandboxCloseoutSettlementAudit | null;
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
  const closeoutFollowupSummary =
    params.closeoutFollowupSummary ??
    (await buildSandboxCloseoutFollowupSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      latestSettlementAudit: params.latestSettlementAudit ?? null,
    }));
  const closeoutCompletionSummary =
    params.closeoutCompletionSummary ??
    (await buildSandboxCloseoutCompletionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFollowupSummary,
      latestSettlementAudit: params.latestSettlementAudit ?? null,
    }));

  let dispositionResult: SandboxCloseoutCompletionDispositionSummary["dispositionResult"] =
    "carry_forward_retained";
  if (
    latestCompletionAction?.latestCompletionAction === "confirm_closeout_complete" &&
    latestCompletionAction.latestCompletionActionStatus === "accepted" &&
    closeoutCompletionResolutionSummary.caseCanBeTreatedAsFullyCompleted &&
    closeoutCompletionResolutionSummary.latestCloseoutCompleteStatus &&
    closeoutCompletionCarryForwardQueue.queueStatus === "empty" &&
    !TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "")
  ) {
    dispositionResult = "closeout_complete_confirmed";
  } else if (
    latestCompletionAction?.latestCompletionAction === "confirm_review_complete" &&
    latestCompletionAction.latestCompletionActionStatus === "accepted" &&
    closeoutCompletionResolutionSummary.latestReviewCompleteStatus &&
    !TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "")
  ) {
    dispositionResult = "review_complete_confirmed";
  } else if (
    latestCompletionAction?.latestCompletionAction === "reopen_completion" &&
    latestCompletionAction.latestCompletionActionStatus === "accepted"
  ) {
    dispositionResult = "completion_reopened";
  }

  const carryForwardRemainsOpen =
    closeoutCompletionCarryForwardQueue.queueStatus !== "empty" ||
    closeoutCompletionResolutionSummary.followUpRemainsOpen;
  const completionQueueExitAllowed =
    dispositionResult === "closeout_complete_confirmed" &&
    closeoutCompletionResolutionSummary.caseCanBeTreatedAsFullyCompleted &&
    closeoutCompletionCarryForwardQueue.queueStatus === "empty";
  const dispositionReasons = Array.from(
    new Set(
      [
        latestCompletionAction?.summaryLine ?? null,
        latestCompletionAction?.latestCompletionActionReason ?? null,
        closeoutCompletionSummary.summaryLine,
        closeoutCompletionResolutionSummary.summaryLine,
        closeoutCompletionCarryForwardQueue.summaryLine,
        closeoutCompletionHistory.summaryLine,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const dispositionWarnings = Array.from(
    new Set(
      [
        ...closeoutCompletionSummary.completionGovernanceWarnings,
        ...closeoutCompletionSummary.completionEvidenceGaps,
        ...closeoutCompletionResolutionSummary.unresolvedCompletionReasons,
        ...closeoutCompletionCarryForwardQueue.carryForwardReasons,
        ...(TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "")
          ? [`terminal_incident_severity:${params.state.lastIncidentSeverity}`]
          : []),
        ...(latestCompletionAction === null
          ? ["No formal closeout completion action has been recorded yet."]
          : latestCompletionAction.latestCompletionActionStatus === "accepted"
            ? []
            : [
                `Latest closeout completion action remained ${latestCompletionAction.latestCompletionActionStatus}.`,
              ]),
      ],
    ),
  );
  const recommendedNextOperatorStep = completionQueueExitAllowed
    ? "completion_complete"
    : closeoutCompletionCarryForwardQueue.recommendedNextOperatorStep;
  const summaryLine =
    completionQueueExitAllowed
      ? "Sandbox closeout completion disposition: closeout-complete confirmed and queue-exitable."
      : dispositionResult === "review_complete_confirmed"
        ? `Sandbox closeout completion disposition: review-complete confirmed; next=${recommendedNextOperatorStep}.`
        : `Sandbox closeout completion disposition: ${dispositionResult}; next=${recommendedNextOperatorStep}.`;
  const summary =
    completionQueueExitAllowed
      ? "Sandbox closeout completion disposition confirms that completion governance is finalized."
      : `Sandbox closeout completion disposition keeps completion governance open because result=${dispositionResult}.`;

  return {
    latestCompletionAction: latestCompletionAction?.latestCompletionAction ?? "none",
    latestCompletionActionStatus:
      latestCompletionAction?.latestCompletionActionStatus ?? "not_run",
    latestCompletionActionReason:
      latestCompletionAction?.latestCompletionActionReason ?? null,
    latestCompletionStatus: closeoutCompletionResolutionSummary.latestCompletionStatus,
    latestReviewCompleteStatus:
      closeoutCompletionResolutionSummary.latestReviewCompleteStatus,
    latestCloseoutCompleteStatus:
      closeoutCompletionResolutionSummary.latestCloseoutCompleteStatus,
    latestSettlementStatus: closeoutCompletionSummary.latestSettlementStatus,
    latestFollowupStatus: closeoutFollowupSummary.followupStatus,
    latestQueueStatus: closeoutCompletionCarryForwardQueue.queueStatus,
    dispositionResult,
    dispositionReasons,
    dispositionWarnings,
    carryForwardRemainsOpen,
    completionQueueExitAllowed,
    recommendedNextOperatorStep,
    summaryLine,
    summary,
  } satisfies SandboxCloseoutCompletionDispositionSummary;
}

export function formatSandboxCloseoutCompletionDispositionSummary(
  result: SandboxCloseoutCompletionDispositionSummary,
) {
  return [
    "Sandbox closeout completion disposition summary",
    `Latest completion action: ${result.latestCompletionAction}/${result.latestCompletionActionStatus}`,
    `Latest completion reason: ${result.latestCompletionActionReason ?? "none"}`,
    `Latest completion status: ${result.latestCompletionStatus}`,
    `Latest review-complete status: ${result.latestReviewCompleteStatus}`,
    `Latest closeout-complete status: ${result.latestCloseoutCompleteStatus}`,
    `Latest settlement status: ${result.latestSettlementStatus}`,
    `Latest follow-up status: ${result.latestFollowupStatus}`,
    `Latest queue status: ${result.latestQueueStatus}`,
    `Disposition result: ${result.dispositionResult}`,
    `Disposition reasons: ${result.dispositionReasons.join(" | ") || "none"}`,
    `Disposition warnings: ${result.dispositionWarnings.join(" | ") || "none"}`,
    `Carry-forward remains open: ${result.carryForwardRemainsOpen}`,
    `Completion queue exit allowed: ${result.completionQueueExitAllowed}`,
    `Summary line: ${result.summaryLine}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
