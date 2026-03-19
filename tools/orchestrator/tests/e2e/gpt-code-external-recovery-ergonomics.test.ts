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

test("operator recovery ergonomics can inspect an exhausted GitHub lane, recommend replay, and refresh summaries after recovery succeeds", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-recovery-ergonomics-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = {
    ...createInitialState({
      id: "external-recovery-ergonomics-state",
      repoPath,
      repoName: "bige",
      userGoal: "Inspect and recover a retryable GitHub lane",
      objective: "Use inspect before resume and persist the updated summaries",
      subtasks: ["external-automation", "recovery-ergonomics"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["operator recommendations update after recovery"],
      autoMode: true,
      approvalMode: "auto",
    }),
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 77,
      prNumber: null,
      commentId: 9977,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_comment_created from example/bige#77",
    },
  };
  await dependencies.storage.saveState(state);

  let initialAttempts = 0;
  const initial = await runGptCodeExternalAutomationFromWebhook({
    payload: {
      action: "created",
      issue: {
        number: 77,
        title: "Recovery ergonomics e2e",
      },
      comment: {
        id: 9977,
        body: completedSliceReport,
      },
      repository: {
        full_name: "example/bige",
      },
    },
    deliveryId: "delivery-recovery-ergonomics",
    payloadPath: "C:/tmp/recovery-ergonomics-payload.json",
    headersPath: "C:/tmp/recovery-ergonomics-headers.json",
    receivedAt: "2026-03-19T00:00:00.000Z",
    dependencies,
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      maxAttempts: 2,
      async dispatchNextInstruction() {
        initialAttempts += 1;
        return {
          stateId: state.id,
          targetType: "github_issue_comment",
          targetLaneClassification: "github_issue_thread_comment_lane",
          targetDestination: "github://example/bige/issues/77/comments",
          routingDecision: "state_thread_target",
          fallbackDecision: "not_needed",
          attemptCount: initialAttempts,
          retryCount: 0,
          maxAttempts: 2,
          outcome: "retryable",
          retryEligible: true,
          failureClass: "transient",
          correlationId: "orchestrator-next-instruction:external-recovery-ergonomics-state",
          externalReferenceId: null,
          externalUrl: null,
          routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/77/comments | retryable | transient"],
          deliverySummary: "Attempt 1/2 ended as retryable (transient)",
          manualReviewReason: "External target dispatch is retryable after attempt 1/2.",
          recommendedNextStep: "Retry the external target dispatch or inspect the target health before retrying.",
          exhausted: false,
          dispatchArtifactPath: path.join(storageRoot, "retryable-dispatch.json"),
          dispatchedAt: "2026-03-19T00:00:01.000Z",
        };
      },
    },
  });

  assert.equal(initial?.outcome, "exhausted");

  const inspected = await runGptCodeExternalAutomationRecovery({
    stateId: state.id,
    dependencies,
    requestedAction: "inspect",
  });

  assert.equal(inspected.outcome, "not_run");
  assert.equal(inspected.recoveryQueueClassification, "replayable");
  assert.equal(inspected.operatorActionRecommendation?.includes("--action replay"), true);

  const resumed = await runGptCodeExternalAutomationRecovery({
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
          targetDestination: "github://example/bige/issues/77/comments",
          routingDecision: "state_thread_target",
          fallbackDecision: "not_needed",
          attemptCount: 2,
          retryCount: 1,
          maxAttempts: 2,
          outcome: "success",
          retryEligible: false,
          failureClass: null,
          correlationId: "orchestrator-next-instruction:external-recovery-ergonomics-state",
          externalReferenceId: "77002",
          externalUrl: "https://github.com/example/bige/issues/77#issuecomment-77002",
          routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/77/comments | success | ok"],
          deliverySummary: "Attempt 2/2 delivered to github_issue_thread_comment_lane.",
          manualReviewReason: null,
          recommendedNextStep: "Wait for the external target response or the next GPT CODE report.",
          exhausted: false,
          dispatchArtifactPath: path.join(storageRoot, "recovery-success.json"),
          dispatchedAt: "2026-03-19T00:00:02.000Z",
        };
      },
    },
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(resumed.outcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.recoveryQueueClassification, "not_applicable");
  assert.equal(updated?.lastGptCodeAutomationState?.recentRecoveryHistory.some((entry) => entry.includes("replay")), true);
  assert.equal(updated?.lastGptCodeAutomationState?.recoveryAuditSummary?.includes("queue=not_applicable"), true);
});
