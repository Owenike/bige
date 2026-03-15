import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  listSandboxCloseoutReviewAuditTrail,
  type SandboxCloseoutReviewAuditEntry,
} from "../sandbox-closeout-review-audit-trail";

export type SandboxCloseoutReviewHistory = {
  entries: SandboxCloseoutReviewAuditEntry[];
  latestEntry: SandboxCloseoutReviewAuditEntry | null;
  previousEntry: SandboxCloseoutReviewAuditEntry | null;
  latestReviewAction: SandboxCloseoutReviewAuditEntry["latestReviewAction"] | "none";
  latestDispositionResult: SandboxCloseoutReviewAuditEntry["dispositionSnapshot"]["dispositionResult"] | "none";
  repeatedApprovePatterns: string[];
  repeatedRejectPatterns: string[];
  repeatedFollowupPatterns: string[];
  repeatedDeferPatterns: string[];
  repeatedReopenPatterns: string[];
  repeatedQueueRetainedPatterns: string[];
  repeatedQueueExitPatterns: string[];
  retainedEntryCount: number;
  summaryLine: string;
};

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

function collectTransitionPatterns(entries: SandboxCloseoutReviewAuditEntry[]) {
  const ordered = [...entries].reverse();
  const transitions: string[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    transitions.push(`${previous.latestReviewAction} -> ${current.latestReviewAction}`);
    transitions.push(
      `${previous.dispositionSnapshot.dispositionResult} -> ${current.dispositionSnapshot.dispositionResult}`,
    );
  }
  return collectRepeated(transitions);
}

export async function buildSandboxCloseoutReviewHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const trail = await listSandboxCloseoutReviewAuditTrail({
    configPath: params.configPath,
    limit,
  });
  const latestEntry = trail.records[0] ?? null;
  const previousEntry = trail.records[1] ?? null;
  const repeatedApprovePatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.latestReviewAction === "approve_closeout")
      .map((entry) => entry.summaryLine),
  );
  const repeatedRejectPatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.latestReviewAction === "reject_closeout")
      .map((entry) => entry.summaryLine),
  );
  const repeatedFollowupPatterns = Array.from(
    new Set(
      [
        ...collectRepeated(
          trail.records
            .filter((entry) => entry.latestReviewAction === "request_followup")
            .flatMap((entry) => entry.missingFollowUpSignals.length > 0 ? entry.missingFollowUpSignals : [entry.summaryLine]),
        ),
        ...collectTransitionPatterns(
          trail.records.filter(
            (entry) =>
              entry.latestReviewAction === "request_followup" ||
              entry.latestReviewAction === "approve_closeout",
          ),
        ).filter((pattern) => pattern.includes("request_followup")),
      ],
    ),
  );
  const repeatedDeferPatterns = Array.from(
    new Set(
      [
        ...collectRepeated(
          trail.records
            .filter((entry) => entry.latestReviewAction === "defer_review")
            .map((entry) => entry.summaryLine),
        ),
        ...collectTransitionPatterns(
          trail.records.filter((entry) => entry.latestReviewAction === "defer_review"),
        ),
      ],
    ),
  );
  const repeatedReopenPatterns = Array.from(
    new Set(
      [
        ...collectRepeated(
          trail.records
            .filter((entry) => entry.latestReviewAction === "reopen_review")
            .map((entry) => entry.summaryLine),
        ),
        ...collectTransitionPatterns(
          trail.records.filter(
            (entry) =>
              entry.latestReviewAction === "reopen_review" ||
              entry.latestReviewAction === "reject_closeout",
          ),
        ).filter((pattern) => pattern.includes("reopen_review") || pattern.includes("reject_closeout")),
      ],
    ),
  );
  const repeatedQueueRetainedPatterns = collectRepeated(
    trail.records
      .filter((entry) => !entry.queueExitAllowed)
      .flatMap((entry) => entry.queueRetainedReasons.length > 0 ? entry.queueRetainedReasons : [entry.summaryLine]),
  );
  const repeatedQueueExitPatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.queueExitAllowed)
      .map((entry) => entry.summaryLine),
  );
  const summaryLine =
    latestEntry === null
      ? "No closeout review history has been captured yet."
      : `Sandbox closeout review history: latest=${latestEntry.latestReviewAction}/${latestEntry.dispositionSnapshot.dispositionResult}, retained=${trail.records.length}, reopenPatterns=${repeatedReopenPatterns.join(", ") || "none"}.`;

  return {
    entries: trail.records,
    latestEntry,
    previousEntry,
    latestReviewAction: latestEntry?.latestReviewAction ?? "none",
    latestDispositionResult: latestEntry?.dispositionSnapshot.dispositionResult ?? "none",
    repeatedApprovePatterns,
    repeatedRejectPatterns,
    repeatedFollowupPatterns,
    repeatedDeferPatterns,
    repeatedReopenPatterns,
    repeatedQueueRetainedPatterns,
    repeatedQueueExitPatterns,
    retainedEntryCount: trail.records.length,
    summaryLine,
  } satisfies SandboxCloseoutReviewHistory;
}

export function formatSandboxCloseoutReviewHistory(result: SandboxCloseoutReviewHistory) {
  return [
    "Sandbox closeout review history",
    `Retained entries: ${result.retainedEntryCount}`,
    `Latest review action: ${result.latestReviewAction}`,
    `Latest disposition result: ${result.latestDispositionResult}`,
    `Latest audit: ${result.latestEntry?.auditedAt ?? "none"} ${result.latestEntry?.summaryLine ?? ""}`.trimEnd(),
    `Previous audit: ${result.previousEntry?.auditedAt ?? "none"} ${result.previousEntry?.summaryLine ?? ""}`.trimEnd(),
    `Repeated approve patterns: ${result.repeatedApprovePatterns.join(" | ") || "none"}`,
    `Repeated reject patterns: ${result.repeatedRejectPatterns.join(" | ") || "none"}`,
    `Repeated follow-up patterns: ${result.repeatedFollowupPatterns.join(" | ") || "none"}`,
    `Repeated defer patterns: ${result.repeatedDeferPatterns.join(" | ") || "none"}`,
    `Repeated reopen patterns: ${result.repeatedReopenPatterns.join(" | ") || "none"}`,
    `Repeated queue retained patterns: ${result.repeatedQueueRetainedPatterns.join(" | ") || "none"}`,
    `Repeated queue exit patterns: ${result.repeatedQueueExitPatterns.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
  ].join("\n");
}
