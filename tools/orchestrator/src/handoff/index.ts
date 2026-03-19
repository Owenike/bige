import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { OrchestratorState, PrDraftMetadata } from "../schemas";
import { buildPromotionMetadata, exportPatchBundle, preparePromotionBranch, validatePatchPromotionPreconditions } from "../promotion";

function collectValidationSummary(state: OrchestratorState) {
  return (state.lastExecutionReport?.localValidation ?? []).map((validation) => {
    const outputSuffix = validation.output ? ` (${validation.output})` : "";
    return `${validation.command}: ${validation.status}${outputSuffix}`;
  });
}

function collectPlannerSummary(state: OrchestratorState) {
  if (!state.plannerDecision) return state.task.objective;
  return [state.plannerDecision.objective, ...state.plannerDecision.subtasks].join(" | ");
}

function collectReviewerSummary(state: OrchestratorState) {
  if (!state.lastReviewVerdict) return "Reviewer verdict unavailable.";
  return [state.lastReviewVerdict.verdict, ...state.lastReviewVerdict.reasons].join(" | ");
}

function collectKnownRisks(state: OrchestratorState) {
  const risks = [...(state.lastExecutionReport?.risks ?? [])];
  if (state.lastGptCodeAutomationState?.dispatchExhausted) {
    risks.push("External automation dispatch exhausted the configured retries.");
  }
  if (state.lastGptCodeAutomationState?.manualReviewReason) {
    risks.push(state.lastGptCodeAutomationState.manualReviewReason);
  }
  if (state.lastGptCodeAutomationState?.replayBlockReason) {
    risks.push(state.lastGptCodeAutomationState.replayBlockReason);
  }
  if (state.lastGptCodeAutomationState?.repeatedFailurePattern) {
    risks.push(state.lastGptCodeAutomationState.repeatedFailurePattern);
  }
  return risks;
}

function collectApprovalNotes(state: OrchestratorState) {
  const notes: string[] = [];
  notes.push(`approvalStatus=${state.approvalStatus}`);
  notes.push(`patchStatus=${state.patchStatus}`);
  notes.push(`promotionStatus=${state.promotionStatus}`);
  if (state.lastGptCodeAutomationState?.dispatchHistorySummary) {
    notes.push(`externalDispatchHistory=${state.lastGptCodeAutomationState.dispatchHistorySummary}`);
  }
  if (state.lastGptCodeAutomationState?.fallbackChainSummary) {
    notes.push(`externalFallback=${state.lastGptCodeAutomationState.fallbackChainSummary}`);
  }
  if (state.lastGptCodeAutomationState?.recoverabilitySummary) {
    notes.push(`externalRecoverability=${state.lastGptCodeAutomationState.recoverabilitySummary}`);
  }
  if (state.lastGptCodeAutomationState?.operatorHandoffSummary) {
    notes.push(`externalHandoff=${state.lastGptCodeAutomationState.operatorHandoffSummary}`);
  }
  if (state.lastGptCodeAutomationState?.recoveryQueueClassification) {
    notes.push(`externalRecoveryQueue=${state.lastGptCodeAutomationState.recoveryQueueClassification}`);
  }
  if (state.lastGptCodeAutomationState?.recoveryAuditSummary) {
    notes.push(`externalRecoveryAudit=${state.lastGptCodeAutomationState.recoveryAuditSummary}`);
  }
  if (state.lastGptCodeAutomationState?.recoveryHistorySummary) {
    notes.push(`externalRecoveryHistory=${state.lastGptCodeAutomationState.recoveryHistorySummary}`);
  }
  if (state.lastGptCodeAutomationState?.operatorRecoveryRecommendation) {
    notes.push(`externalRecoveryRecommendation=${state.lastGptCodeAutomationState.operatorRecoveryRecommendation}`);
  }
  if (state.lastGptCodeAutomationState?.operatorActionRecommendation) {
    notes.push(`externalOperatorAction=${state.lastGptCodeAutomationState.operatorActionRecommendation}`);
  }
  if (state.stopReason) {
    notes.push(`stopReason=${state.stopReason}`);
  }
  return notes;
}

export function validateHandoffPreconditions(state: OrchestratorState) {
  const issues = validatePatchPromotionPreconditions(state);
  if (!state.lastExecutionReport) {
    issues.push("Handoff requires an execution report.");
  }
  if (state.livePassStatus !== "passed") {
    issues.push("Handoff requires a completed live pass.");
  }
  if (state.approvalStatus !== "approved") {
    issues.push("Handoff requires an approved patch.");
  }
  return [...new Set(issues)];
}

export function buildPrDraftMetadata(params: {
  state: OrchestratorState;
  branchName: string | null;
  payloadPath: string | null;
  githubHandoffStatus: "not_requested" | "skipped" | "payload_ready" | "failed";
  githubHandoffReason: string | null;
  createdAt: string;
}): PrDraftMetadata {
  const report = params.state.lastExecutionReport;
  return {
    title: `orchestrator: handoff ${params.state.id} iteration ${report?.iterationNumber ?? 0}`,
    body: [
      `Objective: ${params.state.plannerDecision?.objective ?? params.state.task.objective}`,
      `Branch: ${params.branchName ?? "not published"}`,
      `Changed files: ${report?.changedFiles.join(", ") || "none"}`,
      `Reviewer: ${collectReviewerSummary(params.state)}`,
      `Validation: ${collectValidationSummary(params.state).join(" | ") || "none"}`,
      `External automation: ${params.state.lastGptCodeAutomationState?.operatorHandoffSummary ?? "none"}`,
      `External recovery queue: ${params.state.lastGptCodeAutomationState?.recoveryQueueClassification ?? "none"}`,
      `External recovery audit: ${params.state.lastGptCodeAutomationState?.recoveryAuditSummary ?? "none"}`,
      `External recovery: ${params.state.lastGptCodeAutomationState?.operatorRecoveryRecommendation ?? "none"}`,
      `External operator action: ${params.state.lastGptCodeAutomationState?.operatorActionRecommendation ?? "none"}`,
    ].join("\n"),
    changeSummary: report?.summaryOfChanges ?? [],
    validationSummary: collectValidationSummary(params.state),
    knownRisks: collectKnownRisks(params.state),
    approvalNotes: collectApprovalNotes(params.state),
    branchName: params.branchName,
    payloadPath: params.payloadPath,
    githubHandoffStatus: params.githubHandoffStatus,
    githubHandoffReason: params.githubHandoffReason,
    createdAt: params.createdAt,
  };
}

export async function createHandoffPackage(params: {
  state: OrchestratorState;
  outputRoot: string;
  publishBranch?: boolean;
  createBranch?: boolean;
  githubHandoffEnabled?: boolean;
}) {
  const issues = validateHandoffPreconditions(params.state);
  if (issues.length > 0) {
    return {
      status: "handoff_failed" as const,
      issues,
      artifactPaths: [] as string[],
      handoffPackagePath: null as string | null,
      prDraftPath: null as string | null,
      branchName: null as string | null,
      githubHandoffStatus: "skipped" as const,
      githubHandoffReason: issues.join(" | "),
      summary: "Handoff preconditions failed.",
    };
  }

  const report = params.state.lastExecutionReport!;
  const createdAt = new Date().toISOString();
  const exportBundle = await exportPatchBundle({
    state: params.state,
    exportRoot: params.outputRoot,
  });
  const branchPrep = await preparePromotionBranch({
    state: params.state,
    createBranch: params.publishBranch ? (params.createBranch ?? true) : false,
  });

  const handoffDir = path.join(params.outputRoot, params.state.id, `iteration-${report.iterationNumber}`);
  await mkdir(handoffDir, { recursive: true });

  const handoffPackagePath = path.join(handoffDir, "handoff-package.json");
  const githubPayloadPath = path.join(handoffDir, "github-draft-payload.json");

  const githubHandoffStatus =
    params.githubHandoffEnabled === true
      ? "payload_ready"
      : "skipped";
  const githubHandoffReason =
    params.githubHandoffEnabled === true
      ? "Draft PR payload prepared."
      : "GitHub handoff was not enabled; metadata only was generated.";

  const prDraft = buildPrDraftMetadata({
    state: params.state,
    branchName: branchPrep.branchName,
    payloadPath: githubPayloadPath,
    githubHandoffStatus,
    githubHandoffReason,
    createdAt,
  });

  const packagePayload = {
    createdAt,
    taskId: params.state.id,
    iterationNumber: report.iterationNumber,
    patchExportPath: exportBundle.patchExportPath,
    manifestPath: exportBundle.manifestPath,
    branchName: branchPrep.branchName,
    branchCreated: branchPrep.branchCreated,
    branchReason: branchPrep.branchReason,
    changedFiles: report.changedFiles,
    validationSummary: collectValidationSummary(params.state),
    plannerDecisionSummary: collectPlannerSummary(params.state),
    reviewerVerdictSummary: collectReviewerSummary(params.state),
    promotionStatus: params.state.promotionStatus,
    workspacePath: buildPromotionMetadata(params.state).workspacePath,
    diffPath: buildPromotionMetadata(params.state).diffPath,
    prDraft,
  };

  await writeFile(handoffPackagePath, `${JSON.stringify(packagePayload, null, 2)}\n`, "utf8");
  await writeFile(githubPayloadPath, `${JSON.stringify(prDraft, null, 2)}\n`, "utf8");

  const status: "branch_published" | "handoff_ready" =
    params.publishBranch && branchPrep.branchCreated ? "branch_published" : "handoff_ready";
  const summary =
    status === "branch_published"
      ? `Handoff package prepared and branch ${branchPrep.branchName} published.`
      : "Handoff package prepared for human review.";

  return {
    status,
    issues: [] as string[],
    artifactPaths: [exportBundle.patchExportPath, exportBundle.manifestPath, handoffPackagePath, githubPayloadPath],
    handoffPackagePath,
    prDraftPath: githubPayloadPath,
    branchName: branchPrep.branchName,
    githubHandoffStatus,
    githubHandoffReason,
    summary,
  };
}
