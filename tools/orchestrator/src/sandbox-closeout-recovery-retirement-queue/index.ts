import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutRecoveredLifecycleHistory,
  type SandboxCloseoutRecoveredLifecycleHistory,
} from "../sandbox-closeout-recovered-lifecycle-history";
import {
  buildSandboxCloseoutRecoveredRetirementSummary,
  type SandboxCloseoutRecoveredRetirementSummary,
} from "../sandbox-closeout-recovered-retirement-summary";
import {
  buildSandboxCloseoutRecoveryClearanceHistory,
  type SandboxCloseoutRecoveryClearanceHistory,
} from "../sandbox-closeout-recovery-clearance-history";
import {
  buildSandboxCloseoutRecoveryRetirementAudit,
  type SandboxCloseoutRecoveryRetirementAudit,
} from "../sandbox-closeout-recovery-retirement-audit";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export type SandboxCloseoutRecoveryRetirementQueueEntry = {
  queuedAt: string | null;
  queueStatus:
    | "retirement_backlog"
    | "retirement_provisional"
    | "regression_risk"
    | "reentry_risk"
    | "monitoring_required";
  recovered: boolean;
  retirementReady: boolean;
  regressionRiskFlag: boolean;
  reentryRiskFlag: boolean;
  monitoringRequiredFlag: boolean;
  retirementBlockedReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export type SandboxCloseoutRecoveryRetirementQueue = {
  entries: SandboxCloseoutRecoveryRetirementQueueEntry[];
  latestQueueEntry: SandboxCloseoutRecoveryRetirementQueueEntry | null;
  queueStatus:
    | "empty"
    | SandboxCloseoutRecoveryRetirementQueueEntry["queueStatus"];
  recovered: boolean;
  retirementReady: boolean;
  regressionRiskFlag: boolean;
  reentryRiskFlag: boolean;
  monitoringRequiredFlag: boolean;
  retirementBlockedReasons: string[];
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutRecoveryRetirementQueue(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
  closeoutRecoveryRetirementAudit?: SandboxCloseoutRecoveryRetirementAudit;
  closeoutRecoveredRetirementSummary?: SandboxCloseoutRecoveredRetirementSummary;
  closeoutRecoveryClearanceHistory?: SandboxCloseoutRecoveryClearanceHistory;
  closeoutRecoveredLifecycleHistory?: SandboxCloseoutRecoveredLifecycleHistory;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const closeoutRecoveryRetirementAudit =
    params.closeoutRecoveryRetirementAudit ??
    (await buildSandboxCloseoutRecoveryRetirementAudit({
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
  const closeoutRecoveredLifecycleHistory =
    params.closeoutRecoveredLifecycleHistory ??
    (await buildSandboxCloseoutRecoveredLifecycleHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryClearanceHistory,
    }));
  const closeoutRecoveredRetirementSummary =
    params.closeoutRecoveredRetirementSummary ??
    (await buildSandboxCloseoutRecoveredRetirementSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutRecoveryRetirementAudit,
      closeoutRecoveryClearanceHistory,
      closeoutRecoveredLifecycleHistory,
    }));

  const recovered =
    closeoutRecoveredRetirementSummary.latestRecoveryStatus !==
    "recovery_blocked";
  const retirementReady =
    closeoutRecoveredRetirementSummary.retirementReady;
  const regressionRiskFlag =
    closeoutRecoveryRetirementAudit.caseRemainsRegressionProne ||
    closeoutRecoveredLifecycleHistory.repeatedRegressedPatterns.length > 0;
  const reentryRiskFlag =
    closeoutRecoveryClearanceHistory.repeatedClearanceThenReEnterPatterns.length >
      0 ||
    closeoutRecoveredLifecycleHistory.repeatedReEnteredPatterns.length > 0;
  const monitoringRequiredFlag =
    closeoutRecoveryRetirementAudit.caseRemainsMonitored ||
    closeoutRecoveryRetirementAudit.latestMonitoringExitStatus !==
      "monitoring_exit_allowed";

  let queueStatus: SandboxCloseoutRecoveryRetirementQueue["queueStatus"] =
    "empty";
  if (recovered && !retirementReady) {
    if (closeoutRecoveredRetirementSummary.retirementProvisional) {
      queueStatus = "retirement_provisional";
    } else if (regressionRiskFlag) {
      queueStatus = "regression_risk";
    } else if (reentryRiskFlag) {
      queueStatus = "reentry_risk";
    } else if (monitoringRequiredFlag) {
      queueStatus = "monitoring_required";
    } else {
      queueStatus = "retirement_backlog";
    }
  }

  const retirementBlockedReasons = unique([
    ...closeoutRecoveryRetirementAudit.retirementBlockedReasons,
    ...closeoutRecoveredRetirementSummary.retirementWarnings,
    ...closeoutRecoveryClearanceHistory.historyReasons,
    ...closeoutRecoveredLifecycleHistory.historyReasons,
  ]);
  const recommendedNextOperatorStep =
    queueStatus === "empty"
      ? "recovery_retirement_queue_clear"
      : closeoutRecoveredRetirementSummary.recommendedNextOperatorStep ||
        closeoutRecoveryRetirementAudit.recommendedNextOperatorStep;
  const latestQueueEntry =
    queueStatus === "empty"
      ? null
      : ({
          queuedAt: closeoutRecoveryRetirementAudit.auditedAt,
          queueStatus,
          recovered,
          retirementReady,
          regressionRiskFlag,
          reentryRiskFlag,
          monitoringRequiredFlag,
          retirementBlockedReasons,
          recommendedNextOperatorStep,
          summaryLine: `Recovery retirement queue: ${queueStatus}; next=${recommendedNextOperatorStep}.`,
        } satisfies SandboxCloseoutRecoveryRetirementQueueEntry);
  const entries =
    latestQueueEntry === null ? [] : [latestQueueEntry].slice(0, limit);
  const summaryLine =
    latestQueueEntry === null
      ? "Sandbox closeout recovery retirement queue: no recovered governance backlog remains active."
      : latestQueueEntry.summaryLine;

  return {
    entries,
    latestQueueEntry,
    queueStatus,
    recovered,
    retirementReady,
    regressionRiskFlag,
    reentryRiskFlag,
    monitoringRequiredFlag,
    retirementBlockedReasons,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutRecoveryRetirementQueue;
}

export function formatSandboxCloseoutRecoveryRetirementQueue(
  result: SandboxCloseoutRecoveryRetirementQueue,
) {
  return [
    "Sandbox closeout recovery retirement queue",
    `Queue status: ${result.queueStatus}`,
    `Recovered: ${result.recovered}`,
    `Retirement ready: ${result.retirementReady}`,
    `Regression risk flag: ${result.regressionRiskFlag}`,
    `Re-entry risk flag: ${result.reentryRiskFlag}`,
    `Monitoring required flag: ${result.monitoringRequiredFlag}`,
    `Retirement blocked reasons: ${result.retirementBlockedReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
