import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { evaluateGptCodeExternalAutomationReplayEligibility } from "../../src/gpt-code-external-automation";
import { gptCodeAutomationStateSchema } from "../../src/schemas";

function buildState(id: string) {
  return createInitialState({
    id,
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Evaluate replay eligibility",
    objective: "Classify whether a GitHub external lane can be replayed or resumed safely",
    subtasks: ["external-automation", "replay-eligibility"],
    successCriteria: ["eligibility is explicit"],
  });
}

test("replay eligibility classifies retryable GitHub lanes as safe_to_resume when the current target still matches", () => {
  const state = buildState("external-replay-eligibility-resume");
  state.sourceEventSummary = {
    repository: "example/bige",
    branch: "main",
    issueNumber: 44,
    prNumber: null,
    commentId: 9911,
    label: null,
    headSha: null,
    command: null,
    triggerReason: "issue_comment_created from example/bige#44",
  };
  state.lastGptCodeAutomationState = gptCodeAutomationStateSchema.parse({
    sourceAdapterStatus: "linked",
    sourceType: "github_issue_comment",
    sourceLaneClassification: "github_issue_comment_lane",
    sourceId: "github-comment:9911",
    sourceCorrelationId: "inbound:delivery-replay-eligibility",
    sourcePayloadPath: "C:/tmp/payload.json",
    sourceHeadersPath: "C:/tmp/headers.json",
    sourceReceivedAt: "2026-03-19T00:00:00.000Z",
    transportSource: "github_issue_comment",
    intakeStatus: "accepted",
    bridgeStatus: "accepted",
    dispatchStatus: "dispatched",
    dispatchTarget: "github_issue_comment",
    dispatchOutcome: "retryable",
    outputPayloadPath: path.join(process.cwd(), ".tmp", "output.json"),
    nextInstructionPath: path.join(process.cwd(), ".tmp", "instruction.md"),
    automaticTriggerStatus: "triggered",
    targetAdapterStatus: "retryable",
    targetType: "github_issue_comment",
    targetLaneClassification: "github_issue_thread_comment_lane",
    targetDestination: "github://example/bige/issues/44/comments",
    targetAttemptCount: 1,
    targetRetryCount: 0,
    targetMaxAttempts: 3,
    routingDecision: "state_thread_target",
    fallbackDecision: "not_needed",
    dispatchCorrelationId: "orchestrator-next-instruction:external-replay-eligibility-resume",
    targetExternalReferenceId: null,
    lastTargetFailureClass: "network",
    canRetryDispatch: true,
    dispatchReliabilityOutcome: "retryable",
    externalAutomationOutcome: "retryable",
    recommendedNextStep: "Retry the external target dispatch or inspect the target health before retrying.",
    manualReviewReason: "External target dispatch is retryable after attempt 1/3.",
  });

  const decision = evaluateGptCodeExternalAutomationReplayEligibility({
    state,
    requestedAction: "auto",
  });

  assert.equal(decision.replayEligibility, "safe_to_resume");
  assert.equal(decision.resolvedAction, "resume");
  assert.equal(decision.targetAvailable, true);
  assert.equal(decision.correlationConsistent, true);
  assert.equal(decision.externalReferenceConsistent, true);
});

test("replay eligibility keeps pre-dispatch manual_required GitHub lanes in manual_only", () => {
  const state = buildState("external-replay-eligibility-manual");
  state.sourceEventSummary = {
    repository: "example/bige",
    branch: "main",
    issueNumber: 55,
    prNumber: null,
    commentId: 9955,
    label: null,
    headSha: null,
    command: null,
    triggerReason: "issue_comment_created from example/bige#55",
  };
  state.lastGptCodeAutomationState = gptCodeAutomationStateSchema.parse({
    sourceAdapterStatus: "linked",
    sourceType: "github_issue_comment",
    sourceLaneClassification: "github_issue_comment_lane",
    sourceId: "github-comment:9955",
    sourceCorrelationId: "inbound:delivery-replay-eligibility-manual",
    sourcePayloadPath: "C:/tmp/payload.json",
    sourceHeadersPath: "C:/tmp/headers.json",
    sourceReceivedAt: "2026-03-19T00:00:00.000Z",
    transportSource: "github_issue_comment",
    intakeStatus: "accepted",
    bridgeStatus: "needs_manual_review",
    dispatchStatus: "manual_required",
    dispatchTarget: "github_issue_comment",
    dispatchOutcome: "manual_required",
    automaticTriggerStatus: "triggered",
    targetAdapterStatus: "manual_required",
    targetType: "github_issue_comment",
    targetAttemptCount: 0,
    targetRetryCount: 0,
    targetMaxAttempts: 2,
    routingDecision: "manual_required",
    fallbackDecision: "manual_required",
    dispatchCorrelationId: "orchestrator-next-instruction:external-replay-eligibility-manual",
    manualReviewReason: "Bridge confidence is too low for automatic external dispatch.",
  });

  const decision = evaluateGptCodeExternalAutomationReplayEligibility({
    state,
    requestedAction: "auto",
  });

  assert.equal(decision.replayEligibility, "manual_only");
  assert.equal(decision.resolvedAction, "none");
  assert.equal(decision.replayBlockReason?.includes("Transport/bridge artifacts"), true);
});
