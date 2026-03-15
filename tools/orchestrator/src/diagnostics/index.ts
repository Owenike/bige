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
  inboundEventId: string | null;
  inboundDeliveryId: string | null;
  inboundCorrelationId: string | null;
  actorIdentity: string | null;
  actorAuthorizationStatus: OrchestratorState["actorAuthorizationStatus"];
  actorPolicyConfigVersion: string | null;
  replayProtectionStatus: OrchestratorState["replayProtectionStatus"];
  inboundAuditStatus: OrchestratorState["inboundAuditStatus"];
  runtimeHealthStatus: OrchestratorState["runtimeHealthStatus"];
  runtimeReadinessStatus: OrchestratorState["runtimeReadinessStatus"];
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
  sandboxGovernance: {
    lastGovernanceStatus: OrchestratorState["lastGovernanceStatus"];
    lastIncidentPolicy: OrchestratorState["lastIncidentPolicy"];
    lastOperatorHandoffSummary: OrchestratorState["lastOperatorHandoffSummary"];
    lastResolutionReadiness: OrchestratorState["lastResolutionReadiness"];
    lastResolutionEvidenceSummary: OrchestratorState["lastResolutionEvidenceSummary"];
    lastClosureGatingDecision: OrchestratorState["lastClosureGatingDecision"];
    lastResolutionAuditLog: OrchestratorState["lastResolutionAuditLog"];
    lastCloseoutSummary: OrchestratorState["lastCloseoutSummary"];
    lastCloseoutChecklist: OrchestratorState["lastCloseoutChecklist"];
    lastResolutionAuditHistory: OrchestratorState["lastResolutionAuditHistory"];
    lastCloseoutReviewSummary: OrchestratorState["lastCloseoutReviewSummary"];
    lastCloseoutReviewQueue: OrchestratorState["lastCloseoutReviewQueue"];
  };
  statusReporting: {
    status: OrchestratorState["statusReportStatus"];
    readiness: OrchestratorState["liveStatusReportReadiness"];
    liveStatus: OrchestratorState["liveStatusReportStatus"];
    permissionStatus: OrchestratorState["lastStatusReportPermissionStatus"];
    readinessStatus: OrchestratorState["lastStatusReportReadinessStatus"];
    action: OrchestratorState["lastStatusReportAction"];
    targetStrategy: OrchestratorState["lastStatusReportTargetStrategy"];
    summary: string | null;
    failureReason: string | null;
    correlationId: string | null;
    target: string | null;
    lastAuditId: string | null;
    recentAttempts: string[];
    authSmokeStatus: OrchestratorState["authSmokeStatus"];
    authSmokeSuccessStatus: OrchestratorState["authSmokeSuccessStatus"];
    authSmokeMode: OrchestratorState["authSmokeMode"];
    authSmokePermissionResult: OrchestratorState["authSmokePermissionResult"];
    authSmokeFailureReason: string | null;
    selectedSandboxProfileId: string | null;
    sandboxProfileSelectionMode: OrchestratorState["sandboxProfileSelectionMode"];
    sandboxProfileSelectionReason: string | null;
    targetSelectionStatus: OrchestratorState["targetSelectionStatus"];
    authSmokeTarget: string | null;
    sandboxProfileId: string | null;
    sandboxProfileStatus: OrchestratorState["sandboxProfileStatus"];
    sandboxTargetProfileId: string | null;
    sandboxTargetConfigVersion: string | null;
    profileGovernanceStatus: OrchestratorState["profileGovernanceStatus"];
    profileGovernanceReason: string | null;
    bundleGovernanceStatus: OrchestratorState["bundleGovernanceStatus"];
    bundleGovernanceReason: string | null;
    lastSandboxGuardrailsStatus: OrchestratorState["lastSandboxGuardrailsStatus"];
    lastSandboxGuardrailsReason: string | null;
    lastSandboxAuditId: string | null;
    recentSandboxAuditSummaries: string[];
    sandboxBundleId: string | null;
    sandboxBundleOverrideFields: string[];
    lastSandboxDiffSummary: string[];
    lastSandboxImportExportStatus: string;
    lastSandboxImportExportSummary: string | null;
    lastSandboxReviewStatus: string;
    lastSandboxReviewSummary: string | null;
    lastSandboxApplyStatus: string;
    lastSandboxApplySummary: string | null;
    lastBatchChangeStatus: string;
    lastBatchImpactSummary: string | null;
    lastBatchAffectedProfiles: string[];
    lastBatchBlockedProfiles: string[];
    lastRestorePointId: string | null;
    lastRestorePointSummary: string | null;
    currentRestorePointCount: number;
    currentValidRestorePointCount: number;
    lastRollbackStatus: OrchestratorState["lastRollbackStatus"];
    lastRollbackImpactSummary: string | null;
    lastRollbackAuditId: string | null;
    rollbackGovernanceStatus: OrchestratorState["rollbackGovernanceStatus"];
    rollbackGovernanceReason: string | null;
    lastBatchRecoveryStatus: OrchestratorState["lastBatchRecoveryStatus"];
    lastBatchRecoverySummary: string | null;
    restorePointRetentionStatus: OrchestratorState["restorePointRetentionStatus"];
    lastRestorePointPruneSummary: string | null;
    lastSandboxHistorySummary: string | null;
    lastSandboxCompareSummary: string | null;
    lastRecoveryIncidentSummary: string | null;
    lastRestorePointLookupStatus: OrchestratorState["lastRestorePointLookupStatus"];
    lastRestorePointCompareStatus: OrchestratorState["lastRestorePointCompareStatus"];
    lastIncidentType: OrchestratorState["lastIncidentType"];
    lastIncidentSeverity: OrchestratorState["lastIncidentSeverity"];
    lastIncidentSummary: string | null;
    lastOperatorAction: OrchestratorState["lastOperatorAction"];
    lastOperatorActionStatus: OrchestratorState["lastOperatorActionStatus"];
    lastEscalationSummary: string | null;
    lastAuthSmokeSuccessAt: string | null;
    authSmokeEvidencePath: string | null;
    liveSmokeSummary: string | null;
    liveSmokeTarget: string | null;
  };
  nextSuggestedAction: string;
};

function resolveNextSuggestedAction(state: OrchestratorState, preflight: PreflightResult | null) {
  if (state.lastCloseoutReviewQueue?.recommendedNextOperatorStep) {
    return state.lastCloseoutReviewQueue.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutReviewSummary?.recommendedNextReviewAction) {
    return state.lastCloseoutReviewSummary.recommendedNextReviewAction;
  }
  if (state.lastCloseoutChecklist?.recommendedNextStep) {
    return state.lastCloseoutChecklist.recommendedNextStep;
  }
  if (state.lastCloseoutSummary?.recommendedNextStepAfterCloseoutCheck) {
    return state.lastCloseoutSummary.recommendedNextStepAfterCloseoutCheck;
  }
  if (state.lastResolutionReadiness?.recommendedNextStepBeforeClosure) {
    return state.lastResolutionReadiness.recommendedNextStepBeforeClosure;
  }
  if (state.lastClosureGatingDecision?.recommendedNextStep) {
    return state.lastClosureGatingDecision.recommendedNextStep;
  }
  if (state.lastGovernanceStatus?.recommendedNextStep) {
    return state.lastGovernanceStatus.recommendedNextStep;
  }
  if (state.lastIncidentSeverity === "critical") {
    return "Escalate the latest critical sandbox recovery incident before further recovery apply actions.";
  }
  if (state.lastIncidentSeverity === "manual_required") {
    return "Request review or manual intervention for the latest sandbox recovery incident before retrying.";
  }
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
    inboundEventId: state.inboundEventId,
    inboundDeliveryId: state.inboundDeliveryId,
    inboundCorrelationId: state.inboundCorrelationId,
    actorIdentity: state.actorIdentity?.login ?? null,
    actorAuthorizationStatus: state.actorAuthorizationStatus,
    actorPolicyConfigVersion: state.actorPolicyConfigVersion,
    replayProtectionStatus: state.replayProtectionStatus,
    inboundAuditStatus: state.inboundAuditStatus,
    runtimeHealthStatus: state.runtimeHealthStatus,
    runtimeReadinessStatus: state.runtimeReadinessStatus,
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
    sandboxGovernance: {
      lastGovernanceStatus: state.lastGovernanceStatus,
      lastIncidentPolicy: state.lastIncidentPolicy,
      lastOperatorHandoffSummary: state.lastOperatorHandoffSummary,
      lastResolutionReadiness: state.lastResolutionReadiness,
      lastResolutionEvidenceSummary: state.lastResolutionEvidenceSummary,
      lastClosureGatingDecision: state.lastClosureGatingDecision,
      lastResolutionAuditLog: state.lastResolutionAuditLog,
      lastCloseoutSummary: state.lastCloseoutSummary,
      lastCloseoutChecklist: state.lastCloseoutChecklist,
      lastResolutionAuditHistory: state.lastResolutionAuditHistory,
      lastCloseoutReviewSummary: state.lastCloseoutReviewSummary,
      lastCloseoutReviewQueue: state.lastCloseoutReviewQueue,
    },
    statusReporting: {
      status: state.statusReportStatus,
      readiness: state.liveStatusReportReadiness,
      liveStatus: state.liveStatusReportStatus,
      permissionStatus: state.lastStatusReportPermissionStatus,
      readinessStatus: state.lastStatusReportReadinessStatus,
      action: state.lastStatusReportAction,
      targetStrategy: state.lastStatusReportTargetStrategy,
      summary: state.lastStatusReportSummary?.summary ?? null,
      failureReason: state.lastStatusReportFailureReason,
      correlationId: state.statusReportCorrelationId,
      target: state.lastStatusReportTarget?.targetUrl ?? state.lastStatusReportTarget?.correlationId ?? null,
      lastAuditId: state.lastReportDeliveryAuditId,
      recentAttempts: state.reportDeliveryAttempts
        .slice(-3)
        .map(
          (attempt) =>
            `${attempt.attemptedAt} ${attempt.action} ${attempt.targetType}:${attempt.targetId ?? "none"} ${attempt.permissionCheckResult} ${attempt.failureReason ?? "ok"}`,
        ),
      authSmokeStatus: state.authSmokeStatus,
      authSmokeSuccessStatus: state.authSmokeSuccessStatus,
      authSmokeMode: state.authSmokeMode,
      authSmokePermissionResult: state.authSmokePermissionResult,
      authSmokeFailureReason: state.authSmokeFailureReason,
      selectedSandboxProfileId: state.selectedSandboxProfileId,
      sandboxProfileSelectionMode: state.sandboxProfileSelectionMode,
      sandboxProfileSelectionReason: state.sandboxProfileSelectionReason,
      targetSelectionStatus: state.targetSelectionStatus,
      authSmokeTarget: state.authSmokeTarget
        ? `${state.authSmokeTarget.repository ?? "none"}:${state.authSmokeTarget.targetType ?? "none"}:${state.authSmokeTarget.targetNumber ?? "none"}`
        : null,
      sandboxProfileId: state.sandboxProfileId,
      sandboxProfileStatus: state.sandboxProfileStatus,
      sandboxTargetProfileId: state.sandboxTargetProfileId,
      sandboxTargetConfigVersion: state.sandboxTargetConfigVersion,
      profileGovernanceStatus: state.profileGovernanceStatus,
      profileGovernanceReason: state.profileGovernanceReason,
      bundleGovernanceStatus: state.bundleGovernanceStatus,
      bundleGovernanceReason: state.bundleGovernanceReason,
      lastSandboxGuardrailsStatus: state.lastSandboxGuardrailsStatus,
      lastSandboxGuardrailsReason: state.lastSandboxGuardrailsReason,
      lastSandboxAuditId: state.lastSandboxAuditId,
      recentSandboxAuditSummaries: state.recentSandboxAuditSummaries.slice(-5),
      sandboxBundleId: state.sandboxBundleId,
      sandboxBundleOverrideFields: state.sandboxBundleOverrideFields,
      lastSandboxDiffSummary: state.lastSandboxDiffSummary.slice(-5),
      lastSandboxImportExportStatus: state.lastSandboxImportExportStatus,
      lastSandboxImportExportSummary: state.lastSandboxImportExportSummary,
      lastSandboxReviewStatus: state.lastSandboxReviewStatus,
      lastSandboxReviewSummary: state.lastSandboxReviewSummary,
      lastSandboxApplyStatus: state.lastSandboxApplyStatus,
      lastSandboxApplySummary: state.lastSandboxApplySummary,
      lastBatchChangeStatus: state.lastBatchChangeStatus,
      lastBatchImpactSummary: state.lastBatchImpactSummary,
      lastBatchAffectedProfiles: state.lastBatchAffectedProfiles,
      lastBatchBlockedProfiles: state.lastBatchBlockedProfiles,
      lastRestorePointId: state.lastRestorePointId,
      lastRestorePointSummary: state.lastRestorePointSummary,
      currentRestorePointCount: state.currentRestorePointCount,
      currentValidRestorePointCount: state.currentValidRestorePointCount,
      lastRollbackStatus: state.lastRollbackStatus,
      lastRollbackImpactSummary: state.lastRollbackImpactSummary,
      lastRollbackAuditId: state.lastRollbackAuditId,
      rollbackGovernanceStatus: state.rollbackGovernanceStatus,
      rollbackGovernanceReason: state.rollbackGovernanceReason,
      lastBatchRecoveryStatus: state.lastBatchRecoveryStatus,
      lastBatchRecoverySummary: state.lastBatchRecoverySummary,
      restorePointRetentionStatus: state.restorePointRetentionStatus,
      lastRestorePointPruneSummary: state.lastRestorePointPruneSummary,
      lastSandboxHistorySummary: state.lastSandboxHistorySummary,
      lastSandboxCompareSummary: state.lastSandboxCompareSummary,
      lastRecoveryIncidentSummary: state.lastRecoveryIncidentSummary,
      lastRestorePointLookupStatus: state.lastRestorePointLookupStatus,
      lastRestorePointCompareStatus: state.lastRestorePointCompareStatus,
      lastIncidentType: state.lastIncidentType,
      lastIncidentSeverity: state.lastIncidentSeverity,
      lastIncidentSummary: state.lastIncidentSummary,
      lastOperatorAction: state.lastOperatorAction,
      lastOperatorActionStatus: state.lastOperatorActionStatus,
      lastEscalationSummary: state.lastEscalationSummary,
      lastAuthSmokeSuccessAt: state.lastAuthSmokeSuccessAt,
      authSmokeEvidencePath: state.lastAuthSmokeEvidencePath,
      liveSmokeSummary: state.lastLiveSmokeSummary,
      liveSmokeTarget: state.lastLiveSmokeTarget
        ? `${state.lastLiveSmokeTarget.repository ?? "none"}:${state.lastLiveSmokeTarget.targetType ?? "none"}:${state.lastLiveSmokeTarget.targetNumber ?? "none"}`
        : null,
    },
    nextSuggestedAction: resolveNextSuggestedAction(state, preflight),
  } satisfies OrchestratorDiagnostics;
}

export function formatDiagnosticsSummary(summary: OrchestratorDiagnostics) {
  const lines = [
    `State: ${summary.stateId}`,
    `Status: ${summary.status} (iteration ${summary.iterationNumber}, profile ${summary.profileId})`,
    `Source: type=${summary.sourceEventType}, eventId=${summary.sourceEventId ?? "none"}, webhook=${summary.webhookEventType}/${summary.webhookDeliveryId ?? "none"}/${summary.webhookSignatureStatus}, inbound=${summary.inboundEventId ?? "none"}/${summary.inboundDeliveryId ?? "none"}/${summary.inboundAuditStatus}, actor=${summary.actorIdentity ?? "none"}/${summary.actorAuthorizationStatus}/${summary.actorPolicyConfigVersion ?? "none"}, replay=${summary.replayProtectionStatus}, correlation=${summary.inboundCorrelationId ?? "none"}, idempotency=${summary.idempotencyKey ?? "none"} (${summary.idempotencyStatus}), triggerPolicy=${summary.triggerPolicyId ?? "none"}`,
    `Runtime: health=${summary.runtimeHealthStatus}, readiness=${summary.runtimeReadinessStatus}`,
    `Command: raw=${summary.parsedCommand ?? "none"}, routing=${summary.commandRoutingStatus}, summary=${summary.commandRoutingSummary ?? "none"}`,
    `Planner: ${summary.plannerSummary}`,
    `Reviewer: ${summary.reviewerSummary}`,
    `Last iteration: ${summary.lastIterationSummary}`,
    `Artifacts: backend=${summary.artifactSummary.backendType}, backendHealth=${summary.artifactSummary.backendHealthStatus}, queue=${summary.artifactSummary.queueStatus}, transfer=${summary.artifactSummary.transferStatus}, repair=${summary.artifactSummary.repairStatus}, patch=${summary.artifactSummary.patchStatus}, promotion=${summary.artifactSummary.promotionStatus}, handoff=${summary.artifactSummary.handoffStatus}, prDraft=${summary.artifactSummary.prDraftStatus}, liveAcceptance=${summary.artifactSummary.liveAcceptanceStatus}, livePass=${summary.artifactSummary.livePassStatus}, workspace=${summary.artifactSummary.workspaceStatus}`,
    `Worker: status=${summary.workerSummary.workerStatus}, supervision=${summary.workerSummary.supervisionStatus}, workerId=${summary.workerSummary.workerId ?? "none"}, leaseOwner=${summary.workerSummary.leaseOwner ?? "none"}, lastHeartbeat=${summary.workerSummary.lastHeartbeatAt ?? "none"}, lastLeaseRenewal=${summary.workerSummary.lastLeaseRenewalAt ?? "none"}, daemonHeartbeat=${summary.workerSummary.daemonHeartbeatAt ?? "none"}, cancel=${summary.workerSummary.cancellationStatus}, pause=${summary.workerSummary.pauseStatus}, retries=${summary.workerSummary.retryCount}`,
    `Recovery: action=${summary.recoverySummary.action ?? "none"}, reason=${summary.recoverySummary.reason ?? "none"}`,
    `Recovery governance: latest=${summary.sandboxGovernance.lastGovernanceStatus?.latestIncidentType ?? "none"}/${summary.sandboxGovernance.lastGovernanceStatus?.latestIncidentSeverity ?? "none"}, unresolved=${summary.sandboxGovernance.lastGovernanceStatus?.latestUnresolvedIncidentCount ?? 0}, escalation=${summary.sandboxGovernance.lastGovernanceStatus?.latestEscalationNeededCount ?? 0}, action=${summary.sandboxGovernance.lastGovernanceStatus?.recommendedAction ?? "none"}, rerun=${summary.sandboxGovernance.lastGovernanceStatus?.rerunRecommended ?? false}, manualReview=${summary.sandboxGovernance.lastGovernanceStatus?.manualReviewRequired ?? false}, applyBlocked=${summary.sandboxGovernance.lastGovernanceStatus?.applyBlocked ?? false}, handoff=${summary.sandboxGovernance.lastGovernanceStatus?.operatorHandoffRecommended ?? false}, summary=${summary.sandboxGovernance.lastGovernanceStatus?.summary ?? "none"}`,
    `Recovery policy: action=${summary.sandboxGovernance.lastIncidentPolicy?.recommendedAction ?? "none"}, preview=${summary.sandboxGovernance.lastIncidentPolicy?.allowRerunPreview ?? false}, validate=${summary.sandboxGovernance.lastIncidentPolicy?.allowRerunValidate ?? false}, apply=${summary.sandboxGovernance.lastIncidentPolicy?.allowRerunApply ?? false}, requestReview=${summary.sandboxGovernance.lastIncidentPolicy?.requireRequestReview ?? false}, escalate=${summary.sandboxGovernance.lastIncidentPolicy?.requireEscalate ?? false}, blockedTerminal=${summary.sandboxGovernance.lastIncidentPolicy?.blockedTerminalState ?? false}, manualRequiredTerminal=${summary.sandboxGovernance.lastIncidentPolicy?.manualRequiredTerminalState ?? false}`,
    `Resolution readiness: status=${summary.sandboxGovernance.lastResolutionReadiness?.readinessStatus ?? "none"}, confidence=${summary.sandboxGovernance.lastResolutionReadiness?.readinessConfidence ?? "none"}, closureAllowed=${summary.sandboxGovernance.lastResolutionReadiness?.closureAllowed ?? false}, unresolved=${summary.sandboxGovernance.lastResolutionReadiness?.unresolvedIncidentsRemain ?? false}, escalation=${summary.sandboxGovernance.lastResolutionReadiness?.escalationStillNeeded ?? false}, manualReview=${summary.sandboxGovernance.lastResolutionReadiness?.manualReviewStillRequired ?? false}, blockedReasons=${summary.sandboxGovernance.lastResolutionReadiness?.closureBlockedReasonCodes.join(", ") || "none"}, summary=${summary.sandboxGovernance.lastResolutionReadiness?.summary ?? "none"}`,
    `Resolution evidence: confidence=${summary.sandboxGovernance.lastResolutionEvidenceSummary?.closureConfidence ?? "none"}, rerunEvidence=${summary.sandboxGovernance.lastResolutionEvidenceSummary?.rerunEvidenceExists ?? false}, validateEvidence=${summary.sandboxGovernance.lastResolutionEvidenceSummary?.validationEvidenceExists ?? false}, applyEvidence=${summary.sandboxGovernance.lastResolutionEvidenceSummary?.applyEvidenceExists ?? false}, gaps=${summary.sandboxGovernance.lastResolutionEvidenceSummary?.evidenceGapCodes.join(", ") || "none"}, summary=${summary.sandboxGovernance.lastResolutionEvidenceSummary?.summary ?? "none"}`,
    `Closure gating: status=${summary.sandboxGovernance.lastClosureGatingDecision?.closureStatus ?? "none"}, allowed=${summary.sandboxGovernance.lastClosureGatingDecision?.closureAllowed ?? false}, requestReview=${summary.sandboxGovernance.lastClosureGatingDecision?.requestReviewRequired ?? false}, rerunValidate=${summary.sandboxGovernance.lastClosureGatingDecision?.rerunValidateRequired ?? false}, rerunApply=${summary.sandboxGovernance.lastClosureGatingDecision?.rerunApplyRequired ?? false}, escalate=${summary.sandboxGovernance.lastClosureGatingDecision?.escalateRequired ?? false}, reasons=${summary.sandboxGovernance.lastClosureGatingDecision?.blockedReasonCodes.join(", ") || "none"}`,
    `Closeout summary: decision=${summary.sandboxGovernance.lastCloseoutSummary?.latestCloseoutDecision ?? "none"}, evidence=${summary.sandboxGovernance.lastCloseoutSummary?.evidenceSufficiencySummary ?? "none"}, readiness=${summary.sandboxGovernance.lastCloseoutSummary?.readinessSummary ?? "none"}, next=${summary.sandboxGovernance.lastCloseoutSummary?.recommendedNextStepAfterCloseoutCheck ?? "none"}`,
    `Closeout checklist: safe=${summary.sandboxGovernance.lastCloseoutChecklist?.safeToCloseout ?? false}, blocked=${summary.sandboxGovernance.lastCloseoutChecklist?.blockedReasonCodes.join(", ") || "none"}, gaps=${summary.sandboxGovernance.lastCloseoutChecklist?.evidenceGapCodes.join(", ") || "none"}, warnings=${summary.sandboxGovernance.lastCloseoutChecklist?.governanceWarnings.join(" | ") || "none"}, next=${summary.sandboxGovernance.lastCloseoutChecklist?.recommendedNextStep ?? "none"}`,
    `Resolution audit: decision=${summary.sandboxGovernance.lastResolutionAuditLog?.closeoutDecision ?? "none"}, at=${summary.sandboxGovernance.lastResolutionAuditLog?.auditedAt ?? "none"}, reviewRequired=${summary.sandboxGovernance.lastResolutionAuditLog?.reviewRequired ?? false}, escalationRequired=${summary.sandboxGovernance.lastResolutionAuditLog?.escalationRequired ?? false}, summary=${summary.sandboxGovernance.lastResolutionAuditLog?.summaryLine ?? "none"}`,
    `Resolution audit history: retained=${summary.sandboxGovernance.lastResolutionAuditHistory?.retainedEntryCount ?? 0}, latest=${summary.sandboxGovernance.lastResolutionAuditHistory?.latestCloseoutDecision ?? "none"}, repeatedBlocked=${summary.sandboxGovernance.lastResolutionAuditHistory?.repeatedBlockedReasons.join(" | ") || "none"}, repeatedReview=${summary.sandboxGovernance.lastResolutionAuditHistory?.repeatedReviewRequiredReasons.join(" | ") || "none"}, repeatedResolved=${summary.sandboxGovernance.lastResolutionAuditHistory?.repeatedResolvedNotReadyReasons.join(" | ") || "none"}`,
    `Closeout review summary: status=${summary.sandboxGovernance.lastCloseoutReviewSummary?.reviewStatus ?? "none"}, reviewPending=${summary.sandboxGovernance.lastCloseoutReviewSummary?.reviewPending ?? false}, escalationPending=${summary.sandboxGovernance.lastCloseoutReviewSummary?.escalationPending ?? false}, followUp=${summary.sandboxGovernance.lastCloseoutReviewSummary?.evidenceFollowUpPending ?? false}, next=${summary.sandboxGovernance.lastCloseoutReviewSummary?.recommendedNextReviewAction ?? "none"}`,
    `Closeout review queue: status=${summary.sandboxGovernance.lastCloseoutReviewQueue?.queueStatus ?? "none"}, reviewRequired=${summary.sandboxGovernance.lastCloseoutReviewQueue?.reviewRequired ?? false}, escalationRequired=${summary.sandboxGovernance.lastCloseoutReviewQueue?.escalationRequired ?? false}, evidenceFollowUp=${summary.sandboxGovernance.lastCloseoutReviewQueue?.evidenceFollowUpRequired ?? false}, blocked=${summary.sandboxGovernance.lastCloseoutReviewQueue?.blockedReasonsSummary.join(" | ") || "none"}, next=${summary.sandboxGovernance.lastCloseoutReviewQueue?.recommendedNextOperatorStep ?? "none"}`,
    `Operator handoff: ${summary.sandboxGovernance.lastOperatorHandoffSummary?.handoffLine ?? "none"}`,
    `Status reporting: status=${summary.statusReporting.status}, readiness=${summary.statusReporting.readiness}, readinessStatus=${summary.statusReporting.readinessStatus}, live=${summary.statusReporting.liveStatus}, permission=${summary.statusReporting.permissionStatus}, action=${summary.statusReporting.action}, strategy=${summary.statusReporting.targetStrategy}, correlation=${summary.statusReporting.correlationId ?? "none"}, target=${summary.statusReporting.target ?? "none"}, audit=${summary.statusReporting.lastAuditId ?? "none"}, failure=${summary.statusReporting.failureReason ?? "none"}, summary=${summary.statusReporting.summary ?? "none"}`,
    `Auth smoke: status=${summary.statusReporting.authSmokeStatus}, success=${summary.statusReporting.authSmokeSuccessStatus}, mode=${summary.statusReporting.authSmokeMode}, permission=${summary.statusReporting.authSmokePermissionResult}, selection=${summary.statusReporting.targetSelectionStatus}, target=${summary.statusReporting.authSmokeTarget ?? "none"}, selectedProfile=${summary.statusReporting.selectedSandboxProfileId ?? "none"}, selectionMode=${summary.statusReporting.sandboxProfileSelectionMode}, selectionReason=${summary.statusReporting.sandboxProfileSelectionReason ?? "none"}, profile=${summary.statusReporting.sandboxProfileId ?? summary.statusReporting.sandboxTargetProfileId ?? "none"}, profileStatus=${summary.statusReporting.sandboxProfileStatus}, bundle=${summary.statusReporting.sandboxBundleId ?? "none"}, overrides=${summary.statusReporting.sandboxBundleOverrideFields.join(",") || "none"}, governance=${summary.statusReporting.profileGovernanceStatus}/${summary.statusReporting.profileGovernanceReason ?? "none"}, bundleGovernance=${summary.statusReporting.bundleGovernanceStatus}/${summary.statusReporting.bundleGovernanceReason ?? "none"}, guardrails=${summary.statusReporting.lastSandboxGuardrailsStatus}/${summary.statusReporting.lastSandboxGuardrailsReason ?? "none"}, config=${summary.statusReporting.sandboxTargetConfigVersion ?? "none"}, lastAudit=${summary.statusReporting.lastSandboxAuditId ?? "none"}, importExport=${summary.statusReporting.lastSandboxImportExportStatus}/${summary.statusReporting.lastSandboxImportExportSummary ?? "none"}, review=${summary.statusReporting.lastSandboxReviewStatus}/${summary.statusReporting.lastSandboxReviewSummary ?? "none"}, apply=${summary.statusReporting.lastSandboxApplyStatus}/${summary.statusReporting.lastSandboxApplySummary ?? "none"}, batch=${summary.statusReporting.lastBatchChangeStatus}/${summary.statusReporting.lastBatchImpactSummary ?? "none"}, restore=${summary.statusReporting.lastRestorePointId ?? "none"}/${summary.statusReporting.lastRestorePointSummary ?? "none"} count=${summary.statusReporting.currentValidRestorePointCount}/${summary.statusReporting.currentRestorePointCount} retention=${summary.statusReporting.restorePointRetentionStatus}/${summary.statusReporting.lastRestorePointPruneSummary ?? "none"} history=${summary.statusReporting.lastRestorePointLookupStatus}/${summary.statusReporting.lastSandboxHistorySummary ?? "none"} compare=${summary.statusReporting.lastRestorePointCompareStatus}/${summary.statusReporting.lastSandboxCompareSummary ?? "none"}, rollback=${summary.statusReporting.lastRollbackStatus}/${summary.statusReporting.lastRollbackImpactSummary ?? "none"}/${summary.statusReporting.lastRollbackAuditId ?? "none"} governance=${summary.statusReporting.rollbackGovernanceStatus}/${summary.statusReporting.rollbackGovernanceReason ?? "none"} recovery=${summary.statusReporting.lastBatchRecoveryStatus}/${summary.statusReporting.lastBatchRecoverySummary ?? "none"} incidents=${summary.statusReporting.lastRecoveryIncidentSummary ?? "none"} latestIncident=${summary.statusReporting.lastIncidentType}/${summary.statusReporting.lastIncidentSeverity ?? "none"}/${summary.statusReporting.lastIncidentSummary ?? "none"} operator=${summary.statusReporting.lastOperatorAction}/${summary.statusReporting.lastOperatorActionStatus} escalation=${summary.statusReporting.lastEscalationSummary ?? "none"}, successAt=${summary.statusReporting.lastAuthSmokeSuccessAt ?? "none"}, liveTarget=${summary.statusReporting.liveSmokeTarget ?? "none"}, evidence=${summary.statusReporting.authSmokeEvidencePath ?? "none"}, summary=${summary.statusReporting.liveSmokeSummary ?? "none"}, failure=${summary.statusReporting.authSmokeFailureReason ?? "none"}`,
    `Blockers: ${summary.blockers.join(" | ") || "none"}`,
    `Missing prerequisites: ${summary.missingPrerequisites.join(", ") || "none"}`,
  ];
  if (summary.blockedReasons.length > 0) {
    lines.push("Blocked reasons:");
    for (const reason of summary.blockedReasons) {
      lines.push(`- ${reason.code}: ${reason.summary} -> ${reason.suggestedNextAction}`);
    }
  }
  if (summary.statusReporting.recentAttempts.length > 0) {
    lines.push("Recent report attempts:");
    for (const attempt of summary.statusReporting.recentAttempts) {
      lines.push(`- ${attempt}`);
    }
  }
  if (summary.statusReporting.recentSandboxAuditSummaries.length > 0) {
    lines.push("Recent sandbox audit:");
    for (const attempt of summary.statusReporting.recentSandboxAuditSummaries) {
      lines.push(`- ${attempt}`);
    }
  }
  if (summary.statusReporting.lastSandboxDiffSummary.length > 0) {
    lines.push("Latest sandbox diff:");
    for (const diff of summary.statusReporting.lastSandboxDiffSummary) {
      lines.push(`- ${diff}`);
    }
  }
  if (summary.statusReporting.lastBatchAffectedProfiles.length > 0) {
    lines.push(`Last batch affected profiles: ${summary.statusReporting.lastBatchAffectedProfiles.join(", ")}`);
  }
  if (summary.statusReporting.lastBatchBlockedProfiles.length > 0) {
    lines.push(`Last batch blocked profiles: ${summary.statusReporting.lastBatchBlockedProfiles.join(", ")}`);
  }
  if (summary.sandboxGovernance.lastGovernanceStatus?.governanceWarnings.length) {
    lines.push("Recovery governance warnings:");
    for (const warning of summary.sandboxGovernance.lastGovernanceStatus.governanceWarnings) {
      lines.push(`- ${warning}`);
    }
  }
  if (summary.sandboxGovernance.lastOperatorHandoffSummary?.repeatedBlockedManualRequiredHotspots.length) {
    lines.push(
      `Repeated recovery hotspots: ${summary.sandboxGovernance.lastOperatorHandoffSummary.repeatedBlockedManualRequiredHotspots.join(", ")}`,
    );
  }
  if (summary.sandboxGovernance.lastResolutionEvidenceSummary?.evidenceGaps.length) {
    lines.push("Resolution evidence gaps:");
    for (const gap of summary.sandboxGovernance.lastResolutionEvidenceSummary.evidenceGaps) {
      lines.push(`- ${gap}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutChecklist?.items.length) {
    lines.push("Closeout checklist items:");
    for (const item of summary.sandboxGovernance.lastCloseoutChecklist.items) {
      lines.push(`- ${item.key}: ${item.satisfied} -> ${item.suggestedNextAction}`);
    }
  }
  if (summary.sandboxGovernance.lastClosureGatingDecision?.blockedReasons.length) {
    lines.push("Closure blocked reasons:");
    for (const reason of summary.sandboxGovernance.lastClosureGatingDecision.blockedReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastResolutionAuditHistory?.repeatedCloseoutDecisionPatterns.length) {
    lines.push("Repeated closeout decision patterns:");
    for (const pattern of summary.sandboxGovernance.lastResolutionAuditHistory.repeatedCloseoutDecisionPatterns) {
      lines.push(`- ${pattern.decision}: ${pattern.count}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutReviewQueue?.entries.length) {
    lines.push("Closeout review queue:");
    for (const entry of summary.sandboxGovernance.lastCloseoutReviewQueue.entries) {
      lines.push(`- ${entry.auditedAt} ${entry.queueStatus} ${entry.closeoutDecisionStatus} -> ${entry.recommendedNextOperatorStep}`);
    }
  }
  lines.push(`Next action: ${summary.nextSuggestedAction}`);
  return lines.join("\n");
}
