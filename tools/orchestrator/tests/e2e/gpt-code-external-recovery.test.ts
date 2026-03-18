import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import {
  runGptCodeExternalAutomationFromWebhook,
  runGptCodeExternalAutomationRecovery,
} from "../../src/gpt-code-external-automation";
import { completedSliceReport } from "../unit/helpers/gpt-code-report-fixtures";

test("a GitHub lane can move from exhausted delivery to operator replay success without re-running transport", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-recovery-e2e-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = {
    ...createInitialState({
      id: "external-recovery-e2e-state",
      repoPath,
      repoName: "bige",
      userGoal: "Recover an exhausted GitHub lane",
      objective: "Move from exhausted delivery into a safe operator replay",
      subtasks: ["external-source", "recoverability", "replay"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["operator replay succeeds without re-running transport"],
      autoMode: true,
      approvalMode: "auto",
    }),
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 55,
      prNumber: null,
      commentId: 9955,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_comment_created from example/bige#55",
    },
  };
  await dependencies.storage.saveState(state);

  let exhaustedAttempts = 0;
  const initial = await runGptCodeExternalAutomationFromWebhook({
    payload: {
      action: "created",
      issue: {
        number: 55,
        title: "Recovery replay e2e",
      },
      comment: {
        id: 9955,
        body: completedSliceReport,
      },
      repository: {
        full_name: "example/bige",
      },
    },
    deliveryId: "delivery-recovery-e2e",
    payloadPath: "C:/tmp/recovery-e2e-payload.json",
    headersPath: "C:/tmp/recovery-e2e-headers.json",
    receivedAt: "2026-03-19T00:00:00.000Z",
    dependencies,
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      maxAttempts: 2,
      async dispatchNextInstruction() {
        exhaustedAttempts += 1;
        return {
          stateId: state.id,
          targetType: "github_issue_comment",
          targetLaneClassification: "github_issue_thread_comment_lane",
          targetDestination: "github://example/bige/issues/55/comments",
          routingDecision: "state_thread_target",
          fallbackDecision: "not_needed",
          attemptCount: exhaustedAttempts,
          retryCount: Math.max(exhaustedAttempts - 1, 0),
          maxAttempts: 2,
          outcome: "retryable",
          retryEligible: true,
          failureClass: "network",
          correlationId: "orchestrator-next-instruction:external-recovery-e2e-state",
          externalReferenceId: null,
          externalUrl: null,
          routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/55/comments | retryable | network"],
          deliverySummary: `Attempt ${exhaustedAttempts}/2 ended as retryable (network)`,
          manualReviewReason: "External target dispatch is retryable.",
          recommendedNextStep: "Retry the external target dispatch or inspect the target health before retrying.",
          exhausted: false,
          dispatchArtifactPath: path.join(storageRoot, `initial-dispatch-${exhaustedAttempts}.json`),
          dispatchedAt: `2026-03-19T00:00:0${exhaustedAttempts}.000Z`,
        };
      },
    },
  });
  const afterInitial = await dependencies.storage.loadState(state.id);

  assert.equal(initial?.outcome, "exhausted");
  assert.equal(afterInitial?.lastGptCodeAutomationState?.dispatchExhausted, true);

  const recovered = await runGptCodeExternalAutomationRecovery({
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
          correlationId: "orchestrator-next-instruction:external-recovery-e2e-state",
          externalReferenceId: "30055",
          externalUrl: "https://github.com/example/bige/issues/55#issuecomment-30055",
          routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/55/comments | success | ok"],
          deliverySummary: "Attempt 3/2 delivered to github_issue_thread_comment_lane.",
          manualReviewReason: null,
          recommendedNextStep: "Wait for the external target response or the next GPT CODE report.",
          exhausted: false,
          dispatchArtifactPath: path.join(storageRoot, "recovery-dispatch-3.json"),
          dispatchedAt: "2026-03-19T00:00:03.000Z",
        };
      },
    },
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(recovered.outcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.lastReplayAction, "replay");
  assert.equal(updated?.lastGptCodeAutomationState?.lastReplayOutcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.replayAttemptCount, 1);
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchHistorySummary?.includes("#3 success"), true);
});
