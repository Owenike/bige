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

export type SandboxCloseoutStabilityDrift = {
  latestFinalizationStatus:
    | SandboxCloseoutFinalizationAuditHistory["latestFinalizationStatus"]
    | "none";
  latestStabilityStatus:
    | SandboxCloseoutFinalizationStabilitySummary["stabilityStatus"]
    | "none";
  latestPostFinalizationFollowupStatus:
    | SandboxCloseoutPostFinalizationFollowupQueue["queueStatus"]
    | "none";
  driftDetected: boolean;
  driftRiskDetected: boolean;
  driftSource:
    | "none"
    | "reopen"
    | "followup_reopening"
    | "queue_retained_again"
    | "degraded_from_stable_final_complete";
  driftReasons: string[];
  driftSeverity: "none" | "low" | "medium" | "high";
  driftCameFromReopen: boolean;
  driftCameFromFollowUpReopening: boolean;
  driftCameFromQueueRetentionAgain: boolean;
  caseRemainsStableFinalComplete: boolean;
  caseDegradedToNonStable: boolean;
  recommendedNextOperatorStep: string;
  summaryLine: string;
};

export async function buildSandboxCloseoutStabilityDrift(params: {
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

  const reachedFinalizationOnce = closeoutFinalizationAuditHistory.entries.some(
    (entry) =>
      entry.finalizationStatus === "final_complete" ||
      entry.finalizationStatus === "finalized_but_reopenable",
  );
  const reachedStableFinalCompleteOnce = closeoutFinalizationAuditHistory.entries.some(
    (entry) => entry.finalizationStatus === "final_complete",
  );
  const driftCameFromReopen =
    closeoutFinalizationStabilitySummary.completionThreadReopenedAfterFinalization ||
    closeoutFinalizationAuditHistory.latestEntry?.reopenedAfterFinalization === true;
  const driftCameFromFollowUpReopening =
    closeoutFinalizationStabilitySummary.postFinalizationFollowUpRemainsOpen ||
    closeoutPostFinalizationFollowupQueue.postFinalizationFollowUpOpen ||
    closeoutFinalizationAuditHistory.latestEntry?.postFinalizationFollowUpOpen === true;
  const driftCameFromQueueRetentionAgain =
    closeoutFinalizationStabilitySummary.queueRemainsRetained ||
    closeoutPostFinalizationFollowupQueue.carryForwardRetained ||
    closeoutFinalizationAuditHistory.latestEntry?.retainedAfterFinalization === true;
  const caseRemainsStableFinalComplete =
    closeoutFinalizationStabilitySummary.completionThreadStableFinalComplete;
  const caseDegradedToNonStable =
    reachedStableFinalCompleteOnce && !caseRemainsStableFinalComplete;

  let driftSource: SandboxCloseoutStabilityDrift["driftSource"] = "none";
  if (driftCameFromReopen) {
    driftSource = "reopen";
  } else if (driftCameFromFollowUpReopening) {
    driftSource = "followup_reopening";
  } else if (driftCameFromQueueRetentionAgain) {
    driftSource = "queue_retained_again";
  } else if (caseDegradedToNonStable) {
    driftSource = "degraded_from_stable_final_complete";
  }

  const driftDetected =
    reachedFinalizationOnce &&
    (caseDegradedToNonStable ||
      driftCameFromReopen ||
      driftCameFromFollowUpReopening ||
      driftCameFromQueueRetentionAgain);
  const driftRiskDetected =
    driftDetected ||
    (reachedFinalizationOnce &&
      (closeoutFinalizationStabilitySummary.stabilityStatus ===
        "final_complete_but_reopenable" ||
        closeoutFinalizationAuditHistory.repeatedReopenedAfterFinalizationPatterns.length > 0 ||
        closeoutFinalizationAuditHistory.repeatedRetainedAfterFinalizationPatterns.length > 0 ||
        closeoutFinalizationAuditHistory.repeatedPostFinalizationFollowUpOpenPatterns.length >
          0));

  let driftSeverity: SandboxCloseoutStabilityDrift["driftSeverity"] = "none";
  if (driftCameFromReopen || closeoutFinalizationAuditHistory.repeatedReopenedAfterFinalizationPatterns.length > 0) {
    driftSeverity = "high";
  } else if (
    driftCameFromFollowUpReopening ||
    driftCameFromQueueRetentionAgain ||
    closeoutFinalizationAuditHistory.repeatedPostFinalizationFollowUpOpenPatterns.length > 0 ||
    closeoutFinalizationAuditHistory.repeatedRetainedAfterFinalizationPatterns.length > 0
  ) {
    driftSeverity = "medium";
  } else if (driftRiskDetected) {
    driftSeverity = "low";
  }

  const driftReasons = Array.from(
    new Set(
      [
        ...closeoutFinalizationStabilitySummary.unresolvedStabilityReasons,
        ...closeoutPostFinalizationFollowupQueue.blockedReasonsSummary,
        ...closeoutPostFinalizationFollowupQueue.missingEvidenceSummary,
        ...closeoutFinalizationAuditHistory.repeatedReopenedAfterFinalizationPatterns,
        ...closeoutFinalizationAuditHistory.repeatedRetainedAfterFinalizationPatterns,
        ...closeoutFinalizationAuditHistory.repeatedPostFinalizationFollowUpOpenPatterns,
        ...(caseDegradedToNonStable ? ["degraded_from_stable_final_complete"] : []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const recommendedNextOperatorStep = driftRiskDetected
    ? closeoutFinalizationStabilitySummary.recommendedNextOperatorStep
    : "stability_stable";
  const summaryLine = !driftRiskDetected
    ? "Sandbox closeout stability drift: no drift detected."
    : `Sandbox closeout stability drift: ${driftSource}; severity=${driftSeverity}; next=${recommendedNextOperatorStep}.`;

  return {
    latestFinalizationStatus: closeoutFinalizationAuditHistory.latestFinalizationStatus,
    latestStabilityStatus: closeoutFinalizationStabilitySummary.stabilityStatus,
    latestPostFinalizationFollowupStatus:
      closeoutPostFinalizationFollowupQueue.queueStatus,
    driftDetected,
    driftRiskDetected,
    driftSource,
    driftReasons,
    driftSeverity,
    driftCameFromReopen,
    driftCameFromFollowUpReopening,
    driftCameFromQueueRetentionAgain,
    caseRemainsStableFinalComplete,
    caseDegradedToNonStable,
    recommendedNextOperatorStep,
    summaryLine,
  } satisfies SandboxCloseoutStabilityDrift;
}

export function formatSandboxCloseoutStabilityDrift(
  result: SandboxCloseoutStabilityDrift,
) {
  return [
    "Sandbox closeout stability drift",
    `Latest finalization status: ${result.latestFinalizationStatus}`,
    `Latest stability status: ${result.latestStabilityStatus}`,
    `Latest post-finalization follow-up status: ${result.latestPostFinalizationFollowupStatus}`,
    `Drift detected: ${result.driftDetected}`,
    `Drift risk detected: ${result.driftRiskDetected}`,
    `Drift source: ${result.driftSource}`,
    `Drift severity: ${result.driftSeverity}`,
    `Drift from reopen: ${result.driftCameFromReopen}`,
    `Drift from follow-up reopening: ${result.driftCameFromFollowUpReopening}`,
    `Drift from queue retained again: ${result.driftCameFromQueueRetentionAgain}`,
    `Remains stable-final-complete: ${result.caseRemainsStableFinalComplete}`,
    `Degraded to non-stable: ${result.caseDegradedToNonStable}`,
    `Drift reasons: ${result.driftReasons.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
    `Next action: ${result.recommendedNextOperatorStep}`,
  ].join("\n");
}
