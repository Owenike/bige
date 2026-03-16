import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredExitHistory,
  type SandboxCloseoutRecoveredExitHistory,
} from "../sandbox-closeout-recovered-exit-history";
import {
  buildSandboxCloseoutRecoveredLifecycle,
  type SandboxCloseoutRecoveredLifecycle,
} from "../sandbox-closeout-recovered-lifecycle";
import {
  buildSandboxCloseoutRecoveryClearanceAudit,
  type SandboxCloseoutRecoveryClearanceAudit,
} from "../sandbox-closeout-recovery-clearance-audit";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveryClearanceHistoryEntry = {
  recordedAt: string | null;
  recoveryClearanceStatus: SandboxCloseoutRecoveryClearanceAudit["recoveryClearanceStatus"];
  recoveryClearanceAllowed: boolean;
  caseClearedFromGovernanceMonitoring: boolean;
  caseRemainsReopenable: boolean;
  caseRemainsRegressionProne: boolean;
  summaryLine: string;
};

export type SandboxCloseoutRecoveryClearanceHistory = {
  entries: SandboxCloseoutRecoveryClearanceHistoryEntry[];
  latestClearanceAuditEntry: SandboxCloseoutRecoveryClearanceHistoryEntry | null;
  previousClearanceAuditEntry: SandboxCloseoutRecoveryClearanceHistoryEntry | null;
  latestClearanceStatus: SandboxCloseoutRecoveryClearanceAudit["recoveryClearanceStatus"];
  repeatedClearanceAllowedPatterns: string[];
  repeatedClearanceBlockedPatterns: string[];
  repeatedClearanceAllowedButReopenablePatterns: string[];
  repeatedClearanceThenReEnterPatterns: string[];
  repeatedClearanceThenRegressedPatterns: string[];
  historyRetainedEntryCount: number;
  historyReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

function appendHistoryEntry(
  entries: SandboxCloseoutRecoveryClearanceHistoryEntry[],
  nextEntry: SandboxCloseoutRecoveryClearanceHistoryEntry,
  limit: number,
) {
  const lastEntry = entries[entries.length - 1] ?? null;
  if (
    lastEntry &&
    lastEntry.recoveryClearanceStatus === nextEntry.recoveryClearanceStatus &&
    lastEntry.caseClearedFromGovernanceMonitoring ===
      nextEntry.caseClearedFromGovernanceMonitoring &&
    lastEntry.caseRemainsReopenable === nextEntry.caseRemainsReopenable &&
    lastEntry.caseRemainsRegressionProne === nextEntry.caseRemainsRegressionProne
  ) {
    return entries.slice(-limit);
  }

  return [...entries, nextEntry].slice(-limit);
}

export async function buildSandboxCloseoutRecoveryClearanceHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryClearanceAudit?: SandboxCloseoutRecoveryClearanceAudit;
  closeoutRecoveredExitHistory?: SandboxCloseoutRecoveredExitHistory;
  closeoutRecoveredLifecycle?: SandboxCloseoutRecoveredLifecycle;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const persistedHistoryState = params.state as OrchestratorState & {
    lastCloseoutRecoveryClearanceHistory?: {
      entries?: SandboxCloseoutRecoveryClearanceHistoryEntry[];
    } | null;
  };
  const closeoutRecoveryClearanceAudit =
    params.closeoutRecoveryClearanceAudit ??
    (await buildSandboxCloseoutRecoveryClearanceAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutRecoveredExitHistory =
    params.closeoutRecoveredExitHistory ??
    (await buildSandboxCloseoutRecoveredExitHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceAudit,
    }));
  const closeoutRecoveredLifecycle =
    params.closeoutRecoveredLifecycle ??
    (await buildSandboxCloseoutRecoveredLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceAudit,
      closeoutRecoveredExitHistory,
    }));

  const previousEntries =
    persistedHistoryState.lastCloseoutRecoveryClearanceHistory?.entries ?? [];
  const currentEntry = {
    recordedAt: closeoutRecoveryClearanceAudit.auditedAt,
    recoveryClearanceStatus:
      closeoutRecoveryClearanceAudit.recoveryClearanceStatus,
    recoveryClearanceAllowed:
      closeoutRecoveryClearanceAudit.recoveryClearanceAllowed,
    caseClearedFromGovernanceMonitoring:
      closeoutRecoveryClearanceAudit.caseClearedFromGovernanceMonitoring,
    caseRemainsReopenable:
      closeoutRecoveryClearanceAudit.caseRemainsReopenable,
    caseRemainsRegressionProne:
      closeoutRecoveryClearanceAudit.caseRemainsRegressionProne,
    summaryLine: closeoutRecoveryClearanceAudit.summaryLine,
  } satisfies SandboxCloseoutRecoveryClearanceHistoryEntry;

  const entries = appendHistoryEntry(previousEntries, currentEntry, limit);
  const latestClearanceAuditEntry =
    entries.length > 0 ? entries[entries.length - 1] : null;
  const previousClearanceAuditEntry =
    entries.length > 1 ? entries[entries.length - 2] : null;
  const repeatedClearanceAllowedPatterns = unique(
    entries
      .filter((entry) => entry.recoveryClearanceStatus === "clearance_allowed")
      .map((entry) => entry.recoveryClearanceStatus),
  );
  const repeatedClearanceBlockedPatterns = unique(
    entries
      .filter((entry) => entry.recoveryClearanceStatus.startsWith("clearance_blocked"))
      .map((entry) => entry.recoveryClearanceStatus),
  );
  const repeatedClearanceAllowedButReopenablePatterns = unique(
    entries
      .filter(
        (entry) =>
          entry.recoveryClearanceStatus === "clearance_allowed_but_reopenable",
      )
      .map((entry) => entry.recoveryClearanceStatus),
  );
  const hadPreviousClearedEntry = entries
    .slice(0, -1)
    .some((entry) => entry.caseClearedFromGovernanceMonitoring);
  const repeatedClearanceThenReEnterPatterns = unique([
    ...(hadPreviousClearedEntry && closeoutRecoveredExitHistory.reEntryCount > 0
      ? [closeoutRecoveredExitHistory.latestReEntryEntry?.pattern ?? "cleared_then_reenter"]
      : []),
  ]);
  const repeatedClearanceThenRegressedPatterns = unique([
    ...(hadPreviousClearedEntry && closeoutRecoveredLifecycle.caseHasRegressed
      ? [closeoutRecoveredLifecycle.lifecycleStatus]
      : []),
  ]);
  const historyReasons = unique([
    ...closeoutRecoveryClearanceAudit.recoveryClearanceBlockedReasons,
    ...closeoutRecoveredExitHistory.historyReasons,
    ...closeoutRecoveredLifecycle.lifecycleReasons,
  ]);
  const recommendedNextOperatorStep =
    closeoutRecoveredLifecycle.recommendedNextOperatorStep ||
    closeoutRecoveryClearanceAudit.recommendedNextOperatorStep;
  const summaryLine =
    repeatedClearanceThenReEnterPatterns.length > 0 ||
    repeatedClearanceThenRegressedPatterns.length > 0
      ? `Sandbox closeout recovery clearance history: latest=${closeoutRecoveryClearanceAudit.recoveryClearanceStatus}, churn observed; next=${recommendedNextOperatorStep}.`
      : `Sandbox closeout recovery clearance history: latest=${closeoutRecoveryClearanceAudit.recoveryClearanceStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    entries,
    latestClearanceAuditEntry,
    previousClearanceAuditEntry,
    latestClearanceStatus: closeoutRecoveryClearanceAudit.recoveryClearanceStatus,
    repeatedClearanceAllowedPatterns,
    repeatedClearanceBlockedPatterns,
    repeatedClearanceAllowedButReopenablePatterns,
    repeatedClearanceThenReEnterPatterns,
    repeatedClearanceThenRegressedPatterns,
    historyRetainedEntryCount: entries.length,
    historyReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveryClearanceHistory;
}

export function formatSandboxCloseoutRecoveryClearanceHistory(
  result: SandboxCloseoutRecoveryClearanceHistory,
) {
  return [
    "Sandbox closeout recovery clearance history",
    `Latest clearance status: ${result.latestClearanceStatus}`,
    `Latest clearance audit entry: ${result.latestClearanceAuditEntry?.summaryLine ?? "none"}`,
    `Previous clearance audit entry: ${result.previousClearanceAuditEntry?.summaryLine ?? "none"}`,
    `Repeated clearance_allowed patterns: ${result.repeatedClearanceAllowedPatterns.join(" | ") || "none"}`,
    `Repeated clearance_blocked patterns: ${result.repeatedClearanceBlockedPatterns.join(" | ") || "none"}`,
    `Repeated clearance_allowed_but_reopenable patterns: ${result.repeatedClearanceAllowedButReopenablePatterns.join(" | ") || "none"}`,
    `Repeated clearance-then-reenter patterns: ${result.repeatedClearanceThenReEnterPatterns.join(" | ") || "none"}`,
    `Repeated clearance-then-regressed patterns: ${result.repeatedClearanceThenRegressedPatterns.join(" | ") || "none"}`,
    `History retained entry count: ${result.historyRetainedEntryCount}`,
    `History reasons: ${result.historyReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
