import type { OrchestratorState, PreflightResult } from "../schemas";

export type OrchestratorDiagnostics = {
  stateId: string;
  status: OrchestratorState["status"];
  iterationNumber: number;
  profileId: string;
  sourceEventType: OrchestratorState["sourceEventType"];
  sourceEventId: string | null;
  webhookEventType: OrchestratorState["webhookEventType"];
  webhookDeliveryId: string | null;
  webhookSignatureStatus: OrchestratorState["webhookSignatureStatus"];
  idempotencyKey: string | null;
  idempotencyStatus: OrchestratorState["idempotencyStatus"];
  triggerPolicyId: string | null;
  parsedCommand: string | null;
  commandRoutingStatus: OrchestratorState["commandRoutingStatus"];
  commandRoutingSummary: string | null;
  lastIterationSummary: string;
  plannerSummary: string;
  reviewerSummary: string;
  blockers: string[];
  missingPrerequisites: string[];
  blockedReasons: Array<{
    code: string;
    summary: string;
    suggestedNextAction: string;
  }>;
  artifactSummary: {
    backendType: string;
    backendHealthStatus: string;
    queueStatus: string;
    transferStatus: string;
    repairStatus: string;
    patchStatus: string;
    promotionStatus: string;
    handoffStatus: string;
    prDraftStatus: string;
    liveAcceptanceStatus: string;
    livePassStatus: string;
    workspaceStatus: string;
  };
  workerSummary: {
    workerStatus: string;
    supervisionStatus: string;
    workerId: string | null;
    leaseOwner: string | null;
    lastHeartbeatAt: string | null;
    lastLeaseRenewalAt: string | null;
    daemonHeartbeatAt: string | null;
    cancellationStatus: string;
    pauseStatus: string;
    retryCount: number;
  };
  recoverySummary: {
    action: string | null;
    reason: string | null;
  };
  statusReporting: {
    status: OrchestratorState["statusReportStatus"];
    summary: string | null;
    correlationId: string | null;
    target: string | null;
  };
  nextSuggestedAction: string;
};

function resolveNextSuggestedAction(state: OrchestratorState, preflight: PreflightResult | null) {
  if (preflight?.blockedReasons.length) {
    return preflight.blockedReasons[0]?.suggestedNextAction ?? "Resolve the first blocked prerequisite.";
  }
  if (state.queueStatus === "queued") {
    return "Run a worker or worker:once to process the queued task.";
  }
  if (state.queueStatus === "running") {
    return "Inspect worker heartbeat and wait for the current lease to complete.";
  }
  if (state.pendingHumanApproval && state.patchStatus === "waiting_approval") {
    return "Approve or reject the pending patch before promotion or handoff.";
  }
  if (state.pendingHumanApproval) {
    return "Approve or reject the pending plan before executing the next iteration.";
  }
  if (state.status === "needs_revision") {
    return "Run the next iteration after addressing the latest reviewer feedback.";
  }
  if (state.status === "blocked") {
    return state.stopReason ?? "Review the latest blocked reason before continuing.";
  }
  if (state.handoffStatus === "handoff_ready" && state.prDraftStatus !== "payload_ready") {
    return "Review the handoff package and decide whether GitHub handoff should be enabled.";
  }
  if (state.prDraftStatus === "payload_ready") {
    return "Review the PR draft payload or run GitHub handoff with the required token.";
  }
  if (state.lastExecutionReport?.recommendedNextStep) {
    return state.lastExecutionReport.recommendedNextStep;
  }
  return "Inspect the latest iteration and choose the next orchestrator action.";
}

export function buildDiagnosticsSummary(state: OrchestratorState, preflight: PreflightResult | null = state.lastPreflightResult) {
  const latestIteration = state.iterationHistory[state.iterationHistory.length - 1] ?? null;
  const blockers = [
    ...(state.lastExecutionReport?.blockers ?? []),
    ...(state.stopReason ? [state.stopReason] : []),
  ];
  const blockedReasons = (preflight?.blockedReasons ?? state.lastBlockedReasons).map((reason) => ({
    code: reason.code,
    summary: reason.summary,
    suggestedNextAction: reason.suggestedNextAction,
  }));
  const missingPrerequisites = preflight?.blockedReasons.flatMap((reason) => reason.missingPrerequisites) ?? [];

  return {
    stateId: state.id,
    status: state.status,
    iterationNumber: state.iterationNumber,
    profileId: state.task.profileId,
    sourceEventType: state.sourceEventType,
    sourceEventId: state.sourceEventId,
    webhookEventType: state.webhookEventType,
    webhookDeliveryId: state.webhookDeliveryId,
    webhookSignatureStatus: state.webhookSignatureStatus,
    idempotencyKey: state.idempotencyKey,
    idempotencyStatus: state.idempotencyStatus,
    triggerPolicyId: state.triggerPolicyId,
    parsedCommand: state.parsedCommand?.rawCommand ?? null,
    commandRoutingStatus: state.commandRoutingStatus,
    commandRoutingSummary: state.commandRoutingDecision?.summary ?? null,
    lastIterationSummary:
      latestIteration?.executionReport?.summaryOfChanges.join(" | ") ??
      state.lastExecutionReport?.summaryOfChanges.join(" | ") ??
      "No execution report recorded yet.",
    plannerSummary:
      state.plannerDecision ? [state.plannerDecision.objective, ...state.plannerDecision.subtasks].join(" | ") : state.task.objective,
    reviewerSummary: state.lastReviewVerdict
      ? [state.lastReviewVerdict.verdict, ...state.lastReviewVerdict.reasons].join(" | ")
      : "Reviewer verdict unavailable.",
    blockers,
    missingPrerequisites,
    blockedReasons,
    artifactSummary: {
      backendType: state.backendType,
      backendHealthStatus: state.backendHealthStatus,
      queueStatus: state.queueStatus,
      transferStatus: state.transferStatus,
      repairStatus: state.repairStatus,
      patchStatus: state.patchStatus,
      promotionStatus: state.promotionStatus,
      handoffStatus: state.handoffStatus,
      prDraftStatus: state.prDraftStatus,
      liveAcceptanceStatus: state.liveAcceptanceStatus,
      livePassStatus: state.livePassStatus,
      workspaceStatus: state.workspaceStatus,
    },
    workerSummary: {
      workerStatus: state.workerStatus,
      supervisionStatus: state.supervisionStatus,
      workerId: state.workerId,
      leaseOwner: state.leaseOwner,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastLeaseRenewalAt: state.lastLeaseRenewalAt,
      daemonHeartbeatAt: state.daemonHeartbeatAt,
      cancellationStatus: state.cancellationStatus,
      pauseStatus: state.pauseStatus,
      retryCount: state.retryCount,
    },
    recoverySummary: {
      action: state.lastRecoveryDecision?.action ?? null,
      reason: state.lastRecoveryDecision?.reason ?? null,
    },
    statusReporting: {
      status: state.statusReportStatus,
      summary: state.lastStatusReportSummary?.summary ?? null,
      correlationId: state.statusReportCorrelationId,
      target: state.lastStatusReportTarget?.targetUrl ?? state.lastStatusReportTarget?.correlationId ?? null,
    },
    nextSuggestedAction: resolveNextSuggestedAction(state, preflight),
  } satisfies OrchestratorDiagnostics;
}

export function formatDiagnosticsSummary(summary: OrchestratorDiagnostics) {
  const lines = [
    `State: ${summary.stateId}`,
    `Status: ${summary.status} (iteration ${summary.iterationNumber}, profile ${summary.profileId})`,
    `Source: type=${summary.sourceEventType}, eventId=${summary.sourceEventId ?? "none"}, webhook=${summary.webhookEventType}/${summary.webhookDeliveryId ?? "none"}/${summary.webhookSignatureStatus}, idempotency=${summary.idempotencyKey ?? "none"} (${summary.idempotencyStatus}), triggerPolicy=${summary.triggerPolicyId ?? "none"}`,
    `Command: raw=${summary.parsedCommand ?? "none"}, routing=${summary.commandRoutingStatus}, summary=${summary.commandRoutingSummary ?? "none"}`,
    `Planner: ${summary.plannerSummary}`,
    `Reviewer: ${summary.reviewerSummary}`,
    `Last iteration: ${summary.lastIterationSummary}`,
    `Artifacts: backend=${summary.artifactSummary.backendType}, backendHealth=${summary.artifactSummary.backendHealthStatus}, queue=${summary.artifactSummary.queueStatus}, transfer=${summary.artifactSummary.transferStatus}, repair=${summary.artifactSummary.repairStatus}, patch=${summary.artifactSummary.patchStatus}, promotion=${summary.artifactSummary.promotionStatus}, handoff=${summary.artifactSummary.handoffStatus}, prDraft=${summary.artifactSummary.prDraftStatus}, liveAcceptance=${summary.artifactSummary.liveAcceptanceStatus}, livePass=${summary.artifactSummary.livePassStatus}, workspace=${summary.artifactSummary.workspaceStatus}`,
    `Worker: status=${summary.workerSummary.workerStatus}, supervision=${summary.workerSummary.supervisionStatus}, workerId=${summary.workerSummary.workerId ?? "none"}, leaseOwner=${summary.workerSummary.leaseOwner ?? "none"}, lastHeartbeat=${summary.workerSummary.lastHeartbeatAt ?? "none"}, lastLeaseRenewal=${summary.workerSummary.lastLeaseRenewalAt ?? "none"}, daemonHeartbeat=${summary.workerSummary.daemonHeartbeatAt ?? "none"}, cancel=${summary.workerSummary.cancellationStatus}, pause=${summary.workerSummary.pauseStatus}, retries=${summary.workerSummary.retryCount}`,
    `Recovery: action=${summary.recoverySummary.action ?? "none"}, reason=${summary.recoverySummary.reason ?? "none"}`,
    `Status reporting: status=${summary.statusReporting.status}, correlation=${summary.statusReporting.correlationId ?? "none"}, target=${summary.statusReporting.target ?? "none"}, summary=${summary.statusReporting.summary ?? "none"}`,
    `Blockers: ${summary.blockers.join(" | ") || "none"}`,
    `Missing prerequisites: ${summary.missingPrerequisites.join(", ") || "none"}`,
  ];
  if (summary.blockedReasons.length > 0) {
    lines.push("Blocked reasons:");
    for (const reason of summary.blockedReasons) {
      lines.push(`- ${reason.code}: ${reason.summary} -> ${reason.suggestedNextAction}`);
    }
  }
  lines.push(`Next action: ${summary.nextSuggestedAction}`);
  return lines.join("\n");
}
