import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  listSandboxCloseoutCompletionAudits,
  type SandboxCloseoutCompletionAudit,
} from "../sandbox-closeout-completion-audit";

const COMPLETE_STATUSES = new Set([
  "review_complete_allowed",
  "closeout_complete_allowed",
]);

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

function buildRevertPatterns(entries: SandboxCloseoutCompletionAudit[]) {
  const ordered = [...entries].reverse();
  const transitions: string[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      COMPLETE_STATUSES.has(previous.completionStatus) &&
      !COMPLETE_STATUSES.has(current.completionStatus)
    ) {
      transitions.push(`${previous.completionStatus} -> ${current.completionStatus}`);
    }
  }
  return collectRepeated(transitions);
}

export type SandboxCloseoutCompletionHistory = {
  entries: SandboxCloseoutCompletionAudit[];
  latestEntry: SandboxCloseoutCompletionAudit | null;
  previousEntry: SandboxCloseoutCompletionAudit | null;
  latestCompletionStatus: SandboxCloseoutCompletionAudit["completionStatus"] | "none";
  repeatedReviewCompletePatterns: string[];
  repeatedCloseoutCompletePatterns: string[];
  repeatedCompletionBlockedPatterns: string[];
  repeatedQueueRetainedPatterns: string[];
  repeatedFollowupOpenPatterns: string[];
  repeatedRevertFromCompletePatterns: string[];
  latestFollowupSnapshotSummary: string | null;
  latestSettlementSnapshotSummary: string | null;
  latestQueueSnapshotSummary: string | null;
  retainedEntryCount: number;
  summaryLine: string;
};

export async function buildSandboxCloseoutCompletionHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const trail = await listSandboxCloseoutCompletionAudits({
    configPath: params.configPath,
    limit,
  });
  const latestEntry = trail.records[0] ?? null;
  const previousEntry = trail.records[1] ?? null;
  const repeatedReviewCompletePatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.completionStatus === "review_complete_allowed")
      .map((entry) => entry.summaryLine),
  );
  const repeatedCloseoutCompletePatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.completionStatus === "closeout_complete_allowed")
      .map((entry) => entry.summaryLine),
  );
  const repeatedCompletionBlockedPatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.completionStatus === "completion_blocked")
      .flatMap((entry) =>
        entry.completionBlockedReasons.length > 0 ? entry.completionBlockedReasons : [entry.summaryLine],
      ),
  );
  const repeatedQueueRetainedPatterns = collectRepeated(
    trail.records
      .filter(
        (entry) =>
          entry.completionStatus === "queue_retained" || entry.queueRetainedReasons.length > 0,
      )
      .flatMap((entry) =>
        entry.queueRetainedReasons.length > 0 ? entry.queueRetainedReasons : [entry.summaryLine],
      ),
  );
  const repeatedFollowupOpenPatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.completionStatus === "followup_open")
      .flatMap((entry) =>
        entry.missingFollowUpSignals.length > 0 ? entry.missingFollowUpSignals : [entry.summaryLine],
      ),
  );
  const repeatedRevertFromCompletePatterns = buildRevertPatterns(trail.records);
  const summaryLine =
    latestEntry === null
      ? "No closeout completion history has been captured yet."
      : `Sandbox closeout completion history: latest=${latestEntry.completionStatus}, retained=${trail.records.length}, revertPatterns=${repeatedRevertFromCompletePatterns.join(", ") || "none"}.`;

  return {
    entries: trail.records,
    latestEntry,
    previousEntry,
    latestCompletionStatus: latestEntry?.completionStatus ?? "none",
    repeatedReviewCompletePatterns,
    repeatedCloseoutCompletePatterns,
    repeatedCompletionBlockedPatterns,
    repeatedQueueRetainedPatterns,
    repeatedFollowupOpenPatterns,
    repeatedRevertFromCompletePatterns,
    latestFollowupSnapshotSummary: latestEntry?.followupSummarySnapshot.summaryLine ?? null,
    latestSettlementSnapshotSummary: latestEntry?.settlementAuditSnapshot.summaryLine ?? null,
    latestQueueSnapshotSummary: latestEntry?.followupQueueSnapshot.summaryLine ?? null,
    retainedEntryCount: trail.records.length,
    summaryLine,
  } satisfies SandboxCloseoutCompletionHistory;
}

export function formatSandboxCloseoutCompletionHistory(result: SandboxCloseoutCompletionHistory) {
  return [
    "Sandbox closeout completion history",
    `Retained entries: ${result.retainedEntryCount}`,
    `Latest completion status: ${result.latestCompletionStatus}`,
    `Latest audit: ${result.latestEntry?.auditedAt ?? "none"} ${result.latestEntry?.summaryLine ?? ""}`.trimEnd(),
    `Previous audit: ${result.previousEntry?.auditedAt ?? "none"} ${result.previousEntry?.summaryLine ?? ""}`.trimEnd(),
    `Repeated review-complete patterns: ${result.repeatedReviewCompletePatterns.join(" | ") || "none"}`,
    `Repeated closeout-complete patterns: ${result.repeatedCloseoutCompletePatterns.join(" | ") || "none"}`,
    `Repeated completion-blocked patterns: ${result.repeatedCompletionBlockedPatterns.join(" | ") || "none"}`,
    `Repeated queue-retained patterns: ${result.repeatedQueueRetainedPatterns.join(" | ") || "none"}`,
    `Repeated follow-up-open patterns: ${result.repeatedFollowupOpenPatterns.join(" | ") || "none"}`,
    `Repeated revert-from-complete patterns: ${result.repeatedRevertFromCompletePatterns.join(" | ") || "none"}`,
    `Latest follow-up snapshot: ${result.latestFollowupSnapshotSummary ?? "none"}`,
    `Latest settlement snapshot: ${result.latestSettlementSnapshotSummary ?? "none"}`,
    `Latest queue snapshot: ${result.latestQueueSnapshotSummary ?? "none"}`,
    `Summary: ${result.summaryLine}`,
  ].join("\n");
}
