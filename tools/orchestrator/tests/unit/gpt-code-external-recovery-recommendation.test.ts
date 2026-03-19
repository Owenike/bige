import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationRecovery } from "../../src/gpt-code-external-automation";
import { gptCodeAutomationStateSchema } from "../../src/schemas";

test("recovery inspect surfaces replay and resume recommendations without executing dispatch", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "external-recovery-recommendation-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "external-recovery-recommendation",
    repoPath,
    repoName: "bige",
    userGoal: "Inspect recovery recommendations",
    objective: "Summarize safe replay and resume options",
    subtasks: ["external-automation", "recommendation"],
    successCriteria: ["recommendations are explicit"],
  });
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
    sourceCorrelationId: "inbound:delivery-recommendation",
    sourcePayloadPath: "C:/tmp/payload.json",
    sourceHeadersPath: "C:/tmp/headers.json",
    sourceReceivedAt: "2026-03-19T00:00:00.000Z",
    transportSource: "github_issue_comment",
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
    targetLaneClassification: "github_issue_thread_comment_lane",
    targetDestination: "github://example/bige/issues/55/comments",
    targetAttemptCount: 2,
    targetRetryCount: 1,
    targetMaxAttempts: 2,
    routingDecision: "state_thread_target",
    fallbackDecision: "not_needed",
    dispatchCorrelationId: "orchestrator-next-instruction:external-recovery-recommendation",
    lastTargetFailureClass: "network",
    dispatchAttemptHistory: [
      {
        attemptCount: 1,
        retryCount: 0,
        recoveryAction: "none",
        recoveryAttemptCount: 0,
        targetLaneClassification: "github_issue_thread_comment_lane",
        targetDestination: "github://example/bige/issues/55/comments",
        routingDecision: "state_thread_target",
        fallbackDecision: "not_needed",
        outcome: "retryable",
        retryEligible: true,
        failureClass: "network",
        externalReferenceId: null,
        externalUrl: null,
        dispatchedAt: "2026-03-19T00:00:01.000Z",
        routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/55/comments | retryable | network"],
        deliverySummary: "Attempt 1/2 ended as retryable (network)",
      },
      {
        attemptCount: 2,
        retryCount: 1,
        recoveryAction: "none",
        recoveryAttemptCount: 0,
        targetLaneClassification: "github_issue_thread_comment_lane",
        targetDestination: "github://example/bige/issues/55/comments",
        routingDecision: "state_thread_target",
        fallbackDecision: "not_needed",
        outcome: "exhausted",
        retryEligible: false,
        failureClass: "network",
        externalReferenceId: null,
        externalUrl: null,
        dispatchedAt: "2026-03-19T00:00:02.000Z",
        routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/55/comments | exhausted | network"],
        deliverySummary: "Attempt 2/2 exhausted after retryable failures",
      },
    ],
    dispatchExhausted: true,
    dispatchReliabilityOutcome: "exhausted",
    externalAutomationOutcome: "exhausted",
    recommendedNextStep: "Review the dispatch history and fallback chain.",
    manualReviewReason: "External target dispatch exhausted after 2/2 attempts.",
  });
  await dependencies.storage.saveState(state);

  const inspected = await runGptCodeExternalAutomationRecovery({
    stateId: state.id,
    dependencies,
    requestedAction: "inspect",
  });

  assert.equal(inspected.outcome, "not_run");
  assert.equal(inspected.recoveryQueueClassification, "replayable");
  assert.equal(inspected.replayRecommendation?.includes("Recommended: replay once"), true);
  assert.equal(inspected.resumeRecommendation?.includes("Not recommended"), true);
  assert.equal(inspected.operatorActionRecommendation?.includes("--action replay"), true);
});
