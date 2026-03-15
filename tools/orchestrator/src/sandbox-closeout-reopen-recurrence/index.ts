import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutFinalizationAuditHistory,
  type SandboxCloseoutFinalizationAuditHistory,
} from "../sandbox-closeout-finalization-audit-history";
import {
  buildSandboxCloseoutFinalizationStabilitySummary,
  type SandboxCloseoutFinalizationStabilitySummary,
} from "../sandbox-closeout-finalization-stability-summary";
import {
  buildSandboxCloseoutPostFinalizationFollowupQueue,
  type SandboxCloseoutPostFinalizationFollowupQueue,
} from "../sandbox-closeout-post-finalization-followup-queue";

function collectRepeated(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value]) => value);
}

export type SandboxCloseoutReopenRecurrence = {
  latestReopenStatus:
    | "none"
    | "single_reopen"
    | "repeated_reopen"
    | "repeated_reopen_after_finalization"
    | "reopen_with_followup_open";
  latestReopenReason: string | null;
  reopenCount: number;
  repeatedReopenPatterns: string[];
  repeatedFinalizedThenReopenedPatterns: string[];
  repeatedRetainedAfterReopenPatterns: string[];
  repeatedFollowupOpenAfterFinalizationPatterns: string[];
  reopenRecurrenceActive: boolean;
  recurrenceSeverity: "none" | "low" | "medium" | "high";
  unresolvedRecurrenceReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutReopenRecurrence(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutFinalizationAuditHistory?: SandboxCloseoutFinalizationAuditHistory;
  closeoutFinalizationStabilitySummary?: SandboxCloseoutFinalizationStabilitySummary;
  closeoutPostFinalizationFollowupQueue?: SandboxCloseoutPostFinalizationFollowupQueue;
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
  const closeoutFinalizationStabilitySummary =
    params.closeoutFinalizationStabilitySummary ??
    (await buildSandboxCloseoutFinalizationStabilitySummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationAuditHistory,
    }));
  const closeoutPostFinalizationFollowupQueue =
    params.closeoutPostFinalizationFollowupQueue ??
    (await buildSandboxCloseoutPostFinalizationFollowupQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutFinalizationAuditHistory,
      closeoutFinalizationStabilitySummary,
    }));

  const reopenEntries = closeoutFinalizationAuditHistory.entries.filter(
    (entry) => entry.reopenedAfterFinalization || entry.finalizationStatus === "reopened",
  );
  const ordered = [...closeoutFinalizationAuditHistory.entries].reverse();
  const repeatedRetainedAfterReopenPatterns = collectRepeated(
    ordered.flatMap((entry, index) => {
      if (index === 0) {
        return [];
      }
      const previous = ordered[index - 1];
      if (
        previous.finalizationStatus === "reopened" &&
        (entry.retainedAfterFinalization ||
          entry.finalizationStatus === "retained" ||
          entry.finalizationStatus === "queue_retained_after_finalization")
      ) {
        return [`${previous.finalizationStatus} -> ${entry.finalizationStatus}`];
      }
      return [];
    }),
  );
  const repeatedReopenPatterns = Array.from(
    new Set(
      [
        ...collectRepeated(reopenEntries.map((entry) => entry.summaryLine)),
        ...collectRepeated(
          reopenEntries
            .map((entry) => entry.completionDecisionSnapshot.latestCompletionActionReason)
            .filter((value): value is string => Boolean(value)),
        ),
      ],
    ),
  );
  const repeatedFinalizedThenReopenedPatterns =
    closeoutFinalizationAuditHistory.repeatedReopenedAfterFinalizationPatterns;
  const repeatedFollowupOpenAfterFinalizationPatterns =
    closeoutFinalizationAuditHistory.repeatedPostFinalizationFollowUpOpenPatterns;
  const reopenCount = reopenEntries.length;
  const latestReopenEntry = reopenEntries[0] ?? null;
  const followUpStillOpenAfterReopen =
    closeoutFinalizationStabilitySummary.postFinalizationFollowUpRemainsOpen ||
    closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen;

  let latestReopenStatus: SandboxCloseoutReopenRecurrence["latestReopenStatus"] = "none";
  if (reopenCount > 1 || repeatedFinalizedThenReopenedPatterns.length > 0) {
    latestReopenStatus = "repeated_reopen_after_finalization";
  } else if (followUpStillOpenAfterReopen && reopenCount > 0) {
    latestReopenStatus = "reopen_with_followup_open";
  } else if (reopenCount > 1) {
    latestReopenStatus = "repeated_reopen";
  } else if (reopenCount === 1) {
    latestReopenStatus = "single_reopen";
  }

  const reopenRecurrenceActive =
    reopenCount > 0 ||
    repeatedFinalizedThenReopenedPatterns.length > 0 ||
    repeatedRetainedAfterReopenPatterns.length > 0;

  let recurrenceSeverity: SandboxCloseoutReopenRecurrence["recurrenceSeverity"] = "none";
  if (
    repeatedFinalizedThenReopenedPatterns.length > 0 ||
    reopenCount > 1 ||
    closeoutFinalizationStabilitySummary.completionThreadReopenedAfterFinalization
  ) {
    recurrenceSeverity = "high";
  } else if (
    repeatedRetainedAfterReopenPatterns.length > 0 ||
    repeatedFollowupOpenAfterFinalizationPatterns.length > 0 ||
    followUpStillOpenAfterReopen
  ) {
    recurrenceSeverity = "medium";
  } else if (reopenCount === 1) {
    recurrenceSeverity = "low";
  }

  const latestReopenReason =
    latestReopenEntry?.completionDecisionSnapshot.latestCompletionActionReason ??
    latestReopenEntry?.summaryLine ??
    null;
  const unresolvedRecurrenceReasons = Array.from(
    new Set(
      [
        latestReopenReason,
        ...repeatedReopenPatterns,
        ...repeatedFinalizedThenReopenedPatterns,
        ...repeatedRetainedAfterReopenPatterns,
        ...repeatedFollowupOpenAfterFinalizationPatterns,
        ...closeoutPostFinalizationFollowupQueue.blockedReasonsSummary,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const recommendedNextOperatorStep = reopenRecurrenceActive
    ? closeoutFinalizationStabilitySummary.recommendedNextOperatorStep
    : "stability_stable";
  const summaryLine = !reopenRecurrenceActive
    ? "Sandbox closeout reopen recurrence: no reopen recurrence detected."
    : `Sandbox closeout reopen recurrence: count=${reopenCount}, severity=${recurrenceSeverity}, next=${recommendedNextOperatorStep}.`;

  return {
    latestReopenStatus,
    latestReopenReason,
    reopenCount,
    repeatedReopenPatterns,
    repeatedFinalizedThenReopenedPatterns,
    repeatedRetainedAfterReopenPatterns,
    repeatedFollowupOpenAfterFinalizationPatterns,
    reopenRecurrenceActive,
    recurrenceSeverity,
    unresolvedRecurrenceReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutReopenRecurrence;
}

export function formatSandboxCloseoutReopenRecurrence(
  result: SandboxCloseoutReopenRecurrence,
) {
  return [
    "Sandbox closeout reopen recurrence",
    `Latest reopen status: ${result.latestReopenStatus}`,
    `Latest reopen reason: ${result.latestReopenReason ?? "none"}`,
    `Reopen count: ${result.reopenCount}`,
    `Repeated reopen patterns: ${result.repeatedReopenPatterns.join(" | ") || "none"}`,
    `Repeated finalized-then-reopened patterns: ${result.repeatedFinalizedThenReopenedPatterns.join(" | ") || "none"}`,
    `Repeated retained-after-reopen patterns: ${result.repeatedRetainedAfterReopenPatterns.join(" | ") || "none"}`,
    `Repeated follow-up-open-after-finalization patterns: ${result.repeatedFollowupOpenAfterFinalizationPatterns.join(" | ") || "none"}`,
    `Recurrence active: ${result.reopenRecurrenceActive}`,
    `Recurrence severity: ${result.recurrenceSeverity}`,
    `Unresolved recurrence reasons: ${result.unresolvedRecurrenceReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
