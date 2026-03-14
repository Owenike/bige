import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { GhCliStatusReportingAdapter, reportStateStatus, runGitHubReportPermissionSmoke } from "../../src/status-reporting";

function createIssueState() {
  return {
    ...createInitialState({
      id: "github-report-permissions-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Inspect GitHub live reporting permissions",
      objective: "Classify why live GitHub reporting is ready or blocked",
      subtasks: ["status-reporting", "permissions"],
      successCriteria: ["permission status is explicit"],
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
  };
}

test("github report permission smoke classifies missing token explicitly", async () => {
  const result = await runGitHubReportPermissionSmoke({
    state: createIssueState(),
    enabled: true,
    token: null,
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.permissionStatus, "missing_token");
  assert.equal(result.targetStrategy, "skip");
});

test("github report permission smoke classifies target not found on missing issue", async () => {
  const result = await runGitHubReportPermissionSmoke({
    state: createIssueState(),
    enabled: true,
    token: "token",
    execFileImpl: async (_file, args) => {
      if (args[0] === "--version") {
        return { stdout: "gh version 2.0.0", stderr: "" };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/45") {
        throw new Error("HTTP 404 Not Found");
      }
      throw new Error(`Unexpected gh call: ${args.join(" ")}`);
    },
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.permissionStatus, "target_not_found");
  assert.equal(result.targetStrategy, "create");
});

test("github live reporting classifies visible correlated target that cannot be updated", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-report-permissions-"));
  const state = {
    ...createIssueState(),
    lastStatusReportTarget: {
      kind: "issue_comment" as const,
      repository: "example/bige",
      targetNumber: 45,
      commentId: 321,
      targetUrl: "https://github.com/example/bige/issues/45#issuecomment-321",
      correlationId: "orchestrator-status:github-report-permissions-state",
      updatedAt: new Date().toISOString(),
    },
  };
  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl: async (_file, args) => {
      if (args[0] === "--version") {
        return { stdout: "gh version 2.0.0", stderr: "" };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/321" && !args.includes("--method")) {
        return {
          stdout: JSON.stringify({
            id: 321,
            html_url: "https://github.com/example/bige/issues/45#issuecomment-321",
          }),
          stderr: "",
        };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/321" && args.includes("PATCH")) {
        throw new Error("HTTP 403 Resource not accessible by integration");
      }
      throw new Error(`Unexpected gh call: ${args.join(" ")}`);
    },
  });

  const result = await reportStateStatus({
    state,
    outputRoot,
    adapter,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.permissionStatus, "correlation_not_updatable");
  assert.equal(result.targetStrategy, "update");
});
