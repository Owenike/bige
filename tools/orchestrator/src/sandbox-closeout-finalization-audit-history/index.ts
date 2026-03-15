import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  listSandboxCloseoutCompletionDecisionAudit,
  type SandboxCloseoutCompletionDecisionAuditEntry,
} from "../sandbox-closeout-completion-decision-audit";

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

export type SandboxCloseoutFinalizationAuditHistoryEntry = {
  completionDecisionAuditId: string;
  auditedAt: string;
  finalizationStatus:
    | "final_complete"
    | "finalized_but_reopenable"
    | "retained"
    | "reopened"
    | "post_finalization_followup_open"
    | "queue_retained_after_finalization";
  completionDecisionSnapshot: {
    latestCompletionAction: SandboxCloseoutCompletionDecisionAuditEntry["latestCompletionAction"];
    latestCompletionActionStatus: SandboxCloseoutCompletionDecisionAuditEntry["latestCompletionActionStatus"];
    latestCompletionActionReason: string | null;
    latestCompletionActionNote: string | null;
    summaryLine: string;
  };
  completionFinalizationSnapshot: {
    completionFinalized: boolean;
    completionRetained: boolean;
    completionReopened: boolean;
    queueExitAllowed: boolean;
    summaryLine: string;
  };
  carryForwardSnapshot: {
    queueStatus: SandboxCloseoutCompletionDecisionAuditEntry["carryForwardQueueSnapshot"]["queueStatus"];
    followUpOpen: boolean;
    summaryLine: string;
  };
  followUpSnapshot: {
    followUpOpen: boolean;
    missingFollowUpSignals: string[];
    missingEvidenceSignals: string[];
    summaryLine: string;
  };
  reopenedAfterFinalization: boolean;
  retainedAfterFinalization: boolean;
  postFinalizationFollowUpOpen: boolean;
  summaryLine: string;
};

export type SandboxCloseoutFinalizationAuditHistory = {
  entries: SandboxCloseoutFinalizationAuditHistoryEntry[];
  latestEntry: SandboxCloseoutFinalizationAuditHistoryEntry | null;
  previousEntry: SandboxCloseoutFinalizationAuditHistoryEntry | null;
  latestFinalizationStatus:
    | SandboxCloseoutFinalizationAuditHistoryEntry["finalizationStatus"]
    | "none";
  latestCompletionDecisionSnapshot:
    | SandboxCloseoutFinalizationAuditHistoryEntry["completionDecisionSnapshot"]
    | null;
  latestCompletionFinalizationSnapshot:
    | SandboxCloseoutFinalizationAuditHistoryEntry["completionFinalizationSnapshot"]
    | null;
  latestCarryForwardSnapshot:
    | SandboxCloseoutFinalizationAuditHistoryEntry["carryForwardSnapshot"]
    | null;
  latestFollowUpSnapshot:
    | SandboxCloseoutFinalizationAuditHistoryEntry["followUpSnapshot"]
    | null;
  repeatedFinalizedPatterns: string[];
  repeatedReopenedAfterFinalizationPatterns: string[];
  repeatedRetainedAfterFinalizationPatterns: string[];
  repeatedPostFinalizationFollowUpOpenPatterns: string[];
  retainedEntryCount: number;
  summaryLine: string;
};

function buildHistoryEntries(records: SandboxCloseoutCompletionDecisionAuditEntry[]) {
  const ordered = [...records].reverse();
  return ordered.map((record, index) => {
    const previous = ordered[index - 1] ?? null;
    const followUpOpen =
      record.missingFollowUpSignals.length > 0 || record.resolutionSnapshot.followUpRemainsOpen;
    const queueRetained =
      record.carryForwardQueueSnapshot.queueStatus !== "empty" ||
      record.queueRetainedReasons.length > 0 ||
      record.completionRetained;
    const reopenedAfterFinalization =
      previous?.completionFinalized === true && record.completionReopened;
    const retainedAfterFinalization =
      previous?.completionFinalized === true &&
      !reopenedAfterFinalization &&
      (record.completionRetained || queueRetained);
    const postFinalizationFollowUpOpen =
      previous?.completionFinalized === true && !reopenedAfterFinalization && followUpOpen;

    let finalizationStatus: SandboxCloseoutFinalizationAuditHistoryEntry["finalizationStatus"] =
      "queue_retained_after_finalization";
    if (reopenedAfterFinalization || record.completionReopened) {
      finalizationStatus = "reopened";
    } else if (postFinalizationFollowUpOpen) {
      finalizationStatus = "post_finalization_followup_open";
    } else if (record.completionFinalized && !queueRetained && !followUpOpen) {
      finalizationStatus = "final_complete";
    } else if (record.completionFinalized) {
      finalizationStatus = "finalized_but_reopenable";
    } else if (retainedAfterFinalization || queueRetained) {
      finalizationStatus = "retained";
    }

    const summaryLine =
      finalizationStatus === "final_complete"
        ? "Closeout finalization audit history: thread reached final-complete."
        : `Closeout finalization audit history: ${finalizationStatus}; carry-forward=${record.carryForwardQueueSnapshot.queueStatus}.`;

    return {
      completionDecisionAuditId: record.id,
      auditedAt: record.auditedAt,
      finalizationStatus,
      completionDecisionSnapshot: {
        latestCompletionAction: record.latestCompletionAction,
        latestCompletionActionStatus: record.latestCompletionActionStatus,
        latestCompletionActionReason: record.latestCompletionActionReason,
        latestCompletionActionNote: record.latestCompletionActionNote,
        summaryLine: record.summaryLine,
      },
      completionFinalizationSnapshot: {
        completionFinalized: record.completionFinalized,
        completionRetained: record.completionRetained,
        completionReopened: record.completionReopened,
        queueExitAllowed: record.lifecycleSnapshot.carryForwardQueueExitAllowed,
        summaryLine: record.lifecycleSnapshot.summaryLine,
      },
      carryForwardSnapshot: {
        queueStatus: record.carryForwardQueueSnapshot.queueStatus,
        followUpOpen: record.carryForwardQueueSnapshot.followUpOpen,
        summaryLine: record.carryForwardQueueSnapshot.summaryLine,
      },
      followUpSnapshot: {
        followUpOpen,
        missingFollowUpSignals: record.missingFollowUpSignals,
        missingEvidenceSignals: record.missingEvidenceSignals,
        summaryLine:
          followUpOpen
            ? `Follow-up remained open after ${record.latestCompletionAction}.`
            : "No follow-up remained open for this completion decision.",
      },
      reopenedAfterFinalization,
      retainedAfterFinalization,
      postFinalizationFollowUpOpen,
      summaryLine,
    } satisfies SandboxCloseoutFinalizationAuditHistoryEntry;
  });
}

export async function buildSandboxCloseoutFinalizationAuditHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
}) {
  const trail = await listSandboxCloseoutCompletionDecisionAudit({
    configPath: params.configPath,
    limit: Math.max(3, params.limit ?? 10),
  });
  const entries = buildHistoryEntries(trail.records).reverse();
  const latestEntry = entries[0] ?? null;
  const previousEntry = entries[1] ?? null;
  const repeatedFinalizedPatterns = collectRepeated(
    entries
      .filter((entry) =>
        entry.finalizationStatus === "final_complete" ||
        entry.finalizationStatus === "finalized_but_reopenable",
      )
      .map((entry) => entry.summaryLine),
  );
  const repeatedReopenedAfterFinalizationPatterns = collectRepeated(
    entries
      .filter((entry) => entry.reopenedAfterFinalization)
      .map(
        (entry) =>
          `${entry.completionFinalizationSnapshot.summaryLine} -> ${entry.summaryLine}`,
      ),
  );
  const repeatedRetainedAfterFinalizationPatterns = collectRepeated(
    entries
      .filter((entry) => entry.retainedAfterFinalization)
      .flatMap((entry) => [
        entry.summaryLine,
        ...trail.records.find((record) => record.id === entry.completionDecisionAuditId)
          ?.queueRetainedReasons ?? [],
      ]),
  );
  const repeatedPostFinalizationFollowUpOpenPatterns = collectRepeated(
    entries
      .filter((entry) => entry.postFinalizationFollowUpOpen)
      .flatMap((entry) => [
        entry.summaryLine,
        ...entry.followUpSnapshot.missingFollowUpSignals,
      ]),
  );
  const summaryLine =
    latestEntry === null
      ? "No closeout finalization audit history has been captured yet."
      : `Sandbox closeout finalization history: latest=${latestEntry.finalizationStatus}, reopenedAfterFinalization=${repeatedReopenedAfterFinalizationPatterns.join(", ") || "none"}.`;

  return {
    entries,
    latestEntry,
    previousEntry,
    latestFinalizationStatus: latestEntry?.finalizationStatus ?? "none",
    latestCompletionDecisionSnapshot: latestEntry?.completionDecisionSnapshot ?? null,
    latestCompletionFinalizationSnapshot:
      latestEntry?.completionFinalizationSnapshot ?? null,
    latestCarryForwardSnapshot: latestEntry?.carryForwardSnapshot ?? null,
    latestFollowUpSnapshot: latestEntry?.followUpSnapshot ?? null,
    repeatedFinalizedPatterns,
    repeatedReopenedAfterFinalizationPatterns,
    repeatedRetainedAfterFinalizationPatterns,
    repeatedPostFinalizationFollowUpOpenPatterns,
    retainedEntryCount: entries.length,
    summaryLine,
  } satisfies SandboxCloseoutFinalizationAuditHistory;
}

export function formatSandboxCloseoutFinalizationAuditHistory(
  result: SandboxCloseoutFinalizationAuditHistory,
) {
  return [
    "Sandbox closeout finalization audit history",
    `Retained entries: ${result.retainedEntryCount}`,
    `Latest finalization status: ${result.latestFinalizationStatus}`,
    `Latest audit: ${result.latestEntry?.auditedAt ?? "none"} ${result.latestEntry?.summaryLine ?? ""}`.trimEnd(),
    `Previous audit: ${result.previousEntry?.auditedAt ?? "none"} ${result.previousEntry?.summaryLine ?? ""}`.trimEnd(),
    `Repeated finalized patterns: ${result.repeatedFinalizedPatterns.join(" | ") || "none"}`,
    `Repeated reopened-after-finalization patterns: ${result.repeatedReopenedAfterFinalizationPatterns.join(" | ") || "none"}`,
    `Repeated retained-after-finalization patterns: ${result.repeatedRetainedAfterFinalizationPatterns.join(" | ") || "none"}`,
    `Repeated post-finalization-followup-open patterns: ${result.repeatedPostFinalizationFollowUpOpenPatterns.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
  ].join("\n");
}
