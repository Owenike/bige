import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagnosticsSummary, formatDiagnosticsSummary } from "../../src/diagnostics";
import { buildPrDraftMetadata } from "../../src/handoff";
import { createInitialState } from "../../src/orchestrator";
import { gptCodeAutomationStateSchema } from "../../src/schemas";

test("external recovery observability surfaces replay summaries through diagnostics and handoff", () => {
  const state = createInitialState({
    id: "external-recovery-observability-state",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Observe replay safety state",
    objective: "Render replay/recovery summaries for operators",
    subtasks: ["external-automation", "diagnostics", "handoff"],
    successCriteria: ["replay summaries are readable"],
  });
  state.lastExecutionReport = {
    iterationNumber: 1,
    changedFiles: ["tools/orchestrator/src/gpt-code-external-automation/index.ts"],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: ["Added replay/recovery summaries."],
    whyThisWasDone: ["Operators need executable recoverability context."],
    howBehaviorWasKeptStable: ["Only orchestrator automation summaries changed."],
    localValidation: [],
    ciValidation: null,
    blockers: [],
    risks: [],
    recommendedNextStep: "Review replay eligibility.",
    shouldCloseSlice: false,
    artifacts: [],
  };
  state.lastGptCodeAutomationState = gptCodeAutomationStateSchema.parse({
    sourceAdapterStatus: "linked",
    sourceType: "github_pull_request_body",
    sourceLaneClassification: "github_pull_request_body_lane",
    sourceId: "github-pull-request-body:701",
    sourceCorrelationId: "inbound:delivery-observability",
    sourcePayloadPath: "C:/tmp/payload.json",
    sourceHeadersPath: "C:/tmp/headers.json",
    sourceReceivedAt: "2026-03-19T00:00:00.000Z",
    transportSource: "github_pull_request_body",
    intakeStatus: "accepted",
    bridgeStatus: "accepted",
    dispatchStatus: "dispatched",
    dispatchTarget: "github_issue_comment",
    dispatchOutcome: "exhausted",
    outputPayloadPath: "C:/tmp/output.json",
    nextInstructionPath: "C:/tmp/next.md",
    automaticTriggerStatus: "triggered",
    targetAdapterStatus: "exhausted",
    targetType: "github_issue_comment",
    targetLaneClassification: "github_live_smoke_comment_lane",
    targetDestination: "github://example/bige/issues/comments/61001",
    targetAttemptCount: 2,
    targetRetryCount: 1,
    targetMaxAttempts: 2,
    routingDecision: "live_smoke_target",
    fallbackDecision: "status_report_target_fallback",
    dispatchCorrelationId: "orchestrator-next-instruction:external-recovery-observability-state",
    lastTargetFailureClass: "network",
    dispatchHistorySummary: "#1 retryable github_live_smoke_comment_lane network | #2 exhausted github_status_report_comment_lane network",
    fallbackChainSummary: "Fallback chain: live_smoke_target => status_report_target",
    recoverabilitySummary: "External lane exhausted its safe retries; operator review is required before any further retry.",
    operatorHandoffSummary: "External target dispatch exhausted after 2/2 attempts. Tried 2/2 attempt(s). live_smoke_target => status_report_target Safe retry remaining: false. Next: Review the dispatch history and fallback chain, then decide whether a safe manual retry is still possible.",
    replayEligibility: "safe_to_replay",
    replayBlockReason: null,
    replayAttemptCount: 1,
    lastReplayAction: "replay",
    lastReplayOutcome: "manual_required",
    recoveryHistorySummary: "recovery#1 replay -> manual_required at 2026-03-19T00:00:02.000Z",
    operatorRecoveryRecommendation: "External lane can be replayed once under operator control; reuse the existing next instruction and re-check the routed target.",
    canRetryDispatch: false,
    dispatchExhausted: true,
    dispatchReliabilityOutcome: "exhausted",
    externalAutomationOutcome: "manual_required",
    recommendedNextStep: "Review the dispatch history and fallback chain, then decide whether a safe manual retry is still possible.",
    manualReviewReason: "External target dispatch exhausted after 2/2 attempts.",
  });

  const diagnostics = formatDiagnosticsSummary(buildDiagnosticsSummary(state));
  const draft = buildPrDraftMetadata({
    state,
    branchName: null,
    payloadPath: null,
    githubHandoffStatus: "skipped",
    githubHandoffReason: "metadata only",
    createdAt: "2026-03-19T00:00:03.000Z",
  });

  assert.equal(diagnostics.includes("External automation recovery history:"), true);
  assert.equal(diagnostics.includes("External automation recovery recommendation:"), true);
  assert.equal(draft.body.includes("External recovery:"), true);
  assert.equal(draft.approvalNotes.some((note) => note.includes("externalRecoveryHistory=")), true);
});
