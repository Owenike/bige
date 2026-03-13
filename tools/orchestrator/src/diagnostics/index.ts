import type { OrchestratorState, PreflightResult } from "../schemas";

export type OrchestratorDiagnostics = {
  stateId: string;
  status: OrchestratorState["status"];
  iterationNumber: number;
  profileId: string;
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
    patchStatus: string;
    promotionStatus: string;
    handoffStatus: string;
    prDraftStatus: string;
    liveAcceptanceStatus: string;
    livePassStatus: string;
    workspaceStatus: string;
  };
  nextSuggestedAction: string;
};

function resolveNextSuggestedAction(state: OrchestratorState, preflight: PreflightResult | null) {
  if (preflight?.blockedReasons.length) {
    return preflight.blockedReasons[0]?.suggestedNextAction ?? "Resolve the first blocked prerequisite.";
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
      patchStatus: state.patchStatus,
      promotionStatus: state.promotionStatus,
      handoffStatus: state.handoffStatus,
      prDraftStatus: state.prDraftStatus,
      liveAcceptanceStatus: state.liveAcceptanceStatus,
      livePassStatus: state.livePassStatus,
      workspaceStatus: state.workspaceStatus,
    },
    nextSuggestedAction: resolveNextSuggestedAction(state, preflight),
  } satisfies OrchestratorDiagnostics;
}

export function formatDiagnosticsSummary(summary: OrchestratorDiagnostics) {
  const lines = [
    `State: ${summary.stateId}`,
    `Status: ${summary.status} (iteration ${summary.iterationNumber}, profile ${summary.profileId})`,
    `Planner: ${summary.plannerSummary}`,
    `Reviewer: ${summary.reviewerSummary}`,
    `Last iteration: ${summary.lastIterationSummary}`,
    `Artifacts: patch=${summary.artifactSummary.patchStatus}, promotion=${summary.artifactSummary.promotionStatus}, handoff=${summary.artifactSummary.handoffStatus}, prDraft=${summary.artifactSummary.prDraftStatus}, liveAcceptance=${summary.artifactSummary.liveAcceptanceStatus}, livePass=${summary.artifactSummary.livePassStatus}, workspace=${summary.artifactSummary.workspaceStatus}`,
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
