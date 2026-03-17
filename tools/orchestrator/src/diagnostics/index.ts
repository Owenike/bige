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
    lastCloseoutReviewAction: OrchestratorState["lastCloseoutReviewAction"];
    lastCloseoutDispositionSummary: OrchestratorState["lastCloseoutDispositionSummary"];
    lastCloseoutReviewLifecycle: OrchestratorState["lastCloseoutReviewLifecycle"];
    lastCloseoutReviewAuditTrail: OrchestratorState["lastCloseoutReviewAuditTrail"];
    lastCloseoutReviewHistory: OrchestratorState["lastCloseoutReviewHistory"];
    lastCloseoutReviewResolutionSummary: OrchestratorState["lastCloseoutReviewResolutionSummary"];
    lastCloseoutSettlementAudit: OrchestratorState["lastCloseoutSettlementAudit"];
    lastCloseoutFollowupSummary: OrchestratorState["lastCloseoutFollowupSummary"];
    lastCloseoutFollowupQueue: OrchestratorState["lastCloseoutFollowupQueue"];
    lastCloseoutCompletionAudit: OrchestratorState["lastCloseoutCompletionAudit"];
    lastCloseoutCompletionSummary: OrchestratorState["lastCloseoutCompletionSummary"];
    lastCloseoutCompletionQueue: OrchestratorState["lastCloseoutCompletionQueue"];
    lastCloseoutCompletionHistory: OrchestratorState["lastCloseoutCompletionHistory"];
    lastCloseoutCompletionResolutionSummary: OrchestratorState["lastCloseoutCompletionResolutionSummary"];
    lastCloseoutCompletionCarryForwardQueue: OrchestratorState["lastCloseoutCompletionCarryForwardQueue"];
    lastCloseoutCompletionAction: OrchestratorState["lastCloseoutCompletionAction"];
    lastCloseoutCompletionDispositionSummary: OrchestratorState["lastCloseoutCompletionDispositionSummary"];
    lastCloseoutCompletionLifecycle: OrchestratorState["lastCloseoutCompletionLifecycle"];
    lastCloseoutCompletionDecisionAudit: OrchestratorState["lastCloseoutCompletionDecisionAudit"];
    lastCloseoutCompletionDecisionHistory: OrchestratorState["lastCloseoutCompletionDecisionHistory"];
    lastCloseoutCompletionFinalizationSummary: OrchestratorState["lastCloseoutCompletionFinalizationSummary"];
    lastCloseoutFinalizationAuditHistory: OrchestratorState["lastCloseoutFinalizationAuditHistory"];
    lastCloseoutFinalizationStabilitySummary: OrchestratorState["lastCloseoutFinalizationStabilitySummary"];
    lastCloseoutPostFinalizationFollowupQueue: OrchestratorState["lastCloseoutPostFinalizationFollowupQueue"];
    lastCloseoutStabilityDrift: OrchestratorState["lastCloseoutStabilityDrift"];
    lastCloseoutReopenRecurrence: OrchestratorState["lastCloseoutReopenRecurrence"];
    lastCloseoutStabilityWatchlist: OrchestratorState["lastCloseoutStabilityWatchlist"];
    lastCloseoutStabilityRecurrenceAudit: OrchestratorState["lastCloseoutStabilityRecurrenceAudit"];
    lastCloseoutWatchlistResolutionSummary: OrchestratorState["lastCloseoutWatchlistResolutionSummary"];
    lastCloseoutWatchlistLifecycle: OrchestratorState["lastCloseoutWatchlistLifecycle"];
    lastCloseoutWatchlistExitAudit: OrchestratorState["lastCloseoutWatchlistExitAudit"];
    lastCloseoutWatchlistReaddHistory: OrchestratorState["lastCloseoutWatchlistReaddHistory"];
    lastCloseoutStabilityRecoverySummary: OrchestratorState["lastCloseoutStabilityRecoverySummary"];
    lastCloseoutRecoveryConfidence: OrchestratorState["lastCloseoutRecoveryConfidence"];
    lastCloseoutRecoveryRegressionAudit: OrchestratorState["lastCloseoutRecoveryRegressionAudit"];
    lastCloseoutRecoveredMonitoringQueue: OrchestratorState["lastCloseoutRecoveredMonitoringQueue"];
    lastCloseoutRecoveryConfidenceTrend: OrchestratorState["lastCloseoutRecoveryConfidenceTrend"];
    lastCloseoutRegressionResolutionSummary: OrchestratorState["lastCloseoutRegressionResolutionSummary"];
    lastCloseoutRecoveredMonitoringExitAudit: OrchestratorState["lastCloseoutRecoveredMonitoringExitAudit"];
    lastCloseoutRecoveryClearanceAudit: OrchestratorState["lastCloseoutRecoveryClearanceAudit"];
    lastCloseoutRecoveryClearanceHistory: OrchestratorState["lastCloseoutRecoveryClearanceHistory"];
    lastCloseoutRecoveredExitHistory: OrchestratorState["lastCloseoutRecoveredExitHistory"];
    lastCloseoutRecoveredLifecycle: OrchestratorState["lastCloseoutRecoveredLifecycle"];
    lastCloseoutRecoveredReentryAudit: OrchestratorState["lastCloseoutRecoveredReentryAudit"];
    lastCloseoutRecoveredLifecycleHistory: OrchestratorState["lastCloseoutRecoveredLifecycleHistory"];
    lastCloseoutRecoveryRetirementAudit:
      OrchestratorState["lastCloseoutRecoveryRetirementAudit"];
    lastCloseoutRecoveredRetirementSummary:
      OrchestratorState["lastCloseoutRecoveredRetirementSummary"];
    lastCloseoutRecoveryRetirementQueue:
      OrchestratorState["lastCloseoutRecoveryRetirementQueue"];
    lastCloseoutRecoveryRetirementHistory:
      OrchestratorState["lastCloseoutRecoveryRetirementHistory"];
    lastCloseoutRetirementExitCriteria:
      OrchestratorState["lastCloseoutRetirementExitCriteria"];
    lastCloseoutRetiredCaseAuditHistory:
      OrchestratorState["lastCloseoutRetiredCaseAuditHistory"];
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
  if (state.lastCloseoutRetiredCaseAuditHistory?.recommendedNextOperatorStep) {
    return state.lastCloseoutRetiredCaseAuditHistory.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRetirementExitCriteria?.recommendedNextOperatorStep) {
    return state.lastCloseoutRetirementExitCriteria.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveryRetirementHistory?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveryRetirementHistory.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveryRetirementQueue?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveryRetirementQueue.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveredRetirementSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveredRetirementSummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveryRetirementAudit?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveryRetirementAudit.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveredLifecycleHistory?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveredLifecycleHistory.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveredReentryAudit?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveredReentryAudit.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveryClearanceHistory?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveryClearanceHistory.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveredLifecycle?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveredLifecycle.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveredExitHistory?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveredExitHistory.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveryClearanceAudit?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveryClearanceAudit.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveredMonitoringExitAudit?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveredMonitoringExitAudit.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRegressionResolutionSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutRegressionResolutionSummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveryConfidenceTrend?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveryConfidenceTrend.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveryRegressionAudit?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveryRegressionAudit.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveredMonitoringQueue?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveredMonitoringQueue.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutRecoveryConfidence?.recommendedNextOperatorStep) {
    return state.lastCloseoutRecoveryConfidence.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutStabilityRecoverySummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutStabilityRecoverySummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutWatchlistReaddHistory?.recommendedNextOperatorStep) {
    return state.lastCloseoutWatchlistReaddHistory.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutWatchlistExitAudit?.recommendedNextOperatorStep) {
    return state.lastCloseoutWatchlistExitAudit.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutWatchlistLifecycle?.recommendedNextOperatorStep) {
    return state.lastCloseoutWatchlistLifecycle.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutWatchlistResolutionSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutWatchlistResolutionSummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutStabilityRecurrenceAudit?.recommendedNextOperatorStep) {
    return state.lastCloseoutStabilityRecurrenceAudit.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutStabilityWatchlist?.recommendedNextOperatorStep) {
    return state.lastCloseoutStabilityWatchlist.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutStabilityDrift?.recommendedNextOperatorStep) {
    return state.lastCloseoutStabilityDrift.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutReopenRecurrence?.recommendedNextOperatorStep) {
    return state.lastCloseoutReopenRecurrence.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutFinalizationStabilitySummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutFinalizationStabilitySummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutPostFinalizationFollowupQueue?.recommendedNextOperatorStep) {
    return state.lastCloseoutPostFinalizationFollowupQueue.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutCompletionFinalizationSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutCompletionFinalizationSummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutCompletionLifecycle?.recommendedNextOperatorStep) {
    return state.lastCloseoutCompletionLifecycle.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutCompletionDispositionSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutCompletionDispositionSummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutCompletionResolutionSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutCompletionResolutionSummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutCompletionCarryForwardQueue?.recommendedNextOperatorStep) {
    return state.lastCloseoutCompletionCarryForwardQueue.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutCompletionSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutCompletionSummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutCompletionQueue?.recommendedNextOperatorStep) {
    return state.lastCloseoutCompletionQueue.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutFollowupSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutFollowupSummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutFollowupQueue?.recommendedNextOperatorStep) {
    return state.lastCloseoutFollowupQueue.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutReviewResolutionSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutReviewResolutionSummary.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutReviewLifecycle?.recommendedNextOperatorStep) {
    return state.lastCloseoutReviewLifecycle.recommendedNextOperatorStep;
  }
  if (state.lastCloseoutDispositionSummary?.recommendedNextOperatorStep) {
    return state.lastCloseoutDispositionSummary.recommendedNextOperatorStep;
  }
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
      lastCloseoutReviewAction: state.lastCloseoutReviewAction,
      lastCloseoutDispositionSummary: state.lastCloseoutDispositionSummary,
      lastCloseoutReviewLifecycle: state.lastCloseoutReviewLifecycle,
      lastCloseoutReviewAuditTrail: state.lastCloseoutReviewAuditTrail,
      lastCloseoutReviewHistory: state.lastCloseoutReviewHistory,
      lastCloseoutReviewResolutionSummary: state.lastCloseoutReviewResolutionSummary,
      lastCloseoutSettlementAudit: state.lastCloseoutSettlementAudit,
      lastCloseoutFollowupSummary: state.lastCloseoutFollowupSummary,
      lastCloseoutFollowupQueue: state.lastCloseoutFollowupQueue,
      lastCloseoutCompletionAudit: state.lastCloseoutCompletionAudit,
      lastCloseoutCompletionSummary: state.lastCloseoutCompletionSummary,
      lastCloseoutCompletionQueue: state.lastCloseoutCompletionQueue,
      lastCloseoutCompletionHistory: state.lastCloseoutCompletionHistory,
      lastCloseoutCompletionResolutionSummary: state.lastCloseoutCompletionResolutionSummary,
      lastCloseoutCompletionCarryForwardQueue: state.lastCloseoutCompletionCarryForwardQueue,
      lastCloseoutCompletionAction: state.lastCloseoutCompletionAction,
      lastCloseoutCompletionDispositionSummary: state.lastCloseoutCompletionDispositionSummary,
      lastCloseoutCompletionLifecycle: state.lastCloseoutCompletionLifecycle,
      lastCloseoutCompletionDecisionAudit: state.lastCloseoutCompletionDecisionAudit,
      lastCloseoutCompletionDecisionHistory: state.lastCloseoutCompletionDecisionHistory,
      lastCloseoutCompletionFinalizationSummary:
        state.lastCloseoutCompletionFinalizationSummary,
      lastCloseoutFinalizationAuditHistory: state.lastCloseoutFinalizationAuditHistory,
      lastCloseoutFinalizationStabilitySummary:
        state.lastCloseoutFinalizationStabilitySummary,
      lastCloseoutPostFinalizationFollowupQueue:
        state.lastCloseoutPostFinalizationFollowupQueue,
      lastCloseoutStabilityDrift: state.lastCloseoutStabilityDrift,
      lastCloseoutReopenRecurrence: state.lastCloseoutReopenRecurrence,
      lastCloseoutStabilityWatchlist: state.lastCloseoutStabilityWatchlist,
      lastCloseoutStabilityRecurrenceAudit: state.lastCloseoutStabilityRecurrenceAudit,
      lastCloseoutWatchlistResolutionSummary: state.lastCloseoutWatchlistResolutionSummary,
      lastCloseoutWatchlistLifecycle: state.lastCloseoutWatchlistLifecycle,
      lastCloseoutWatchlistExitAudit: state.lastCloseoutWatchlistExitAudit,
      lastCloseoutWatchlistReaddHistory: state.lastCloseoutWatchlistReaddHistory,
      lastCloseoutStabilityRecoverySummary: state.lastCloseoutStabilityRecoverySummary,
      lastCloseoutRecoveryConfidence: state.lastCloseoutRecoveryConfidence,
      lastCloseoutRecoveryRegressionAudit:
        state.lastCloseoutRecoveryRegressionAudit,
      lastCloseoutRecoveredMonitoringQueue:
        state.lastCloseoutRecoveredMonitoringQueue,
      lastCloseoutRecoveryConfidenceTrend:
        state.lastCloseoutRecoveryConfidenceTrend,
      lastCloseoutRegressionResolutionSummary:
        state.lastCloseoutRegressionResolutionSummary,
      lastCloseoutRecoveredMonitoringExitAudit:
        state.lastCloseoutRecoveredMonitoringExitAudit,
      lastCloseoutRecoveryClearanceAudit:
        state.lastCloseoutRecoveryClearanceAudit,
      lastCloseoutRecoveryClearanceHistory:
        state.lastCloseoutRecoveryClearanceHistory,
      lastCloseoutRecoveredExitHistory:
        state.lastCloseoutRecoveredExitHistory,
      lastCloseoutRecoveredLifecycle:
        state.lastCloseoutRecoveredLifecycle,
      lastCloseoutRecoveredReentryAudit:
        state.lastCloseoutRecoveredReentryAudit,
      lastCloseoutRecoveredLifecycleHistory:
        state.lastCloseoutRecoveredLifecycleHistory,
      lastCloseoutRecoveryRetirementAudit:
        state.lastCloseoutRecoveryRetirementAudit,
      lastCloseoutRecoveredRetirementSummary:
        state.lastCloseoutRecoveredRetirementSummary,
      lastCloseoutRecoveryRetirementQueue:
        state.lastCloseoutRecoveryRetirementQueue,
      lastCloseoutRecoveryRetirementHistory:
        state.lastCloseoutRecoveryRetirementHistory,
      lastCloseoutRetirementExitCriteria:
        state.lastCloseoutRetirementExitCriteria,
      lastCloseoutRetiredCaseAuditHistory:
        state.lastCloseoutRetiredCaseAuditHistory,
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
    `Closeout review action: action=${summary.sandboxGovernance.lastCloseoutReviewAction?.latestReviewAction ?? "none"}, status=${summary.sandboxGovernance.lastCloseoutReviewAction?.latestReviewActionStatus ?? "not_run"}, reason=${summary.sandboxGovernance.lastCloseoutReviewAction?.latestReviewActionReason ?? "none"}, note=${summary.sandboxGovernance.lastCloseoutReviewAction?.latestReviewActionNote ?? "none"}`,
    `Closeout disposition: result=${summary.sandboxGovernance.lastCloseoutDispositionSummary?.dispositionResult ?? "none"}, reviewOpen=${summary.sandboxGovernance.lastCloseoutDispositionSummary?.reviewRemainsOpen ?? false}, followUpOpen=${summary.sandboxGovernance.lastCloseoutDispositionSummary?.followUpRemainsOpen ?? false}, queueExit=${summary.sandboxGovernance.lastCloseoutDispositionSummary?.queueExitAllowed ?? false}, next=${summary.sandboxGovernance.lastCloseoutDispositionSummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout lifecycle: status=${summary.sandboxGovernance.lastCloseoutReviewLifecycle?.lifecycleStatus ?? "none"}, queueRemain=${summary.sandboxGovernance.lastCloseoutReviewLifecycle?.queueShouldRemain ?? true}, queueExit=${summary.sandboxGovernance.lastCloseoutReviewLifecycle?.queueExitAllowed ?? false}, completed=${summary.sandboxGovernance.lastCloseoutReviewLifecycle?.closeoutCompleted ?? false}, next=${summary.sandboxGovernance.lastCloseoutReviewLifecycle?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout review audit: action=${summary.sandboxGovernance.lastCloseoutReviewAuditTrail?.latestReviewAction ?? "none"}, status=${summary.sandboxGovernance.lastCloseoutReviewAuditTrail?.latestReviewActionStatus ?? "not_run"}, disposition=${summary.sandboxGovernance.lastCloseoutReviewAuditTrail?.dispositionSnapshot.dispositionResult ?? "none"}, lifecycle=${summary.sandboxGovernance.lastCloseoutReviewAuditTrail?.lifecycleSnapshot.lifecycleStatus ?? "none"}, queue=${summary.sandboxGovernance.lastCloseoutReviewAuditTrail?.reviewQueueSnapshot.queueStatus ?? "none"}`,
    `Closeout review history: retained=${summary.sandboxGovernance.lastCloseoutReviewHistory?.retainedEntryCount ?? 0}, latestAction=${summary.sandboxGovernance.lastCloseoutReviewHistory?.latestReviewAction ?? "none"}, latestDisposition=${summary.sandboxGovernance.lastCloseoutReviewHistory?.latestDispositionResult ?? "none"}, repeatedReopen=${summary.sandboxGovernance.lastCloseoutReviewHistory?.repeatedReopenPatterns.join(" | ") || "none"}`,
    `Closeout review resolution: status=${summary.sandboxGovernance.lastCloseoutReviewResolutionSummary?.resolutionStatus ?? "none"}, settled=${summary.sandboxGovernance.lastCloseoutReviewResolutionSummary?.reviewThreadSettled ?? false}, reopened=${summary.sandboxGovernance.lastCloseoutReviewResolutionSummary?.reviewThreadReopened ?? false}, followUp=${summary.sandboxGovernance.lastCloseoutReviewResolutionSummary?.followUpRemainsOpen ?? false}, queueExit=${summary.sandboxGovernance.lastCloseoutReviewResolutionSummary?.queueExitAllowed ?? false}, next=${summary.sandboxGovernance.lastCloseoutReviewResolutionSummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout settlement audit: status=${summary.sandboxGovernance.lastCloseoutSettlementAudit?.settlementStatus ?? "none"}, allowed=${summary.sandboxGovernance.lastCloseoutSettlementAudit?.settlementAllowed ?? false}, followUp=${summary.sandboxGovernance.lastCloseoutSettlementAudit?.followUpRemainsOpen ?? false}, queueExit=${summary.sandboxGovernance.lastCloseoutSettlementAudit?.queueExitAllowed ?? false}, reviewComplete=${summary.sandboxGovernance.lastCloseoutSettlementAudit?.reviewComplete ?? false}, closeoutComplete=${summary.sandboxGovernance.lastCloseoutSettlementAudit?.closeoutComplete ?? false}, blocked=${summary.sandboxGovernance.lastCloseoutSettlementAudit?.settlementBlockedReasons.join(" | ") || "none"}`,
    `Closeout follow-up summary: status=${summary.sandboxGovernance.lastCloseoutFollowupSummary?.followupStatus ?? "none"}, open=${summary.sandboxGovernance.lastCloseoutFollowupSummary?.followUpOpen ?? false}, required=${summary.sandboxGovernance.lastCloseoutFollowupSummary?.followUpRequired ?? false}, blockingSettlement=${summary.sandboxGovernance.lastCloseoutFollowupSummary?.followUpBlockingSettlement ?? false}, reviewComplete=${summary.sandboxGovernance.lastCloseoutFollowupSummary?.reviewCanBeTreatedAsComplete ?? false}, closeoutComplete=${summary.sandboxGovernance.lastCloseoutFollowupSummary?.closeoutCanBeTreatedAsComplete ?? false}, next=${summary.sandboxGovernance.lastCloseoutFollowupSummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout follow-up queue: status=${summary.sandboxGovernance.lastCloseoutFollowupQueue?.queueStatus ?? "none"}, followUpRequired=${summary.sandboxGovernance.lastCloseoutFollowupQueue?.followUpRequired ?? false}, followUpOpen=${summary.sandboxGovernance.lastCloseoutFollowupQueue?.followUpOpen ?? false}, settlementBlocked=${summary.sandboxGovernance.lastCloseoutFollowupQueue?.settlementBlocked ?? false}, reviewComplete=${summary.sandboxGovernance.lastCloseoutFollowupQueue?.reviewComplete ?? false}, closeoutComplete=${summary.sandboxGovernance.lastCloseoutFollowupQueue?.closeoutComplete ?? false}, next=${summary.sandboxGovernance.lastCloseoutFollowupQueue?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout completion audit: status=${summary.sandboxGovernance.lastCloseoutCompletionAudit?.completionStatus ?? "none"}, reviewCompleteAllowed=${summary.sandboxGovernance.lastCloseoutCompletionAudit?.reviewCompleteAllowed ?? false}, closeoutCompleteAllowed=${summary.sandboxGovernance.lastCloseoutCompletionAudit?.closeoutCompleteAllowed ?? false}, followUp=${summary.sandboxGovernance.lastCloseoutCompletionAudit?.followUpRemainsOpen ?? false}, queueExit=${summary.sandboxGovernance.lastCloseoutCompletionAudit?.queueExitAllowed ?? false}, fullyReviewed=${summary.sandboxGovernance.lastCloseoutCompletionAudit?.fullyReviewed ?? false}, fullyCompleted=${summary.sandboxGovernance.lastCloseoutCompletionAudit?.fullyCompleted ?? false}, blocked=${summary.sandboxGovernance.lastCloseoutCompletionAudit?.completionBlockedReasons.join(" | ") || "none"}`,
    `Closeout completion summary: status=${summary.sandboxGovernance.lastCloseoutCompletionSummary?.completionStatus ?? "none"}, reviewComplete=${summary.sandboxGovernance.lastCloseoutCompletionSummary?.reviewCompleteReached ?? false}, closeoutComplete=${summary.sandboxGovernance.lastCloseoutCompletionSummary?.closeoutCompleteReached ?? false}, blocked=${summary.sandboxGovernance.lastCloseoutCompletionSummary?.completionBlocked ?? false}, next=${summary.sandboxGovernance.lastCloseoutCompletionSummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout completion queue: status=${summary.sandboxGovernance.lastCloseoutCompletionQueue?.queueStatus ?? "none"}, reviewCompleteRequired=${summary.sandboxGovernance.lastCloseoutCompletionQueue?.reviewCompleteRequired ?? false}, closeoutCompleteRequired=${summary.sandboxGovernance.lastCloseoutCompletionQueue?.closeoutCompleteRequired ?? false}, followUpOpen=${summary.sandboxGovernance.lastCloseoutCompletionQueue?.followUpOpen ?? false}, completionBlocked=${summary.sandboxGovernance.lastCloseoutCompletionQueue?.completionBlocked ?? false}, next=${summary.sandboxGovernance.lastCloseoutCompletionQueue?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout completion history: retained=${summary.sandboxGovernance.lastCloseoutCompletionHistory?.retainedEntryCount ?? 0}, latestStatus=${summary.sandboxGovernance.lastCloseoutCompletionHistory?.latestCompletionStatus ?? "none"}, repeatedRevert=${summary.sandboxGovernance.lastCloseoutCompletionHistory?.repeatedRevertFromCompletePatterns.join(" | ") || "none"}`,
    `Closeout completion resolution: status=${summary.sandboxGovernance.lastCloseoutCompletionResolutionSummary?.resolutionStatus ?? "none"}, settled=${summary.sandboxGovernance.lastCloseoutCompletionResolutionSummary?.completionThreadSettled ?? false}, reverted=${summary.sandboxGovernance.lastCloseoutCompletionResolutionSummary?.completionThreadReverted ?? false}, followUp=${summary.sandboxGovernance.lastCloseoutCompletionResolutionSummary?.followUpRemainsOpen ?? false}, queueRetained=${summary.sandboxGovernance.lastCloseoutCompletionResolutionSummary?.queueRemainsRetained ?? false}, next=${summary.sandboxGovernance.lastCloseoutCompletionResolutionSummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout completion carry-forward: status=${summary.sandboxGovernance.lastCloseoutCompletionCarryForwardQueue?.queueStatus ?? "none"}, reviewCompleteRequired=${summary.sandboxGovernance.lastCloseoutCompletionCarryForwardQueue?.reviewCompleteRequired ?? false}, closeoutCompleteRequired=${summary.sandboxGovernance.lastCloseoutCompletionCarryForwardQueue?.closeoutCompleteRequired ?? false}, followUpOpen=${summary.sandboxGovernance.lastCloseoutCompletionCarryForwardQueue?.followUpOpen ?? false}, reverted=${summary.sandboxGovernance.lastCloseoutCompletionCarryForwardQueue?.completionReverted ?? false}, next=${summary.sandboxGovernance.lastCloseoutCompletionCarryForwardQueue?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout completion action: action=${summary.sandboxGovernance.lastCloseoutCompletionAction?.latestCompletionAction ?? "none"}, status=${summary.sandboxGovernance.lastCloseoutCompletionAction?.latestCompletionActionStatus ?? "none"}, reason=${summary.sandboxGovernance.lastCloseoutCompletionAction?.latestCompletionActionReason ?? "none"}, note=${summary.sandboxGovernance.lastCloseoutCompletionAction?.latestCompletionActionNote ?? "none"}, next=${summary.sandboxGovernance.lastCloseoutCompletionAction?.suggestedNextAction ?? "none"}`,
    `Closeout completion disposition: result=${summary.sandboxGovernance.lastCloseoutCompletionDispositionSummary?.dispositionResult ?? "none"}, carryForwardOpen=${summary.sandboxGovernance.lastCloseoutCompletionDispositionSummary?.carryForwardRemainsOpen ?? false}, queueExit=${summary.sandboxGovernance.lastCloseoutCompletionDispositionSummary?.completionQueueExitAllowed ?? false}, next=${summary.sandboxGovernance.lastCloseoutCompletionDispositionSummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout completion lifecycle: status=${summary.sandboxGovernance.lastCloseoutCompletionLifecycle?.lifecycleStatus ?? "none"}, queueRemain=${summary.sandboxGovernance.lastCloseoutCompletionLifecycle?.carryForwardQueueShouldRemain ?? false}, queueExit=${summary.sandboxGovernance.lastCloseoutCompletionLifecycle?.carryForwardQueueExitAllowed ?? false}, reviewFinalized=${summary.sandboxGovernance.lastCloseoutCompletionLifecycle?.reviewCompleteFinalized ?? false}, closeoutFinalized=${summary.sandboxGovernance.lastCloseoutCompletionLifecycle?.closeoutCompleteFinalized ?? false}, next=${summary.sandboxGovernance.lastCloseoutCompletionLifecycle?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout completion decision audit: action=${summary.sandboxGovernance.lastCloseoutCompletionDecisionAudit?.latestCompletionAction ?? "none"}, status=${summary.sandboxGovernance.lastCloseoutCompletionDecisionAudit?.latestCompletionActionStatus ?? "none"}, finalized=${summary.sandboxGovernance.lastCloseoutCompletionDecisionAudit?.completionFinalized ?? false}, retained=${summary.sandboxGovernance.lastCloseoutCompletionDecisionAudit?.completionRetained ?? false}, reopened=${summary.sandboxGovernance.lastCloseoutCompletionDecisionAudit?.completionReopened ?? false}, queueRetained=${summary.sandboxGovernance.lastCloseoutCompletionDecisionAudit?.queueRetainedReasons.join(" | ") || "none"}`,
    `Closeout completion decision history: retained=${summary.sandboxGovernance.lastCloseoutCompletionDecisionHistory?.retainedEntryCount ?? 0}, latestAction=${summary.sandboxGovernance.lastCloseoutCompletionDecisionHistory?.latestCompletionAction ?? "none"}, latestDisposition=${summary.sandboxGovernance.lastCloseoutCompletionDecisionHistory?.latestDispositionResult ?? "none"}, repeatedRetained=${summary.sandboxGovernance.lastCloseoutCompletionDecisionHistory?.repeatedKeepCarryForwardPatterns.join(" | ") || "none"}, repeatedReopened=${summary.sandboxGovernance.lastCloseoutCompletionDecisionHistory?.repeatedReopenCompletionPatterns.join(" | ") || "none"}`,
    `Closeout completion finalization: status=${summary.sandboxGovernance.lastCloseoutCompletionFinalizationSummary?.finalizationStatus ?? "none"}, finalComplete=${summary.sandboxGovernance.lastCloseoutCompletionFinalizationSummary?.completionThreadFinalComplete ?? false}, finalizedButReopenable=${summary.sandboxGovernance.lastCloseoutCompletionFinalizationSummary?.completionThreadFinalizedButReopenable ?? false}, retained=${summary.sandboxGovernance.lastCloseoutCompletionFinalizationSummary?.completionThreadRetained ?? false}, reopened=${summary.sandboxGovernance.lastCloseoutCompletionFinalizationSummary?.completionThreadReopened ?? false}, next=${summary.sandboxGovernance.lastCloseoutCompletionFinalizationSummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout finalization history: retained=${summary.sandboxGovernance.lastCloseoutFinalizationAuditHistory?.retainedEntryCount ?? 0}, latestStatus=${summary.sandboxGovernance.lastCloseoutFinalizationAuditHistory?.latestFinalizationStatus ?? "none"}, reopenedAfterFinalization=${summary.sandboxGovernance.lastCloseoutFinalizationAuditHistory?.repeatedReopenedAfterFinalizationPatterns.join(" | ") || "none"}`,
    `Closeout finalization stability: status=${summary.sandboxGovernance.lastCloseoutFinalizationStabilitySummary?.stabilityStatus ?? "none"}, finalComplete=${summary.sandboxGovernance.lastCloseoutFinalizationStabilitySummary?.completionThreadFinalComplete ?? false}, stableFinalComplete=${summary.sandboxGovernance.lastCloseoutFinalizationStabilitySummary?.completionThreadStableFinalComplete ?? false}, reopenAfterFinalization=${summary.sandboxGovernance.lastCloseoutFinalizationStabilitySummary?.completionThreadReopenedAfterFinalization ?? false}, postFollowUp=${summary.sandboxGovernance.lastCloseoutFinalizationStabilitySummary?.postFinalizationFollowUpRemainsOpen ?? false}, next=${summary.sandboxGovernance.lastCloseoutFinalizationStabilitySummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout post-finalization queue: status=${summary.sandboxGovernance.lastCloseoutPostFinalizationFollowupQueue?.queueStatus ?? "none"}, finalCompleteReached=${summary.sandboxGovernance.lastCloseoutPostFinalizationFollowupQueue?.finalCompleteReached ?? false}, stableFinalComplete=${summary.sandboxGovernance.lastCloseoutPostFinalizationFollowupQueue?.stableFinalComplete ?? false}, reopenedAfterFinalization=${summary.sandboxGovernance.lastCloseoutPostFinalizationFollowupQueue?.reopenedAfterFinalization ?? false}, next=${summary.sandboxGovernance.lastCloseoutPostFinalizationFollowupQueue?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout stability drift: detected=${summary.sandboxGovernance.lastCloseoutStabilityDrift?.driftDetected ?? false}, risk=${summary.sandboxGovernance.lastCloseoutStabilityDrift?.driftRiskDetected ?? false}, source=${summary.sandboxGovernance.lastCloseoutStabilityDrift?.driftSource ?? "none"}, severity=${summary.sandboxGovernance.lastCloseoutStabilityDrift?.driftSeverity ?? "none"}, next=${summary.sandboxGovernance.lastCloseoutStabilityDrift?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout reopen recurrence: status=${summary.sandboxGovernance.lastCloseoutReopenRecurrence?.latestReopenStatus ?? "none"}, count=${summary.sandboxGovernance.lastCloseoutReopenRecurrence?.reopenCount ?? 0}, active=${summary.sandboxGovernance.lastCloseoutReopenRecurrence?.reopenRecurrenceActive ?? false}, severity=${summary.sandboxGovernance.lastCloseoutReopenRecurrence?.recurrenceSeverity ?? "none"}, next=${summary.sandboxGovernance.lastCloseoutReopenRecurrence?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout stability watchlist: status=${summary.sandboxGovernance.lastCloseoutStabilityWatchlist?.watchlistStatus ?? "none"}, stable=${summary.sandboxGovernance.lastCloseoutStabilityWatchlist?.stableFinalComplete ?? false}, driftRisk=${summary.sandboxGovernance.lastCloseoutStabilityWatchlist?.driftRiskFlag ?? false}, reopenRecurrence=${summary.sandboxGovernance.lastCloseoutStabilityWatchlist?.reopenRecurrenceFlag ?? false}, next=${summary.sandboxGovernance.lastCloseoutStabilityWatchlist?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout stability recurrence audit: driftCount=${summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit?.driftOccurrenceCount ?? 0}, reopenCount=${summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit?.reopenRecurrenceCount ?? 0}, watchlistReAdd=${summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit?.watchlistReAddCount ?? 0}, active=${summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit?.recurrenceRemainsActive ?? false}, severity=${summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit?.recurrenceSeverity ?? "none"}, next=${summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout watchlist resolution: status=${summary.sandboxGovernance.lastCloseoutWatchlistResolutionSummary?.resolutionStatus ?? "none"}, canResolve=${summary.sandboxGovernance.lastCloseoutWatchlistResolutionSummary?.watchlistCanBeResolved ?? false}, retained=${summary.sandboxGovernance.lastCloseoutWatchlistResolutionSummary?.watchlistMustRemainRetained ?? false}, readded=${summary.sandboxGovernance.lastCloseoutWatchlistResolutionSummary?.watchlistWasReAdded ?? false}, next=${summary.sandboxGovernance.lastCloseoutWatchlistResolutionSummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout watchlist lifecycle: status=${summary.sandboxGovernance.lastCloseoutWatchlistLifecycle?.lifecycleStatus ?? "none"}, active=${summary.sandboxGovernance.lastCloseoutWatchlistLifecycle?.watchlistActive ?? false}, retained=${summary.sandboxGovernance.lastCloseoutWatchlistLifecycle?.watchlistRetained ?? false}, resolved=${summary.sandboxGovernance.lastCloseoutWatchlistLifecycle?.watchlistResolved ?? false}, reAdded=${summary.sandboxGovernance.lastCloseoutWatchlistLifecycle?.watchlistReAdded ?? false}, next=${summary.sandboxGovernance.lastCloseoutWatchlistLifecycle?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout watchlist exit audit: status=${summary.sandboxGovernance.lastCloseoutWatchlistExitAudit?.exitStatus ?? "none"}, allowed=${summary.sandboxGovernance.lastCloseoutWatchlistExitAudit?.exitAllowed ?? false}, removed=${summary.sandboxGovernance.lastCloseoutWatchlistExitAudit?.caseRemovedFromWatchlist ?? false}, reopenable=${summary.sandboxGovernance.lastCloseoutWatchlistExitAudit?.caseRemainsReopenable ?? false}, recovered=${summary.sandboxGovernance.lastCloseoutWatchlistExitAudit?.caseTreatedAsRecovered ?? false}, next=${summary.sandboxGovernance.lastCloseoutWatchlistExitAudit?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout watchlist re-add history: count=${summary.sandboxGovernance.lastCloseoutWatchlistReaddHistory?.reAddCount ?? 0}, latestReason=${summary.sandboxGovernance.lastCloseoutWatchlistReaddHistory?.latestReAddReason ?? "none"}, severity=${summary.sandboxGovernance.lastCloseoutWatchlistReaddHistory?.recurrenceSeverity ?? "none"}, next=${summary.sandboxGovernance.lastCloseoutWatchlistReaddHistory?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout stability recovery: status=${summary.sandboxGovernance.lastCloseoutStabilityRecoverySummary?.recoveryStatus ?? "none"}, achieved=${summary.sandboxGovernance.lastCloseoutStabilityRecoverySummary?.recoveryAchieved ?? false}, provisional=${summary.sandboxGovernance.lastCloseoutStabilityRecoverySummary?.recoveryProvisional ?? false}, blocked=${summary.sandboxGovernance.lastCloseoutStabilityRecoverySummary?.recoveryBlocked ?? false}, reopenable=${summary.sandboxGovernance.lastCloseoutStabilityRecoverySummary?.caseRecoveredButReopenable ?? false}, next=${summary.sandboxGovernance.lastCloseoutStabilityRecoverySummary?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout recovery confidence: level=${summary.sandboxGovernance.lastCloseoutRecoveryConfidence?.recoveryConfidenceLevel ?? "none"}, high=${summary.sandboxGovernance.lastCloseoutRecoveryConfidence?.recoveryHighConfidence ?? false}, provisional=${summary.sandboxGovernance.lastCloseoutRecoveryConfidence?.recoveryProvisional ?? false}, low=${summary.sandboxGovernance.lastCloseoutRecoveryConfidence?.recoveryLowConfidence ?? false}, reopenable=${summary.sandboxGovernance.lastCloseoutRecoveryConfidence?.caseRemainsReopenable ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveryConfidence?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout recovery regression audit: status=${summary.sandboxGovernance.lastCloseoutRecoveryRegressionAudit?.latestRegressionStatus ?? "none"}, detected=${summary.sandboxGovernance.lastCloseoutRecoveryRegressionAudit?.regressionDetected ?? false}, severity=${summary.sandboxGovernance.lastCloseoutRecoveryRegressionAudit?.regressionSeverity ?? "none"}, count=${summary.sandboxGovernance.lastCloseoutRecoveryRegressionAudit?.regressionCount ?? 0}, next=${summary.sandboxGovernance.lastCloseoutRecoveryRegressionAudit?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout recovered monitoring queue: status=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringQueue?.queueStatus ?? "none"}, recovered=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringQueue?.recovered ?? false}, confidence=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringQueue?.recoveryConfidenceLevel ?? "none"}, regressionRisk=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringQueue?.regressionRiskFlag ?? false}, reopenable=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringQueue?.reopenableFlag ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringQueue?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout recovery confidence trend: trend=${summary.sandboxGovernance.lastCloseoutRecoveryConfidenceTrend?.confidenceTrend ?? "none"}, latest=${summary.sandboxGovernance.lastCloseoutRecoveryConfidenceTrend?.latestRecoveryConfidenceLevel ?? "none"}, previous=${summary.sandboxGovernance.lastCloseoutRecoveryConfidenceTrend?.previousRecoveryConfidenceLevel ?? "none"}, unresolved=${summary.sandboxGovernance.lastCloseoutRecoveryConfidenceTrend?.trendRemainsUnresolved ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveryConfidenceTrend?.recommendedNextOperatorStep ?? "none"}`,
    `Closeout regression resolution summary: status=${summary.sandboxGovernance.lastCloseoutRegressionResolutionSummary?.regressionResolutionStatus ?? "none"}, resolved=${summary.sandboxGovernance.lastCloseoutRegressionResolutionSummary?.regressionResolved ?? false}, provisional=${summary.sandboxGovernance.lastCloseoutRegressionResolutionSummary?.regressionProvisionallyResolved ?? false}, active=${summary.sandboxGovernance.lastCloseoutRegressionResolutionSummary?.regressionRemainsActive ?? false}, next=${summary.sandboxGovernance.lastCloseoutRegressionResolutionSummary?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovered monitoring exit audit: status=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringExitAudit?.monitoringExitStatus ?? "none"}, allowed=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringExitAudit?.monitoringExitAllowed ?? false}, leavesQueue=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringExitAudit?.caseLeavesMonitoringQueue ?? false}, monitoringComplete=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringExitAudit?.caseRecoveredAndMonitoringComplete ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveredMonitoringExitAudit?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovery clearance audit: status=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceAudit?.recoveryClearanceStatus ?? "none"}, allowed=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceAudit?.recoveryClearanceAllowed ?? false}, cleared=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceAudit?.caseClearedFromGovernanceMonitoring ?? false}, reopenable=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceAudit?.caseRemainsReopenable ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceAudit?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovery clearance history: latest=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceHistory?.latestClearanceStatus ?? "none"}, latestEntry=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceHistory?.latestClearanceAuditEntry?.recoveryClearanceStatus ?? "none"}, previousEntry=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceHistory?.previousClearanceAuditEntry?.recoveryClearanceStatus ?? "none"}, reenterPatterns=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceHistory?.repeatedClearanceThenReEnterPatterns.join("|") || "none"}, regressedPatterns=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceHistory?.repeatedClearanceThenRegressedPatterns.join("|") || "none"}, next=${summary.sandboxGovernance.lastCloseoutRecoveryClearanceHistory?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovered exit history: exits=${summary.sandboxGovernance.lastCloseoutRecoveredExitHistory?.exitCount ?? 0}, reentries=${summary.sandboxGovernance.lastCloseoutRecoveredExitHistory?.reEntryCount ?? 0}, severity=${summary.sandboxGovernance.lastCloseoutRecoveredExitHistory?.historySeverity ?? "none"}, latestExit=${summary.sandboxGovernance.lastCloseoutRecoveredExitHistory?.latestExitEntry?.pattern ?? "none"}, latestReentry=${summary.sandboxGovernance.lastCloseoutRecoveredExitHistory?.latestReEntryEntry?.pattern ?? "none"}, next=${summary.sandboxGovernance.lastCloseoutRecoveredExitHistory?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovered lifecycle: status=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycle?.lifecycleStatus ?? "none"}, monitored=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycle?.caseMonitored ?? false}, cleared=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycle?.caseCleared ?? false}, reentered=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycle?.caseHasReEnteredGovernance ?? false}, regressed=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycle?.caseHasRegressed ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycle?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovered re-entry audit: status=${summary.sandboxGovernance.lastCloseoutRecoveredReentryAudit?.latestReentryStatus ?? "none"}, detected=${summary.sandboxGovernance.lastCloseoutRecoveredReentryAudit?.reentryDetected ?? false}, source=${summary.sandboxGovernance.lastCloseoutRecoveredReentryAudit?.reentrySource ?? "none"}, severity=${summary.sandboxGovernance.lastCloseoutRecoveredReentryAudit?.reentrySeverity ?? "none"}, active=${summary.sandboxGovernance.lastCloseoutRecoveredReentryAudit?.reentryRemainsActive ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveredReentryAudit?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovered lifecycle history: latest=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycleHistory?.latestLifecycleStatus ?? "none"}, previous=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycleHistory?.previousLifecycleEntry?.lifecycleStatus ?? "none"}, transitions=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycleHistory?.lifecycleTransitionSummary.join("|") || "none"}, retained=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycleHistory?.historyRetainedEntryCount ?? 0}, next=${summary.sandboxGovernance.lastCloseoutRecoveredLifecycleHistory?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovery retirement audit: status=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementAudit?.recoveryRetirementStatus ?? "none"}, allowed=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementAudit?.retirementAllowed ?? false}, leavesActive=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementAudit?.caseLeavesActiveGovernance ?? false}, reopenable=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementAudit?.caseRemainsReopenable ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementAudit?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovered retirement summary: ready=${summary.sandboxGovernance.lastCloseoutRecoveredRetirementSummary?.retirementReady ?? false}, provisional=${summary.sandboxGovernance.lastCloseoutRecoveredRetirementSummary?.retirementProvisional ?? false}, blocked=${summary.sandboxGovernance.lastCloseoutRecoveredRetirementSummary?.retirementBlocked ?? false}, stillActive=${summary.sandboxGovernance.lastCloseoutRecoveredRetirementSummary?.caseRecoveredButStillActive ?? false}, retireable=${summary.sandboxGovernance.lastCloseoutRecoveredRetirementSummary?.caseRecoveredAndRetireable ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveredRetirementSummary?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovery retirement queue: status=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementQueue?.queueStatus ?? "none"}, recovered=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementQueue?.recovered ?? false}, ready=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementQueue?.retirementReady ?? false}, regressionRisk=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementQueue?.regressionRiskFlag ?? false}, reentryRisk=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementQueue?.reentryRiskFlag ?? false}, next=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementQueue?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout recovery retirement history: latest=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementHistory?.latestRetirementStatus ?? "none"}, retained=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementHistory?.historyRetainedEntryCount ?? 0}, retiredThenReentered=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementHistory?.repeatedRetiredThenReenteredPatterns.join(" | ") || "none"}, retiredThenRegressed=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementHistory?.repeatedRetiredThenRegressedPatterns.join(" | ") || "none"}, next=${summary.sandboxGovernance.lastCloseoutRecoveryRetirementHistory?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout retirement exit criteria: status=${summary.sandboxGovernance.lastCloseoutRetirementExitCriteria?.retirementExitCriteriaStatus ?? "none"}, met=${summary.sandboxGovernance.lastCloseoutRetirementExitCriteria?.retirementCriteriaMet ?? false}, strict=${summary.sandboxGovernance.lastCloseoutRetirementExitCriteria?.criteriaAreStrictPass ?? false}, provisional=${summary.sandboxGovernance.lastCloseoutRetirementExitCriteria?.criteriaAreProvisionalPass ?? false}, unmet=${summary.sandboxGovernance.lastCloseoutRetirementExitCriteria?.criteriaRemainUnmet ?? true}, next=${summary.sandboxGovernance.lastCloseoutRetirementExitCriteria?.recommendedNextOperatorStep ?? "none"}`,
      `Closeout retired-case audit history: latest=${summary.sandboxGovernance.lastCloseoutRetiredCaseAuditHistory?.latestPostRetirementStatus ?? "none"}, stable=${summary.sandboxGovernance.lastCloseoutRetiredCaseAuditHistory?.retiredCaseStateRemainsStable ?? false}, reentry=${summary.sandboxGovernance.lastCloseoutRetiredCaseAuditHistory?.latestReentryStatus ?? "none"}, regression=${summary.sandboxGovernance.lastCloseoutRetiredCaseAuditHistory?.latestRegressionStatus ?? "none"}, watchlistReadd=${summary.sandboxGovernance.lastCloseoutRetiredCaseAuditHistory?.latestWatchlistReaddStatus ?? "none"}, next=${summary.sandboxGovernance.lastCloseoutRetiredCaseAuditHistory?.recommendedNextOperatorStep ?? "none"}`,
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
  if (summary.sandboxGovernance.lastCloseoutDispositionSummary?.dispositionWarnings.length) {
    lines.push("Closeout disposition warnings:");
    for (const warning of summary.sandboxGovernance.lastCloseoutDispositionSummary.dispositionWarnings) {
      lines.push(`- ${warning}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutReviewLifecycle?.lifecycleReasons.length) {
    lines.push("Closeout review lifecycle reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutReviewLifecycle.lifecycleReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutReviewAuditTrail?.queueRetainedReasons.length) {
    lines.push("Closeout review audit retained reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutReviewAuditTrail.queueRetainedReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutReviewHistory?.repeatedQueueRetainedPatterns.length) {
    lines.push("Repeated closeout review retained patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutReviewHistory.repeatedQueueRetainedPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutReviewResolutionSummary?.unresolvedReviewReasons.length) {
    lines.push("Closeout review unresolved reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutReviewResolutionSummary.unresolvedReviewReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutSettlementAudit?.settlementBlockedReasons.length) {
    lines.push("Closeout settlement blocked reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutSettlementAudit.settlementBlockedReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutFollowupSummary?.followUpReasons.length) {
    lines.push("Closeout follow-up reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutFollowupSummary.followUpReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutFollowupQueue?.entries.length) {
    lines.push("Closeout follow-up queue:");
    for (const entry of summary.sandboxGovernance.lastCloseoutFollowupQueue.entries) {
      lines.push(`- ${entry.queuedAt ?? "none"} ${entry.queueStatus} -> ${entry.recommendedNextOperatorStep}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionAudit?.completionBlockedReasons.length) {
    lines.push("Closeout completion blocked reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutCompletionAudit.completionBlockedReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionSummary?.completionReasons.length) {
    lines.push("Closeout completion reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutCompletionSummary.completionReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionQueue?.entries.length) {
    lines.push("Closeout completion queue:");
    for (const entry of summary.sandboxGovernance.lastCloseoutCompletionQueue.entries) {
      lines.push(`- ${entry.queuedAt ?? "none"} ${entry.queueStatus} -> ${entry.recommendedNextOperatorStep}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionHistory?.repeatedRevertFromCompletePatterns.length) {
    lines.push("Repeated closeout completion revert patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutCompletionHistory.repeatedRevertFromCompletePatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionResolutionSummary?.unresolvedCompletionReasons.length) {
    lines.push("Closeout completion unresolved reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutCompletionResolutionSummary.unresolvedCompletionReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionCarryForwardQueue?.entries.length) {
    lines.push("Closeout completion carry-forward queue:");
    for (const entry of summary.sandboxGovernance.lastCloseoutCompletionCarryForwardQueue.entries) {
      lines.push(`- ${entry.queuedAt ?? "none"} ${entry.queueStatus} -> ${entry.recommendedNextOperatorStep}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionDispositionSummary?.dispositionWarnings.length) {
    lines.push("Closeout completion disposition warnings:");
    for (const warning of summary.sandboxGovernance.lastCloseoutCompletionDispositionSummary.dispositionWarnings) {
      lines.push(`- ${warning}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionLifecycle?.lifecycleReasons.length) {
    lines.push("Closeout completion lifecycle reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutCompletionLifecycle.lifecycleReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionDecisionAudit?.queueRetainedReasons.length) {
    lines.push("Closeout completion decision audit retained reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutCompletionDecisionAudit.queueRetainedReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionDecisionHistory?.repeatedKeepCarryForwardPatterns.length) {
    lines.push("Repeated closeout completion retained patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutCompletionDecisionHistory.repeatedKeepCarryForwardPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionDecisionHistory?.repeatedReopenCompletionPatterns.length) {
    lines.push("Repeated closeout completion reopened patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutCompletionDecisionHistory.repeatedReopenCompletionPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutCompletionFinalizationSummary?.unresolvedFinalizationReasons.length) {
    lines.push("Closeout completion finalization reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutCompletionFinalizationSummary.unresolvedFinalizationReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutFinalizationAuditHistory?.repeatedReopenedAfterFinalizationPatterns.length) {
    lines.push("Repeated closeout finalization reopened-after-finalization patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutFinalizationAuditHistory.repeatedReopenedAfterFinalizationPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutFinalizationAuditHistory?.repeatedRetainedAfterFinalizationPatterns.length) {
    lines.push("Repeated closeout finalization retained-after-finalization patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutFinalizationAuditHistory.repeatedRetainedAfterFinalizationPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutFinalizationStabilitySummary?.unresolvedStabilityReasons.length) {
    lines.push("Closeout finalization stability reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutFinalizationStabilitySummary.unresolvedStabilityReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutPostFinalizationFollowupQueue?.entries.length) {
    lines.push("Closeout post-finalization follow-up queue:");
    for (const entry of summary.sandboxGovernance.lastCloseoutPostFinalizationFollowupQueue.entries) {
      lines.push(`- ${entry.queuedAt ?? "none"} ${entry.queueStatus} -> ${entry.recommendedNextOperatorStep}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutStabilityDrift?.driftReasons.length) {
    lines.push("Closeout stability drift reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutStabilityDrift.driftReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutReopenRecurrence?.repeatedFinalizedThenReopenedPatterns.length) {
    lines.push("Repeated closeout reopen-after-finalization patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutReopenRecurrence.repeatedFinalizedThenReopenedPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutReopenRecurrence?.repeatedRetainedAfterReopenPatterns.length) {
    lines.push("Repeated closeout retained-after-reopen patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutReopenRecurrence.repeatedRetainedAfterReopenPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutStabilityWatchlist?.entries.length) {
    lines.push("Closeout stability watchlist:");
    for (const entry of summary.sandboxGovernance.lastCloseoutStabilityWatchlist.entries) {
      lines.push(`- ${entry.listedAt ?? "none"} ${entry.watchlistStatus} -> ${entry.recommendedNextOperatorStep}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit?.repeatedDriftPatterns.length) {
    lines.push("Repeated closeout stability drift patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit.repeatedDriftPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit?.repeatedWatchlistReAddedPatterns.length) {
    lines.push("Repeated closeout watchlist re-added patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutStabilityRecurrenceAudit.repeatedWatchlistReAddedPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutWatchlistResolutionSummary?.resolutionBlockedReasons.length) {
    lines.push("Closeout watchlist resolution blocked reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutWatchlistResolutionSummary.resolutionBlockedReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutWatchlistLifecycle?.lifecycleReasons.length) {
    lines.push("Closeout watchlist lifecycle reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutWatchlistLifecycle.lifecycleReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutWatchlistExitAudit?.exitBlockedReasons.length) {
    lines.push("Closeout watchlist exit audit blocked reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutWatchlistExitAudit.exitBlockedReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutWatchlistReaddHistory?.repeatedExitThenReopenPatterns.length) {
    lines.push("Closeout watchlist re-add exit-then-reopen patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutWatchlistReaddHistory.repeatedExitThenReopenPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutStabilityRecoverySummary?.recoveryWarnings.length) {
    lines.push("Closeout stability recovery warnings:");
    for (const warning of summary.sandboxGovernance.lastCloseoutStabilityRecoverySummary.recoveryWarnings) {
      lines.push(`- ${warning}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveryConfidence?.recoveryConfidenceBlockers.length) {
    lines.push("Closeout recovery confidence blockers:");
    for (const blocker of summary.sandboxGovernance.lastCloseoutRecoveryConfidence.recoveryConfidenceBlockers) {
      lines.push(`- ${blocker}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveryRegressionAudit?.repeatedRecoveredThenReopenedPatterns.length) {
    lines.push("Closeout recovery regression reopened patterns:");
    for (const pattern of summary.sandboxGovernance.lastCloseoutRecoveryRegressionAudit.repeatedRecoveredThenReopenedPatterns) {
      lines.push(`- ${pattern}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveredMonitoringQueue?.entries.length) {
    lines.push("Closeout recovered monitoring queue:");
    for (const entry of summary.sandboxGovernance.lastCloseoutRecoveredMonitoringQueue.entries) {
      lines.push(`- ${entry.queuedAt ?? "none"} ${entry.queueStatus} -> ${entry.recommendedNextOperatorStep}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveryConfidenceTrend?.confidenceTrendReasons.length) {
    lines.push("Closeout recovery confidence trend reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveryConfidenceTrend.confidenceTrendReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRegressionResolutionSummary?.regressionBlockers.length) {
    lines.push("Closeout regression resolution blockers:");
    for (const blocker of summary.sandboxGovernance.lastCloseoutRegressionResolutionSummary.regressionBlockers) {
      lines.push(`- ${blocker}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveredMonitoringExitAudit?.monitoringExitBlockedReasons.length) {
    lines.push("Closeout recovered monitoring exit audit blocked reasons:");
    for (const blocker of summary.sandboxGovernance.lastCloseoutRecoveredMonitoringExitAudit.monitoringExitBlockedReasons) {
      lines.push(`- ${blocker}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveryClearanceAudit?.recoveryClearanceBlockedReasons.length) {
    lines.push("Closeout recovery clearance audit blocked reasons:");
    for (const blocker of summary.sandboxGovernance.lastCloseoutRecoveryClearanceAudit.recoveryClearanceBlockedReasons) {
      lines.push(`- ${blocker}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveredExitHistory?.historyReasons.length) {
    lines.push("Closeout recovered exit history reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveredExitHistory.historyReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveredLifecycle?.lifecycleReasons.length) {
    lines.push("Closeout recovered lifecycle reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveredLifecycle.lifecycleReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveryClearanceHistory?.historyReasons.length) {
    lines.push("Closeout recovery clearance history reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveryClearanceHistory.historyReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveredReentryAudit?.reentryReasons.length) {
    lines.push("Closeout recovered re-entry audit reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveredReentryAudit.reentryReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveredLifecycleHistory?.historyReasons.length) {
    lines.push("Closeout recovered lifecycle history reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveredLifecycleHistory.historyReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveryRetirementAudit?.retirementBlockedReasons.length) {
    lines.push("Closeout recovery retirement audit blocked reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveryRetirementAudit.retirementBlockedReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveredRetirementSummary?.retirementWarnings.length) {
    lines.push("Closeout recovered retirement summary warnings:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveredRetirementSummary.retirementWarnings) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveryRetirementQueue?.retirementBlockedReasons.length) {
    lines.push("Closeout recovery retirement queue blocked reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveryRetirementQueue.retirementBlockedReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRecoveryRetirementHistory?.historyReasons.length) {
    lines.push("Closeout recovery retirement history reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRecoveryRetirementHistory.historyReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRetirementExitCriteria?.retirementCriteriaBlockers.length) {
    lines.push("Closeout retirement exit criteria blockers:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRetirementExitCriteria.retirementCriteriaBlockers) {
      lines.push(`- ${reason}`);
    }
  }
  if (summary.sandboxGovernance.lastCloseoutRetiredCaseAuditHistory?.auditReasons.length) {
    lines.push("Closeout retired-case audit history reasons:");
    for (const reason of summary.sandboxGovernance.lastCloseoutRetiredCaseAuditHistory.auditReasons) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push(`Next action: ${summary.nextSuggestedAction}`);
  return lines.join("\n");
}
