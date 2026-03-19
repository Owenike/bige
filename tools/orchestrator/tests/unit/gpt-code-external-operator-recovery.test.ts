import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationRecovery } from "../../src/gpt-code-external-automation";
import { gptCodeAutomationStateSchema } from "../../src/schemas";

test("operator recovery ergonomics return a clearer block reason and next action for manual_required lanes", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "external-operator-recovery-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "external-operator-recovery",
    repoPath,
    repoName: "bige",
    userGoal: "Inspect operator recovery ergonomics",
    objective: "Surface a clearer recovery input/output for manual review cases",
    subtasks: ["external-automation", "operator-ergonomics"],
    successCriteria: ["block reasons and next steps are explicit"],
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
    sourceCorrelationId: "inbound:delivery-operator",
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
    dispatchCorrelationId: "orchestrator-next-instruction:external-operator-recovery",
    manualReviewReason: "Bridge confidence is too low for automatic external dispatch.",
  });
  await dependencies.storage.saveState(state);

  const inspected = await runGptCodeExternalAutomationRecovery({
    stateId: state.id,
    dependencies,
    requestedAction: "inspect",
  });

  assert.equal(inspected.outcome, "not_run");
  assert.equal(inspected.replayBlockReason?.includes("Transport/bridge artifacts"), true);
  assert.equal(inspected.operatorActionRecommendation?.includes("--action inspect"), true);
  assert.equal(inspected.recoveryQueueClassification, "manual_required");
});
