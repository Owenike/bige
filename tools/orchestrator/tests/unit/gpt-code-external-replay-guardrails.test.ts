import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationRecovery } from "../../src/gpt-code-external-automation";
import { gptCodeAutomationStateSchema } from "../../src/schemas";

test("replay guardrails block recovery when the dispatch correlation no longer matches the state", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-replay-guardrails-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const nextInstructionPath = path.join(storageRoot, "next-instruction.md");
  const outputPayloadPath = path.join(storageRoot, "output-payload.json");
  await writeFile(nextInstructionPath, "guardrail replay\n", "utf8");
  await writeFile(outputPayloadPath, "{}\n", "utf8");

  const state = createInitialState({
    id: "external-replay-guardrails-state",
    repoPath,
    repoName: "bige",
    userGoal: "Block unsafe replay",
    objective: "Refuse replay when the recovery safety guardrails fail",
    subtasks: ["external-automation", "guardrails"],
    successCriteria: ["unsafe replay is blocked"],
    autoMode: true,
    approvalMode: "auto",
  });
  state.sourceEventSummary = {
    repository: "example/bige",
    branch: "main",
    issueNumber: 99,
    prNumber: null,
    commentId: 9999,
    label: null,
    headSha: null,
    command: null,
    triggerReason: "issue_comment_created from example/bige#99",
  };
  state.lastGptCodeAutomationState = gptCodeAutomationStateSchema.parse({
    sourceAdapterStatus: "linked",
    sourceType: "github_issue_comment",
    sourceLaneClassification: "github_issue_comment_lane",
    sourceId: "github-comment:9999",
    sourceCorrelationId: "inbound:delivery-guardrails",
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
    targetDestination: "github://example/bige/issues/99/comments",
    targetAttemptCount: 1,
    targetRetryCount: 0,
    targetMaxAttempts: 2,
    routingDecision: "state_thread_target",
    fallbackDecision: "not_needed",
    dispatchCorrelationId: "orchestrator-next-instruction:some-other-state",
    lastTargetFailureClass: "network",
    canRetryDispatch: true,
    dispatchReliabilityOutcome: "retryable",
    externalAutomationOutcome: "retryable",
  });
  await dependencies.storage.saveState(state);

  let called = false;
  const result = await runGptCodeExternalAutomationRecovery({
    stateId: state.id,
    dependencies,
    requestedAction: "auto",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      async dispatchNextInstruction() {
        called = true;
        throw new Error("should not dispatch");
      },
    },
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(called, false);
  assert.equal(result.outcome, "blocked");
  assert.equal(updated?.lastGptCodeAutomationState?.replayEligibility, "blocked");
  assert.equal(updated?.lastGptCodeAutomationState?.replayBlockReason?.includes("correlation"), true);
});
