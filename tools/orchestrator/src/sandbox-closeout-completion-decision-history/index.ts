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

function collectTransitionPatterns(entries: SandboxCloseoutCompletionDecisionAuditEntry[]) {
  const ordered = [...entries].reverse();
  const transitions: string[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    transitions.push(`${previous.latestCompletionAction} -> ${current.latestCompletionAction}`);
    transitions.push(
      `${previous.lifecycleSnapshot.lifecycleStatus} -> ${current.lifecycleSnapshot.lifecycleStatus}`,
    );
  }
  return collectRepeated(transitions);
}

export type SandboxCloseoutCompletionDecisionHistory = {
  entries: SandboxCloseoutCompletionDecisionAuditEntry[];
  latestEntry: SandboxCloseoutCompletionDecisionAuditEntry | null;
  previousEntry: SandboxCloseoutCompletionDecisionAuditEntry | null;
  latestCompletionAction:
    | SandboxCloseoutCompletionDecisionAuditEntry["latestCompletionAction"]
    | "none";
  latestDispositionResult:
    | SandboxCloseoutCompletionDecisionAuditEntry["dispositionSnapshot"]["dispositionResult"]
    | "none";
  repeatedConfirmReviewCompletePatterns: string[];
  repeatedConfirmCloseoutCompletePatterns: string[];
  repeatedKeepCarryForwardPatterns: string[];
  repeatedReopenCompletionPatterns: string[];
  repeatedQueueRetainedPatterns: string[];
  repeatedFinalizedToReopenedPatterns: string[];
  retainedEntryCount: number;
  summaryLine: string;
};

export async function buildSandboxCloseoutCompletionDecisionHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const trail = await listSandboxCloseoutCompletionDecisionAudit({
    configPath: params.configPath,
    limit,
  });
  const latestEntry = trail.records[0] ?? null;
  const previousEntry = trail.records[1] ?? null;
  const repeatedConfirmReviewCompletePatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.latestCompletionAction === "confirm_review_complete")
      .map((entry) => entry.summaryLine),
  );
  const repeatedConfirmCloseoutCompletePatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.latestCompletionAction === "confirm_closeout_complete")
      .map((entry) => entry.summaryLine),
  );
  const repeatedKeepCarryForwardPatterns = Array.from(
    new Set(
      [
        ...collectRepeated(
          trail.records
            .filter((entry) => entry.latestCompletionAction === "keep_carry_forward")
            .flatMap((entry) =>
              entry.queueRetainedReasons.length > 0
                ? entry.queueRetainedReasons
                : [entry.summaryLine],
            ),
        ),
        ...collectTransitionPatterns(
          trail.records.filter((entry) => entry.latestCompletionAction === "keep_carry_forward"),
        ),
      ],
    ),
  );
  const repeatedReopenCompletionPatterns = Array.from(
    new Set(
      [
        ...collectRepeated(
          trail.records
            .filter((entry) => entry.latestCompletionAction === "reopen_completion")
            .map((entry) => entry.summaryLine),
        ),
        ...collectTransitionPatterns(
          trail.records.filter(
            (entry) =>
              entry.latestCompletionAction === "reopen_completion" || entry.completionReopened,
          ),
        ).filter((pattern) => pattern.includes("reopen_completion")),
      ],
    ),
  );
  const repeatedQueueRetainedPatterns = collectRepeated(
    trail.records
      .filter((entry) => entry.completionRetained || !entry.lifecycleSnapshot.carryForwardQueueExitAllowed)
      .flatMap((entry) =>
        entry.queueRetainedReasons.length > 0 ? entry.queueRetainedReasons : [entry.summaryLine],
      ),
  );
  const repeatedFinalizedToReopenedPatterns = collectRepeated(
    [...trail.records]
      .reverse()
      .flatMap((entry, index, ordered) => {
        if (index === 0) {
          return [];
        }
        const previous = ordered[index - 1];
        if (previous.completionFinalized && entry.completionReopened) {
          return [
            `${previous.lifecycleSnapshot.lifecycleStatus} -> ${entry.lifecycleSnapshot.lifecycleStatus}`,
          ];
        }
        return [];
      }),
  );
  const summaryLine =
    latestEntry === null
      ? "No closeout completion decision history has been captured yet."
      : `Sandbox closeout completion decision history: latest=${latestEntry.latestCompletionAction}/${latestEntry.dispositionSnapshot.dispositionResult}, retained=${trail.records.length}, finalizedToReopened=${repeatedFinalizedToReopenedPatterns.join(", ") || "none"}.`;

  return {
    entries: trail.records,
    latestEntry,
    previousEntry,
    latestCompletionAction: latestEntry?.latestCompletionAction ?? "none",
    latestDispositionResult: latestEntry?.dispositionSnapshot.dispositionResult ?? "none",
    repeatedConfirmReviewCompletePatterns,
    repeatedConfirmCloseoutCompletePatterns,
    repeatedKeepCarryForwardPatterns,
    repeatedReopenCompletionPatterns,
    repeatedQueueRetainedPatterns,
    repeatedFinalizedToReopenedPatterns,
    retainedEntryCount: trail.records.length,
    summaryLine,
  } satisfies SandboxCloseoutCompletionDecisionHistory;
}

export function formatSandboxCloseoutCompletionDecisionHistory(
  result: SandboxCloseoutCompletionDecisionHistory,
) {
  return [
    "Sandbox closeout completion decision history",
    `Retained entries: ${result.retainedEntryCount}`,
    `Latest completion action: ${result.latestCompletionAction}`,
    `Latest disposition result: ${result.latestDispositionResult}`,
    `Latest audit: ${result.latestEntry?.auditedAt ?? "none"} ${result.latestEntry?.summaryLine ?? ""}`.trimEnd(),
    `Previous audit: ${result.previousEntry?.auditedAt ?? "none"} ${result.previousEntry?.summaryLine ?? ""}`.trimEnd(),
    `Repeated confirm-review patterns: ${result.repeatedConfirmReviewCompletePatterns.join(" | ") || "none"}`,
    `Repeated confirm-closeout patterns: ${result.repeatedConfirmCloseoutCompletePatterns.join(" | ") || "none"}`,
    `Repeated keep-carry-forward patterns: ${result.repeatedKeepCarryForwardPatterns.join(" | ") || "none"}`,
    `Repeated reopen-completion patterns: ${result.repeatedReopenCompletionPatterns.join(" | ") || "none"}`,
    `Repeated queue-retained patterns: ${result.repeatedQueueRetainedPatterns.join(" | ") || "none"}`,
    `Repeated finalized-to-reopened patterns: ${result.repeatedFinalizedToReopenedPatterns.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
  ].join("\n");
}
