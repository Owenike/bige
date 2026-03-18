import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationRecovery } from "../../src/gpt-code-external-automation";
import { gptCodeAutomationStateSchema } from "../../src/schemas";

test("recovery resume follows the remaining retry policy and records the recovery attempt", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-retry-policy-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const nextInstructionPath = path.join(storageRoot, "next-instruction.md");
  const outputPayloadPath = path.join(storageRoot, "output-payload.json");
  await writeFile(nextInstructionPath, "resume retry policy\n", "utf8");
  await writeFile(outputPayloadPath, "{}\n", "utf8");

  const state = createInitialState({
    id: "external-retry-policy-state",
    repoPath,
    repoName: "bige",
    userGoal: "Resume a retryable GitHub lane",
    objective: "Turn a retryable GitHub dispatch into a concrete recovery execution policy",
    subtasks: ["external-automation", "retry-policy"],
    successCriteria: ["resume uses the remaining retry budget safely"],
    autoMode: true,
    approvalMode: "auto",
  });
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
    sourceCorrelationId: "inbound:delivery-retry-policy",
    sourcePayloadPath: "C:/tmp/payload.json",
    sourceHeadersPath: "C:/tmp/headers.json",
    sourceReceivedAt: "2026-03-19T00:00:00.000Z",
    transportSource: "github_issue_comment",
    intakeStatus: "accepted",
    bridgeStatus: "accepted",
    dispatchStatus: "dispatched",
    dispatchTarget: "github_issue_comment",
    dispatchOutcome: "retryable",
    outputPayloadPath,
    nextInstructionPath,
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
    dispatchCorrelationId: "orchestrator-next-instruction:external-retry-policy-state",
    lastTargetFailureClass: "network",
    canRetryDispatch: true,
    dispatchReliabilityOutcome: "retryable",
    externalAutomationOutcome: "retryable",
    manualReviewReason: "External target dispatch is retryable after attempt 1/3.",
  });
  await dependencies.storage.saveState(state);

  let calls = 0;
  const result = await runGptCodeExternalAutomationRecovery({
    stateId: state.id,
    dependencies,
    requestedAction: "resume",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      maxAttempts: 3,
      async dispatchNextInstruction() {
        calls += 1;
        if (calls === 1) {
          return {
            stateId: state.id,
            targetType: "github_issue_comment",
            targetLaneClassification: "github_issue_thread_comment_lane",
            targetDestination: "github://example/bige/issues/44/comments",
            routingDecision: "state_thread_target",
            fallbackDecision: "not_needed",
            attemptCount: 2,
            retryCount: 1,
            maxAttempts: 3,
            outcome: "retryable",
            retryEligible: true,
            failureClass: "network",
            correlationId: "orchestrator-next-instruction:external-retry-policy-state",
            externalReferenceId: null,
            externalUrl: null,
            routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/44/comments | retryable | network"],
            deliverySummary: "Attempt 2/3 ended as retryable (network)",
            manualReviewReason: "External target dispatch is retryable after attempt 2/3.",
            recommendedNextStep: "Retry the external target dispatch or inspect the target health before retrying.",
            exhausted: false,
            dispatchArtifactPath: path.join(storageRoot, "dispatch-attempt-2.json"),
            dispatchedAt: "2026-03-19T00:00:02.000Z",
          };
        }
        return {
          stateId: state.id,
          targetType: "github_issue_comment",
          targetLaneClassification: "github_issue_thread_comment_lane",
          targetDestination: "github://example/bige/issues/44/comments",
          routingDecision: "state_thread_target",
          fallbackDecision: "not_needed",
          attemptCount: 3,
          retryCount: 2,
          maxAttempts: 3,
          outcome: "success",
          retryEligible: false,
          failureClass: null,
          correlationId: "orchestrator-next-instruction:external-retry-policy-state",
          externalReferenceId: "30003",
          externalUrl: "https://github.com/example/bige/issues/44#issuecomment-30003",
          routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/44/comments | success | ok"],
          deliverySummary: "Attempt 3/3 delivered to github_issue_thread_comment_lane.",
          manualReviewReason: null,
          recommendedNextStep: "Wait for the external target response or the next GPT CODE report.",
          exhausted: false,
          dispatchArtifactPath: path.join(storageRoot, "dispatch-attempt-3.json"),
          dispatchedAt: "2026-03-19T00:00:03.000Z",
        };
      },
    },
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(result.outcome, "success");
  assert.equal(calls, 2);
  assert.equal(updated?.lastGptCodeAutomationState?.lastReplayAction, "resume");
  assert.equal(updated?.lastGptCodeAutomationState?.lastReplayOutcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.replayAttemptCount, 1);
  assert.equal(updated?.lastGptCodeAutomationState?.targetAttemptCount, 3);
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchHistorySummary?.includes("resume:1"), true);
});
