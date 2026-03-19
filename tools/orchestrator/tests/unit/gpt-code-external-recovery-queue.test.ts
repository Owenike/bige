import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationRecovery } from "../../src/gpt-code-external-automation";
import { gptCodeAutomationStateSchema } from "../../src/schemas";

async function buildStateWithAutomation(id: string, automation: Record<string, unknown>) {
  const storageRoot = await mkdtemp(path.join(tmpdir(), `${id}-`));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id,
    repoPath,
    repoName: "bige",
    userGoal: "Inspect recovery queue classification",
    objective: "Persist recovery inbox ergonomics",
    subtasks: ["external-automation", "recovery-queue"],
    successCriteria: ["queue classification is explicit"],
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
  state.lastGptCodeAutomationState = gptCodeAutomationStateSchema.parse(automation);
  await dependencies.storage.saveState(state);
  return { dependencies, stateId: state.id };
}

test("recovery inspect classifies a retryable GitHub lane as resumable in the operator queue summary", async () => {
  const { dependencies, stateId } = await buildStateWithAutomation("external-recovery-queue-resumable", {
    sourceAdapterStatus: "linked",
    sourceType: "github_issue_comment",
    sourceLaneClassification: "github_issue_comment_lane",
    sourceId: "github-comment:9911",
    sourceCorrelationId: "inbound:delivery-queue-resumable",
    sourcePayloadPath: "C:/tmp/payload.json",
    sourceHeadersPath: "C:/tmp/headers.json",
    sourceReceivedAt: "2026-03-19T00:00:00.000Z",
    transportSource: "github_issue_comment",
    intakeStatus: "accepted",
    bridgeStatus: "accepted",
    dispatchStatus: "dispatched",
    dispatchTarget: "github_issue_comment",
    dispatchOutcome: "retryable",
    outputPayloadPath: "C:/tmp/output.json",
    nextInstructionPath: "C:/tmp/next.md",
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
    dispatchCorrelationId: "orchestrator-next-instruction:external-recovery-queue-resumable",
    targetExternalReferenceId: null,
    targetExternalUrl: null,
    targetDispatchArtifactPath: "C:/tmp/dispatch.json",
    lastTargetFailureClass: "network",
    dispatchAttemptHistory: [],
    canRetryDispatch: true,
    dispatchExhausted: false,
    dispatchReliabilityOutcome: "retryable",
    externalAutomationOutcome: "retryable",
    recommendedNextStep: "Retry the external target dispatch.",
    manualReviewReason: "External target dispatch is retryable after attempt 1/3.",
  });

  const inspected = await runGptCodeExternalAutomationRecovery({
    stateId,
    dependencies,
    requestedAction: "inspect",
  });
  const updated = await dependencies.storage.loadState(stateId);

  assert.equal(inspected.outcome, "not_run");
  assert.equal(inspected.recoveryQueueClassification, "resumable");
  assert.equal(updated?.lastGptCodeAutomationState?.recoveryQueueClassification, "resumable");
  assert.equal(updated?.lastGptCodeAutomationState?.resumeRecommendation?.includes("Recommended: resume"), true);
});

test("recovery inspect classifies a blocked manual lane as manual_required in the operator queue summary", async () => {
  const { dependencies, stateId } = await buildStateWithAutomation("external-recovery-queue-manual", {
    sourceAdapterStatus: "linked",
    sourceType: "github_issue_comment",
    sourceLaneClassification: "github_issue_comment_lane",
    sourceId: "github-comment:9955",
    sourceCorrelationId: "inbound:delivery-queue-manual",
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
    dispatchCorrelationId: "orchestrator-next-instruction:external-recovery-queue-manual",
    manualReviewReason: "Bridge confidence is too low for automatic external dispatch.",
  });

  const inspected = await runGptCodeExternalAutomationRecovery({
    stateId,
    dependencies,
    requestedAction: "inspect",
  });

  assert.equal(inspected.recoveryQueueClassification, "manual_required");
  assert.equal(inspected.operatorActionRecommendation?.includes("Manual review only"), true);
});
