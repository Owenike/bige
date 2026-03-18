import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { ingestGitHubWebhook } from "../../src/webhook";
import { completedSliceReport } from "../unit/helpers/gpt-code-report-fixtures";

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

test("external source webhook can trigger transport, bridge, and external target dispatch end to end", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gpt-code-external-automation-e2e-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot: root,
    backendType: "file",
    backendFallbackType: "blocked",
    executorMode: "mock",
    workspaceRoot: path.join(root, "workspaces"),
  });
  const existing = {
    ...createInitialState({
      id: "external-e2e-state",
      repoPath,
      repoName: "bige",
      userGoal: "External automation e2e",
      objective: "Auto-run intake and external dispatch from a webhook comment report",
      subtasks: ["external-source", "bridge", "external-target"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["external automation path completes"],
      autoMode: true,
      approvalMode: "auto",
    }),
    sourceEventType: "pull_request_opened" as const,
    sourceEventId: "pr:44:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: null,
      prNumber: 44,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "pull_request_opened from example/bige#44",
    },
  };
  await dependencies.storage.saveState(existing);

  const rawBody = JSON.stringify({
    action: "created",
    pull_request: {
      id: 44,
      number: 44,
      title: "External automation e2e",
    },
    comment: {
      id: 93001,
      body: completedSliceReport,
    },
    repository: {
      full_name: "example/bige",
      name: "bige",
      default_branch: "main",
    },
    sender: {
      login: "orchestrator-runner",
      id: 1,
      type: "User",
    },
  });
  let attempts = 0;

  const result = await ingestGitHubWebhook({
    rawBody,
    headers: {
      "x-github-event": "pull_request_review_comment",
      "x-github-delivery": "delivery-external-automation",
      "x-hub-signature-256": sign(rawBody, "secret"),
    },
    secret: "secret",
    dependencies,
    repoPath,
    enqueue: false,
    reportStatus: false,
    statusAdapter: null,
    externalTargetAdapter: {
      kind: "github_issue_comment",
      maxAttempts: 2,
      async dispatchNextInstruction() {
        attempts += 1;
        if (attempts === 1) {
          return {
            stateId: existing.id,
            targetType: "github_issue_comment",
            targetLaneClassification: "github_pull_request_thread_comment_lane",
            targetDestination: "github://example/bige/issues/44/comments",
            routingDecision: "state_thread_target",
            fallbackDecision: "not_needed",
            attemptCount: 1,
            retryCount: 0,
            maxAttempts: 2,
            outcome: "retryable",
            retryEligible: true,
            failureClass: "transient",
            correlationId: "orchestrator-next-instruction:external-e2e-state",
            externalReferenceId: null,
            externalUrl: null,
            routeTrace: ["state_thread_target | github_pull_request_thread_comment_lane | github://example/bige/issues/44/comments | retryable | transient"],
            deliverySummary: "Attempt 1/2 ended as retryable (transient)",
            manualReviewReason: "External target dispatch is retryable after attempt 1/2.",
            recommendedNextStep: "Retry the external target dispatch or inspect the target health before retrying.",
            exhausted: false,
            dispatchArtifactPath: path.join(root, "external-target-dispatch-attempt-1.json"),
            dispatchedAt: "2026-03-18T00:00:01.000Z",
          };
        }
        return {
          stateId: existing.id,
          targetType: "github_issue_comment",
          targetLaneClassification: "github_pull_request_thread_comment_lane",
          targetDestination: "github://example/bige/issues/44/comments",
          routingDecision: "state_thread_target",
          fallbackDecision: "not_needed",
          attemptCount: 2,
          retryCount: 1,
          maxAttempts: 2,
          outcome: "success",
          retryEligible: false,
          failureClass: null,
          correlationId: "orchestrator-next-instruction:external-e2e-state",
          externalReferenceId: "30001",
          externalUrl: "https://github.com/example/bige/issues/44#issuecomment-30001",
          routeTrace: ["state_thread_target | github_pull_request_thread_comment_lane | github://example/bige/issues/44/comments | success | ok"],
          deliverySummary: "Attempt 2/2 delivered to github_pull_request_thread_comment_lane.",
          manualReviewReason: null,
          recommendedNextStep: "Wait for the external target response or the next GPT CODE report.",
          exhausted: false,
          dispatchArtifactPath: path.join(root, "external-target-dispatch-attempt-2.json"),
          dispatchedAt: "2026-03-18T00:00:02.000Z",
        };
      },
    },
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
    statusOutputRoot: path.join(root, "status"),
  });
  const updated = await dependencies.storage.loadState(existing.id);

  assert.equal(result.status, "routed");
  assert.equal(updated?.lastGptCodeAutomationState?.sourceType, "github_pull_request_review_comment");
  assert.equal(
    updated?.lastGptCodeAutomationState?.sourceLaneClassification,
    "github_pull_request_review_comment_lane",
  );
  assert.equal(updated?.lastGptCodeAutomationState?.automaticTriggerStatus, "triggered");
  assert.equal(updated?.lastGptCodeAutomationState?.targetAdapterStatus, "dispatched");
  assert.equal(
    updated?.lastGptCodeAutomationState?.targetLaneClassification,
    "github_pull_request_thread_comment_lane",
  );
  assert.equal(updated?.lastGptCodeAutomationState?.routingDecision, "state_thread_target");
  assert.equal(updated?.lastGptCodeAutomationState?.fallbackDecision, "not_needed");
  assert.equal(updated?.lastGptCodeAutomationState?.targetRetryCount, 1);
  assert.equal(updated?.lastGptCodeAutomationState?.externalAutomationOutcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchHistorySummary?.includes("#1 retryable"), true);
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchHistorySummary?.includes("#2 success"), true);
  assert.equal(updated?.lastGptCodeAutomationState?.recoverabilitySummary?.includes("healthy"), true);
  assert.equal(
    updated?.lastExecutionReport?.artifacts.some((artifact) => artifact.kind === "gpt_code_external_target_dispatch"),
    true,
  );
});

test("external source webhook preserves exhausted retry context for operator takeover when the GitHub lane runs out of safe retries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gpt-code-external-automation-exhausted-e2e-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot: root,
    backendType: "file",
    backendFallbackType: "blocked",
    executorMode: "mock",
    workspaceRoot: path.join(root, "workspaces"),
  });
  const existing = {
    ...createInitialState({
      id: "external-e2e-exhausted-state",
      repoPath,
      repoName: "bige",
      userGoal: "Track exhausted GitHub lane retries",
      objective: "Persist operator takeover context when the GitHub lane exhausts retries",
      subtasks: ["external-source", "retry", "recoverability"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["exhausted retry state is persisted"],
      autoMode: true,
      approvalMode: "auto",
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:55:opened",
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
  await dependencies.storage.saveState(existing);

  const rawBody = JSON.stringify({
    action: "created",
    issue: {
      id: 55001,
      number: 55,
      title: "External automation exhausted",
    },
    comment: {
      id: 9955,
      body: completedSliceReport,
    },
    repository: {
      full_name: "example/bige",
      name: "bige",
      default_branch: "main",
    },
    sender: {
      login: "orchestrator-runner",
      id: 1,
      type: "User",
    },
  });

  let attempts = 0;
  const result = await ingestGitHubWebhook({
    rawBody,
    headers: {
      "x-github-event": "issue_comment",
      "x-github-delivery": "delivery-external-automation-exhausted",
      "x-hub-signature-256": sign(rawBody, "secret"),
    },
    secret: "secret",
    dependencies,
    repoPath,
    enqueue: false,
    reportStatus: false,
    statusAdapter: null,
    externalTargetAdapter: {
      kind: "github_issue_comment",
      maxAttempts: 2,
      async dispatchNextInstruction() {
        attempts += 1;
        return {
          stateId: existing.id,
          targetType: "github_issue_comment",
          targetLaneClassification: "github_issue_thread_comment_lane",
          targetDestination: "github://example/bige/issues/55/comments",
          routingDecision: "state_thread_target",
          fallbackDecision: "not_needed",
          attemptCount: attempts,
          retryCount: attempts - 1,
          maxAttempts: 2,
          outcome: "retryable",
          retryEligible: true,
          failureClass: "network",
          correlationId: "orchestrator-next-instruction:external-e2e-exhausted-state",
          externalReferenceId: null,
          externalUrl: null,
          routeTrace: ["state_thread_target | github_issue_thread_comment_lane | github://example/bige/issues/55/comments | retryable | network"],
          deliverySummary: `Attempt ${attempts}/2 ended as retryable (network)`,
          manualReviewReason: "External target dispatch is retryable.",
          recommendedNextStep: "Retry the external target dispatch or inspect the target health before retrying.",
          exhausted: false,
          dispatchArtifactPath: path.join(root, `external-exhausted-dispatch-attempt-${attempts}.json`),
          dispatchedAt: `2026-03-18T00:00:0${attempts}.000Z`,
        };
      },
    },
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
    statusOutputRoot: path.join(root, "status"),
  });
  const updated = await dependencies.storage.loadState(existing.id);

  assert.equal(result.status, "routed");
  assert.equal(attempts, 2);
  assert.equal(updated?.lastGptCodeAutomationState?.targetAdapterStatus, "exhausted");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchReliabilityOutcome, "exhausted");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchExhausted, true);
  assert.equal(updated?.lastGptCodeAutomationState?.canRetryDispatch, false);
  assert.equal(updated?.lastGptCodeAutomationState?.operatorHandoffSummary?.includes("Tried 2/2 attempt(s)."), true);
  assert.equal(updated?.lastGptCodeAutomationState?.recoverabilitySummary?.includes("exhausted"), true);
});
