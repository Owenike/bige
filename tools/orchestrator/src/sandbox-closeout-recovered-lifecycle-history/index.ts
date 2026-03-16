import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredLifecycle,
  type SandboxCloseoutRecoveredLifecycle,
} from "../sandbox-closeout-recovered-lifecycle";
import {
  buildSandboxCloseoutRecoveredMonitoringExitAudit,
  type SandboxCloseoutRecoveredMonitoringExitAudit,
} from "../sandbox-closeout-recovered-monitoring-exit-audit";
import {
  buildSandboxCloseoutRecoveredReentryAudit,
  type SandboxCloseoutRecoveredReentryAudit,
} from "../sandbox-closeout-recovered-reentry-audit";
import {
  buildSandboxCloseoutRecoveryClearanceHistory,
  type SandboxCloseoutRecoveryClearanceHistory,
} from "../sandbox-closeout-recovery-clearance-history";
import {
  buildSandboxCloseoutRecoveryRegressionAudit,
  type SandboxCloseoutRecoveryRegressionAudit,
} from "../sandbox-closeout-recovery-regression-audit";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveredLifecycleHistoryEntry = {
  recordedAt: string | null;
  lifecycleStatus: SandboxCloseoutRecoveredLifecycle["lifecycleStatus"];
  caseMonitored: boolean;
  caseCleared: boolean;
  caseHasReEnteredGovernance: boolean;
  caseHasRegressed: boolean;
  caseRemainsReopenable: boolean;
  summaryLine: string;
};

export type SandboxCloseoutRecoveredLifecycleHistory = {
  entries: SandboxCloseoutRecoveredLifecycleHistoryEntry[];
  latestLifecycleEntry: SandboxCloseoutRecoveredLifecycleHistoryEntry | null;
  previousLifecycleEntry: SandboxCloseoutRecoveredLifecycleHistoryEntry | null;
  latestLifecycleStatus: SandboxCloseoutRecoveredLifecycle["lifecycleStatus"];
  repeatedMonitoredPatterns: string[];
  repeatedClearedPatterns: string[];
  repeatedReEnteredPatterns: string[];
  repeatedRegressedPatterns: string[];
  repeatedRecoveredButReopenablePatterns: string[];
  lifecycleTransitionSummary: string[];
  historyRetainedEntryCount: number;
  historyReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

function appendLifecycleEntry(
  entries: SandboxCloseoutRecoveredLifecycleHistoryEntry[],
  nextEntry: SandboxCloseoutRecoveredLifecycleHistoryEntry,
  limit: number,
) {
  const lastEntry = entries[entries.length - 1] ?? null;
  if (
    lastEntry &&
    lastEntry.lifecycleStatus === nextEntry.lifecycleStatus &&
    lastEntry.caseMonitored === nextEntry.caseMonitored &&
    lastEntry.caseCleared === nextEntry.caseCleared &&
    lastEntry.caseHasReEnteredGovernance ===
      nextEntry.caseHasReEnteredGovernance &&
    lastEntry.caseHasRegressed === nextEntry.caseHasRegressed &&
    lastEntry.caseRemainsReopenable === nextEntry.caseRemainsReopenable
  ) {
    return entries.slice(-limit);
  }

  return [...entries, nextEntry].slice(-limit);
}

export async function buildSandboxCloseoutRecoveredLifecycleHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveredLifecycle?: SandboxCloseoutRecoveredLifecycle;
  closeoutRecoveryClearanceHistory?: SandboxCloseoutRecoveryClearanceHistory;
  closeoutRecoveredReentryAudit?: SandboxCloseoutRecoveredReentryAudit;
  closeoutRecoveryRegressionAudit?: SandboxCloseoutRecoveryRegressionAudit;
  closeoutRecoveredMonitoringExitAudit?: SandboxCloseoutRecoveredMonitoringExitAudit;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const persistedHistoryState = params.state as OrchestratorState & {
    lastCloseoutRecoveredLifecycleHistory?: {
      entries?: SandboxCloseoutRecoveredLifecycleHistoryEntry[];
    } | null;
  };
  const closeoutRecoveryRegressionAudit =
    params.closeoutRecoveryRegressionAudit ??
    (await buildSandboxCloseoutRecoveryRegressionAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutRecoveredMonitoringExitAudit =
    params.closeoutRecoveredMonitoringExitAudit ??
    (await buildSandboxCloseoutRecoveredMonitoringExitAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutRecoveryClearanceHistory =
    params.closeoutRecoveryClearanceHistory ??
    (await buildSandboxCloseoutRecoveryClearanceHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutRecoveredLifecycle =
    params.closeoutRecoveredLifecycle ??
    (await buildSandboxCloseoutRecoveredLifecycle({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    }));
  const closeoutRecoveredReentryAudit =
    params.closeoutRecoveredReentryAudit ??
    (await buildSandboxCloseoutRecoveredReentryAudit({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredLifecycle,
    }));

  const previousEntries =
    persistedHistoryState.lastCloseoutRecoveredLifecycleHistory?.entries ?? [];
  const currentEntry = {
    recordedAt:
      closeoutRecoveryClearanceHistory.latestClearanceAuditEntry?.recordedAt ??
      null,
    lifecycleStatus: closeoutRecoveredLifecycle.lifecycleStatus,
    caseMonitored: closeoutRecoveredLifecycle.caseMonitored,
    caseCleared: closeoutRecoveredLifecycle.caseCleared,
    caseHasReEnteredGovernance:
      closeoutRecoveredLifecycle.caseHasReEnteredGovernance,
    caseHasRegressed: closeoutRecoveredLifecycle.caseHasRegressed,
    caseRemainsReopenable: closeoutRecoveredLifecycle.caseRemainsReopenable,
    summaryLine: closeoutRecoveredLifecycle.summaryLine,
  } satisfies SandboxCloseoutRecoveredLifecycleHistoryEntry;

  const entries = appendLifecycleEntry(previousEntries, currentEntry, limit);
  const latestLifecycleEntry =
    entries.length > 0 ? entries[entries.length - 1] : null;
  const previousLifecycleEntry =
    entries.length > 1 ? entries[entries.length - 2] : null;
  const repeatedMonitoredPatterns = unique(
    entries
      .filter((entry) => entry.lifecycleStatus === "recovered_monitored")
      .map((entry) => entry.lifecycleStatus),
  );
  const repeatedClearedPatterns = unique(
    entries
      .filter((entry) => entry.lifecycleStatus === "recovered_cleared")
      .map((entry) => entry.lifecycleStatus),
  );
  const repeatedReEnteredPatterns = unique(
    entries
      .filter((entry) => entry.lifecycleStatus === "recovered_reentered")
      .map((entry) => entry.lifecycleStatus),
  );
  const repeatedRegressedPatterns = unique(
    entries
      .filter((entry) => entry.lifecycleStatus === "recovered_regressed")
      .map((entry) => entry.lifecycleStatus),
  );
  const repeatedRecoveredButReopenablePatterns = unique(
    entries
      .filter((entry) => entry.lifecycleStatus === "recovered_but_reopenable")
      .map((entry) => entry.lifecycleStatus),
  );
  const lifecycleTransitionSummary = unique(
    entries.slice(1).map((entry, index) => {
      const previousEntry = entries[index];
      return `${previousEntry.lifecycleStatus}->${entry.lifecycleStatus}`;
    }),
  );
  const historyReasons = unique([
    ...closeoutRecoveryClearanceHistory.historyReasons,
    ...closeoutRecoveredReentryAudit.reentryReasons,
    ...closeoutRecoveryRegressionAudit.regressionReasons,
    ...closeoutRecoveredMonitoringExitAudit.monitoringExitBlockedReasons,
  ]);
  const recommendedNextOperatorStep =
    closeoutRecoveredLifecycle.recommendedNextOperatorStep ||
    closeoutRecoveredReentryAudit.recommendedNextOperatorStep ||
    closeoutRecoveryClearanceHistory.recommendedNextOperatorStep;
  const summaryLine =
    lifecycleTransitionSummary.length > 0
      ? `Sandbox closeout recovered lifecycle history: latest=${closeoutRecoveredLifecycle.lifecycleStatus}, transitions=${lifecycleTransitionSummary.join(" | ")}; next=${recommendedNextOperatorStep}.`
      : `Sandbox closeout recovered lifecycle history: latest=${closeoutRecoveredLifecycle.lifecycleStatus}; next=${recommendedNextOperatorStep}.`;

  return {
    entries,
    latestLifecycleEntry,
    previousLifecycleEntry,
    latestLifecycleStatus: closeoutRecoveredLifecycle.lifecycleStatus,
    repeatedMonitoredPatterns,
    repeatedClearedPatterns,
    repeatedReEnteredPatterns,
    repeatedRegressedPatterns,
    repeatedRecoveredButReopenablePatterns,
    lifecycleTransitionSummary,
    historyRetainedEntryCount: entries.length,
    historyReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveredLifecycleHistory;
}

export function formatSandboxCloseoutRecoveredLifecycleHistory(
  result: SandboxCloseoutRecoveredLifecycleHistory,
) {
  return [
    "Sandbox closeout recovered lifecycle history",
    `Latest lifecycle status: ${result.latestLifecycleStatus}`,
    `Latest lifecycle entry: ${result.latestLifecycleEntry?.summaryLine ?? "none"}`,
    `Previous lifecycle entry: ${result.previousLifecycleEntry?.summaryLine ?? "none"}`,
    `Repeated monitored patterns: ${result.repeatedMonitoredPatterns.join(" | ") || "none"}`,
    `Repeated cleared patterns: ${result.repeatedClearedPatterns.join(" | ") || "none"}`,
    `Repeated re-entered patterns: ${result.repeatedReEnteredPatterns.join(" | ") || "none"}`,
    `Repeated regressed patterns: ${result.repeatedRegressedPatterns.join(" | ") || "none"}`,
    `Repeated recovered-but-reopenable patterns: ${result.repeatedRecoveredButReopenablePatterns.join(" | ") || "none"}`,
    `Lifecycle transitions: ${result.lifecycleTransitionSummary.join(" | ") || "none"}`,
    `History retained entry count: ${result.historyRetainedEntryCount}`,
    `History reasons: ${result.historyReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
