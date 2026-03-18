import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationFromWebhook } from "../../src/gpt-code-external-automation";
import { completedSliceReport } from "./helpers/gpt-code-report-fixtures";

test("external automation retries a retryable target dispatch and records reliability metadata", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-reliability-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = {
    ...createInitialState({
      id: "external-reliability-state",
      repoPath,
      repoName: "bige",
      userGoal: "Track retryable external dispatch",
      objective: "Retry a transient external target failure once and persist reliability facts",
      subtasks: ["external-source", "retry", "dispatch-reliability"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["retry metadata is persisted"],
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

  let attempts = 0;
  const result = await runGptCodeExternalAutomationFromWebhook({
    payload: {
      action: "created",
      issue: {
        number: 44,
        title: "Retryable external dispatch",
      },
      comment: {
        id: 9944,
        body: completedSliceReport,
      },
      repository: {
        full_name: "example/bige",
      },
    },
    deliveryId: "delivery-report-retry",
    payloadPath: "C:/tmp/report-retry-payload.json",
    headersPath: "C:/tmp/report-retry-headers.json",
    receivedAt: "2026-03-18T00:00:00.000Z",
    dependencies,
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      maxAttempts: 2,
      async dispatchNextInstruction() {
        attempts += 1;
        if (attempts === 1) {
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
            outcome: "retryable",
            retryEligible: true,
            failureClass: "transient",
            correlationId: "orchestrator-next-instruction:external-reliability-state",
            externalReferenceId: null,
            externalUrl: null,
            dispatchArtifactPath: "C:/tmp/external-retry-attempt-1.json",
            dispatchedAt: "2026-03-18T00:00:01.000Z",
          };
        }
        return {
          stateId: state.id,
          targetType: "github_issue_comment",
          targetLaneClassification: "github_issue_thread_comment_lane",
          targetDestination: "github://example/bige/issues/44/comments",
          routingDecision: "state_thread_target",
          fallbackDecision: "not_needed",
          attemptCount: 2,
          retryCount: 1,
          maxAttempts: 2,
          outcome: "success",
          retryEligible: false,
          failureClass: null,
          correlationId: "orchestrator-next-instruction:external-reliability-state",
          externalReferenceId: "40001",
          externalUrl: "https://github.com/example/bige/issues/44#issuecomment-40001",
          dispatchArtifactPath: "C:/tmp/external-retry-attempt-2.json",
          dispatchedAt: "2026-03-18T00:00:02.000Z",
        };
      },
    },
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(result?.outcome, "success");
  assert.equal(attempts, 2);
  assert.equal(updated?.lastGptCodeAutomationState?.targetAttemptCount, 2);
  assert.equal(updated?.lastGptCodeAutomationState?.targetRetryCount, 1);
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchReliabilityOutcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.targetAdapterStatus, "dispatched");
});

test("external automation retains lane-specific retry metadata for a pull request body source routed through the live smoke target lane", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-live-smoke-reliability-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = {
    ...createInitialState({
      id: "external-live-smoke-reliability-state",
      repoPath,
      repoName: "bige",
      userGoal: "Track retryable live smoke dispatch",
      objective: "Retry a transient live smoke target failure once and persist lane-specific reliability facts",
      subtasks: ["external-source", "retry", "dispatch-reliability"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["retry metadata is persisted for the live smoke lane"],
      autoMode: true,
      approvalMode: "auto",
    }),
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: null,
      prNumber: 78,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "pull_request_opened from example/bige#78",
    },
  };
  await dependencies.storage.saveState(state);

  let attempts = 0;
  const result = await runGptCodeExternalAutomationFromWebhook({
    payload: {
      action: "opened",
      pull_request: {
        id: 78,
        number: 78,
        title: "Retryable live smoke external dispatch",
        body: completedSliceReport,
        updated_at: "2026-03-18T00:00:00.000Z",
      },
      repository: {
        full_name: "example/bige",
      },
    },
    deliveryId: "delivery-report-live-smoke-retry",
    payloadPath: "C:/tmp/report-live-smoke-retry-payload.json",
    headersPath: "C:/tmp/report-live-smoke-retry-headers.json",
    receivedAt: "2026-03-18T00:00:00.000Z",
    dependencies,
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      maxAttempts: 2,
      async dispatchNextInstruction() {
        attempts += 1;
        if (attempts === 1) {
          return {
            stateId: state.id,
            targetType: "github_issue_comment",
            targetLaneClassification: "github_live_smoke_comment_lane",
            targetDestination: "github://example/bige/issues/comments/61001",
            routingDecision: "live_smoke_target",
            fallbackDecision: "not_needed",
            attemptCount: 1,
            retryCount: 0,
            maxAttempts: 2,
            outcome: "retryable",
            retryEligible: true,
            failureClass: "transient",
            correlationId: "orchestrator-next-instruction:external-live-smoke-reliability-state",
            externalReferenceId: "61001",
            externalUrl: "https://github.com/example/bige/pull/78#issuecomment-61001",
            dispatchArtifactPath: "C:/tmp/external-live-smoke-retry-attempt-1.json",
            dispatchedAt: "2026-03-18T00:00:01.000Z",
          };
        }
        return {
          stateId: state.id,
          targetType: "github_issue_comment",
          targetLaneClassification: "github_live_smoke_comment_lane",
          targetDestination: "github://example/bige/issues/comments/61001",
          routingDecision: "live_smoke_target",
          fallbackDecision: "not_needed",
          attemptCount: 2,
          retryCount: 1,
          maxAttempts: 2,
          outcome: "success",
          retryEligible: false,
          failureClass: null,
          correlationId: "orchestrator-next-instruction:external-live-smoke-reliability-state",
          externalReferenceId: "61001",
          externalUrl: "https://github.com/example/bige/pull/78#issuecomment-61001",
          dispatchArtifactPath: "C:/tmp/external-live-smoke-retry-attempt-2.json",
          dispatchedAt: "2026-03-18T00:00:02.000Z",
        };
      },
    },
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(result?.outcome, "success");
  assert.equal(attempts, 2);
  assert.equal(updated?.lastGptCodeAutomationState?.sourceLaneClassification, "github_pull_request_body_lane");
  assert.equal(updated?.lastGptCodeAutomationState?.targetLaneClassification, "github_live_smoke_comment_lane");
  assert.equal(updated?.lastGptCodeAutomationState?.routingDecision, "live_smoke_target");
  assert.equal(updated?.lastGptCodeAutomationState?.targetAttemptCount, 2);
  assert.equal(updated?.lastGptCodeAutomationState?.targetRetryCount, 1);
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchReliabilityOutcome, "success");
});
