import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { GhCliGptCodeGitHubCommentTargetAdapter } from "../../src/gpt-code-external-automation";
import { ingestGitHubWebhook } from "../../src/webhook";
import { completedSliceReport } from "../unit/helpers/gpt-code-report-fixtures";

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

test("external automation coverage can intake an issue body report and route from a stale status report target to the issue thread lane", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gpt-code-external-coverage-e2e-"));
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
      id: "external-coverage-state",
      repoPath,
      repoName: "bige",
      userGoal: "Expand external automation coverage",
      objective: "Route issue body sourced automation through a broader target selection path",
      subtasks: ["external-source", "external-target", "routing"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["issue body coverage is automated"],
      autoMode: true,
      approvalMode: "auto",
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:45:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 45,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#45",
    },
    lastStatusReportTarget: {
      kind: "issue_comment" as const,
      repository: "example/bige",
      targetNumber: 45,
      commentId: 88001,
      targetUrl: "https://github.com/example/bige/issues/45#issuecomment-88001",
      correlationId: "status-report:external-coverage-state",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
  };
  await dependencies.storage.saveState(existing);

  const rawBody = JSON.stringify({
    action: "edited",
    issue: {
      id: 45001,
      number: 45,
      title: "External automation coverage",
      body: completedSliceReport,
      updated_at: "2026-03-18T00:00:05.000Z",
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

  const externalTargetAdapter = new GhCliGptCodeGitHubCommentTargetAdapter({
    enabled: true,
    token: "token",
    execFileImpl: async (_file, args) => {
      const joined = args.join(" ");
      if (joined.includes("issues/comments/88001") && joined.includes("PATCH")) {
        throw new Error("HTTP 404 target not found");
      }
      if (joined.includes("issues/45/comments") && !joined.includes("--method")) {
        return { stdout: "[]", stderr: "" };
      }
      return {
        stdout: JSON.stringify({
          id: 88002,
          html_url: "https://github.com/example/bige/issues/45#issuecomment-88002",
        }),
        stderr: "",
      };
    },
  });

  const result = await ingestGitHubWebhook({
    rawBody,
    headers: {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-external-coverage",
      "x-hub-signature-256": sign(rawBody, "secret"),
    },
    secret: "secret",
    dependencies,
    repoPath,
    enqueue: false,
    reportStatus: false,
    statusAdapter: null,
    externalTargetAdapter,
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
    statusOutputRoot: path.join(root, "status"),
  });
  const updated = await dependencies.storage.loadState(existing.id);

  assert.equal(result.status, "routed");
  assert.equal(updated?.lastGptCodeAutomationState?.sourceType, "github_issue_body");
  assert.equal(updated?.lastGptCodeAutomationState?.sourceLaneClassification, "github_issue_body_lane");
  assert.equal(updated?.lastGptCodeAutomationState?.targetLaneClassification, "github_issue_thread_comment_lane");
  assert.equal(updated?.lastGptCodeAutomationState?.routingDecision, "state_thread_target");
  assert.equal(updated?.lastGptCodeAutomationState?.fallbackDecision, "status_report_target_fallback");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchReliabilityOutcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.targetExternalReferenceId, "88002");
});
