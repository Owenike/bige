import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationRecovery } from "../../src/gpt-code-external-automation";
import { gptCodeAutomationStateSchema } from "../../src/schemas";

test("operator recovery can replay an exhausted GitHub lane once and persist the replay outcome", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-recovery-path-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const nextInstructionPath = path.join(storageRoot, "next-instruction.md");
  const outputPayloadPath = path.join(storageRoot, "output-payload.json");
  await writeFile(nextInstructionPath, "operator replay\n", "utf8");
  await writeFile(outputPayloadPath, "{}\n", "utf8");

  const state = createInitialState({
    id: "external-recovery-path-state",
    repoPath,
    repoName: "bige",
    userGoal: "Replay an exhausted GitHub lane",
    objective: "Allow operator-controlled replay when the lane is exhausted but still safely recoverable",
    subtasks: ["external-automation", "recovery-path"],
    successCriteria: ["replay outcome is persisted"],
    autoMode: true,
    approvalMode: "auto",
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
    sourceCorrelationId: "inbound:delivery-recovery-path",
    sourcePayloadPath: "C:/tmp/payload.json",
    sourceHeadersPath: "C:/tmp/headers.json",
    sourceReceivedAt: "2026-03-19T00:00:00.000Z",
    transportSource: "github_issue_comment",
    intakeStatus: "accepted",
    bridgeStatus: "accepted",
    dispatchStatus: "dispatched",
    dispatchTarget: "github_issue_comment",
    dispatchOutcome: "exhausted",
    outputPayloadPath,
    nextInstructionPath,
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
    dispatchCorrelationId: "orchestrator-next-instruction:external-recovery-path-state",
    lastTargetFailureClass: "network",
    dispatchExhausted: true,
    dispatchReliabilityOutcome: "exhausted",
    externalAutomationOutcome: "exhausted",
    manualReviewReason: "External target dispatch exhausted after 2/2 attempts.",
  });
  await dependencies.storage.saveState(state);

  const result = await runGptCodeExternalAutomationRecovery({
    stateId: state.id,
    dependencies,
    requestedAction: "replay",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      maxAttempts: 2,
      async dispatchNextInstruction() {
        return {
          stateId: state.id,
          targetType: "github_issue_comment",
          targetLaneClassification: "github_issue_thread_comment_lane",
          targetDestination: "github://example/bige/issues/55/comments",
          routingDecision: "state_thread_target",
          fallbackDecision: "not_needed",
          attemptCount: 3,
          retryCount: 2,
          maxAttempts: 2,
          outcome: "success",
          retryEligible: false,
          failureClass: null,
          correlationId: "orchestrator-next-instruction:external-recovery-path-state",
          externalReferenceId: "30055",
          externalUrl: "https://github.com/example/bige/issues/55#issuecomment-30055",
          routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/55/comments | success | ok"],
          deliverySummary: "Attempt 3/2 delivered to github_issue_thread_comment_lane.",
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

  assert.equal(result.replayEligibility, "not_evaluated");
  assert.equal(result.resolvedAction, "replay");
  assert.equal(result.outcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.recoveryQueueClassification, "not_applicable");
  assert.equal(updated?.lastGptCodeAutomationState?.lastReplayAction, "replay");
  assert.equal(updated?.lastGptCodeAutomationState?.lastReplayOutcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.replayAttemptCount, 1);
  assert.equal(updated?.lastGptCodeAutomationState?.recoveryHistorySummary?.includes("recovery#1 replay -> success"), true);
});
