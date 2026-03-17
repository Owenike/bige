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
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:44:opened",
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
  await dependencies.storage.saveState(existing);

  const rawBody = JSON.stringify({
    action: "created",
    issue: {
      id: 44,
      number: 44,
      title: "External automation e2e",
      labels: [{ name: "orchestrator" }],
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

  const result = await ingestGitHubWebhook({
    rawBody,
    headers: {
      "x-github-event": "issue_comment",
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
      async dispatchNextInstruction() {
        return {
          stateId: existing.id,
          targetType: "github_issue_comment",
          targetDestination: "github://example/bige/issues/44/comments",
          attemptCount: 1,
          outcome: "success",
          externalReferenceId: "30001",
          externalUrl: "https://github.com/example/bige/issues/44#issuecomment-30001",
          dispatchArtifactPath: path.join(root, "external-target-dispatch.json"),
          dispatchedAt: "2026-03-18T00:00:02.000Z",
        };
      },
    },
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
    statusOutputRoot: path.join(root, "status"),
  });
  const updated = await dependencies.storage.loadState(existing.id);

  assert.equal(result.status, "routed");
  assert.equal(updated?.lastGptCodeAutomationState?.sourceType, "github_issue_comment");
  assert.equal(updated?.lastGptCodeAutomationState?.automaticTriggerStatus, "triggered");
  assert.equal(updated?.lastGptCodeAutomationState?.targetAdapterStatus, "dispatched");
  assert.equal(updated?.lastGptCodeAutomationState?.externalAutomationOutcome, "success");
  assert.equal(
    updated?.lastExecutionReport?.artifacts.some((artifact) => artifact.kind === "gpt_code_external_target_dispatch"),
    true,
  );
});
