import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationFromWebhook } from "../../src/gpt-code-external-automation";
import { completedSliceReport } from "./helpers/gpt-code-report-fixtures";

test("external automation trigger can intake a GitHub report comment and auto-dispatch to an external target", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-trigger-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = {
    ...createInitialState({
      id: "external-trigger-state",
      repoPath,
      repoName: "bige",
      userGoal: "Auto trigger from external source",
      objective: "Process a GitHub report comment without manual transport submit",
      subtasks: ["external-source", "external-target", "trigger"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["external trigger dispatches automatically"],
      autoMode: true,
      approvalMode: "auto",
    }),
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 44,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#44",
    },
  };
  await dependencies.storage.saveState(state);

  const result = await runGptCodeExternalAutomationFromWebhook({
    payload: {
      action: "created",
      issue: {
        number: 44,
        title: "Transport MVP",
      },
      comment: {
        id: 9911,
        body: completedSliceReport,
      },
      repository: {
        full_name: "example/bige",
      },
    },
    deliveryId: "delivery-report-trigger",
    payloadPath: "C:/tmp/report-payload.json",
    headersPath: "C:/tmp/report-headers.json",
    receivedAt: "2026-03-18T00:00:00.000Z",
    dependencies,
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      async dispatchNextInstruction() {
        return {
          stateId: state.id,
          targetType: "github_issue_comment",
          targetLaneClassification: "github_issue_thread_comment_lane",
          targetDestination: "github://example/bige/issues/44/comments",
          routingDecision: "state_thread_target",
          fallbackDecision: "not_needed",
          attemptCount: 1,
          retryCount: 0,
          maxAttempts: 2,
          outcome: "success",
          retryEligible: false,
          failureClass: null,
          correlationId: "orchestrator-next-instruction:external-trigger-state",
          externalReferenceId: "20001",
          externalUrl: "https://github.com/example/bige/issues/44#issuecomment-20001",
          routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/44/comments | success | ok"],
          deliverySummary: "Attempt 1/2 delivered to github_issue_thread_comment_lane.",
          manualReviewReason: null,
          recommendedNextStep: "Wait for the external target response or the next GPT CODE report.",
          exhausted: false,
          dispatchArtifactPath: "C:/tmp/external-target-dispatch.json",
          dispatchedAt: "2026-03-18T00:00:01.000Z",
        };
      },
    },
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(result?.outcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.sourceAdapterStatus, "linked");
  assert.equal(updated?.lastGptCodeAutomationState?.automaticTriggerStatus, "triggered");
  assert.equal(updated?.lastGptCodeAutomationState?.targetAdapterStatus, "dispatched");
  assert.equal(updated?.lastGptCodeAutomationState?.sourceLaneClassification, "github_issue_comment_lane");
  assert.equal(updated?.lastGptCodeAutomationState?.targetLaneClassification, "github_issue_thread_comment_lane");
  assert.equal(updated?.lastGptCodeAutomationState?.routingDecision, "state_thread_target");
  assert.equal(updated?.lastGptCodeAutomationState?.fallbackDecision, "not_needed");
  assert.equal(updated?.lastGptCodeAutomationState?.externalAutomationOutcome, "success");
});
