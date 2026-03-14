import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { ingestGitHubWebhook } from "../../src/webhook";

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

test("duplicate webhook deliveries link to the existing active task instead of creating a second one", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-event-flow-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot: root,
    backendType: "file",
    backendFallbackType: "blocked",
    executorMode: "mock",
    workspaceRoot: path.join(root, "workspaces"),
  });
  const rawBody = JSON.stringify({
    action: "opened",
    issue: {
      id: 501,
      number: 88,
      title: "Duplicate webhook delivery",
      body: "Ensure dedupe",
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

  const first = await ingestGitHubWebhook({
    rawBody,
    headers: {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-a",
      "x-hub-signature-256": sign(rawBody, "secret"),
    },
    secret: "secret",
    dependencies,
    repoPath,
    enqueue: true,
    reportStatus: false,
    statusAdapter: null,
    statusOutputRoot: path.join(root, "status"),
  });
  const second = await ingestGitHubWebhook({
    rawBody,
    headers: {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-b",
      "x-hub-signature-256": sign(rawBody, "secret"),
    },
    secret: "secret",
    dependencies,
    repoPath,
    enqueue: true,
    reportStatus: false,
    statusAdapter: null,
    statusOutputRoot: path.join(root, "status"),
  });

  assert.equal(first.status, "created");
  assert.equal(second.status, "duplicate");
  assert.equal(second.state?.id, first.state?.id);
});

test("comment command webhook can route to status reporting for an existing thread", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-event-flow-status-"));
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
      id: "issue-12-task",
      repoPath,
      repoName: "bige",
      userGoal: "Existing issue state",
      objective: "Support routed status comments",
      subtasks: ["github-events", "status-reporting"],
      successCriteria: ["status route works"],
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:12:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 12,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#12",
    },
  };
  await dependencies.storage.saveState(existing);

  const rawBody = JSON.stringify({
    action: "created",
    issue: {
      id: 12,
      number: 12,
      title: "Existing issue state",
      labels: [{ name: "orchestrator" }],
    },
    comment: {
      id: 9002,
      body: "/orchestrator status",
    },
    repository: {
      full_name: "example/bige",
      name: "bige",
      default_branch: "main",
    },
    sender: {
      login: "orchestrator-viewer",
      id: 2,
      type: "User",
    },
  });

  const result = await ingestGitHubWebhook({
    rawBody,
    headers: {
      "x-github-event": "issue_comment",
      "x-github-delivery": "delivery-status",
      "x-hub-signature-256": sign(rawBody, "secret"),
    },
    secret: "secret",
    dependencies,
    repoPath,
    enqueue: false,
    reportStatus: true,
    statusAdapter: {
      kind: "mock_status",
      async postSummary(params) {
        return {
          status: "comment_created",
          provider: "mock_status",
          summary: "Mock comment created.",
          markdownPath: params.markdownPath,
          payloadPath: null,
          targetUrl: "https://github.com/example/bige/issues/12#issuecomment-123",
          targetNumber: params.targetNumber,
          commentId: 123,
          correlationId: "orchestrator-status:issue-12-task",
          readiness: "ready",
          permissionStatus: "ready",
          targetKind: "issue_comment",
          targetStrategy: "create",
          failureReason: null,
          action: "created",
          auditId: "mock-audit",
          nextAction: "Reuse the correlated comment.",
          ranAt: new Date().toISOString(),
        };
      },
    },
    statusOutputRoot: path.join(root, "status"),
  });

  assert.equal(result.status, "routed");
  assert.equal(result.state?.commandRoutingStatus, "routed");
  assert.equal(result.state?.lastStatusReportTarget?.commentId, 123);
});
