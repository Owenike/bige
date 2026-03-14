import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { GhCliStatusReportingAdapter } from "../../src/status-reporting";
import { runGitHubLiveAuthSmoke } from "../../src/github-live-auth";

function createIssueState() {
  return {
    ...createInitialState({
      id: "github-live-auth-smoke-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Run GitHub live auth smoke safely",
      objective: "Validate create and update permissions against an explicit sandbox target",
      subtasks: ["github-live-auth-smoke"],
      successCriteria: ["auth smoke is explicit and safe"],
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:90:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 90,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#90",
    },
  };
}

test("github live auth smoke skips cleanly when token is missing", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-live-auth-smoke-"));
  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: null,
  });

  const result = await runGitHubLiveAuthSmoke({
    state: createIssueState(),
    outputRoot,
    adapter,
    enabled: true,
    token: null,
    requestedTarget: {
      repository: "example/bige",
      targetType: "issue",
      targetNumber: 90,
      allowCorrelatedReuse: false,
    },
  });

  assert.equal(result.result.status, "skipped");
  assert.equal(result.result.permissionResult, "missing_token");
  assert.equal(result.state.authSmokeStatus, "skipped");
});

test("github live auth smoke requires an explicit sandbox target when correlated reuse is unavailable", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-live-auth-target-"));
  const execFileImpl = async (_file: string, args: readonly string[]) => {
    if (args[0] === "--version") {
      return { stdout: "gh version 2.0.0", stderr: "" };
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl,
  });

  const result = await runGitHubLiveAuthSmoke({
    state: createIssueState(),
    outputRoot,
    adapter,
    enabled: true,
    token: "token",
    execFileImpl,
    requestedTarget: {
      repository: null,
      targetType: null,
      targetNumber: null,
      allowCorrelatedReuse: false,
    },
  });

  assert.equal(result.result.status, "manual_required");
  assert.equal(result.result.failureReason, "github_auth_smoke_missing_sandbox_target");
  assert.equal(result.state.authSmokeStatus, "manual_required");
});

test("github live auth smoke creates then updates a correlated comment on an explicit sandbox target", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-live-auth-success-"));
  const execFileImpl = async (_file: string, args: readonly string[]) => {
    if (args[0] === "--version") {
      return { stdout: "gh version 2.0.0", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/90" && !args.includes("--method")) {
      return {
        stdout: JSON.stringify({ number: 90, html_url: "https://github.com/example/bige/issues/90" }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/90/comments" && !args.includes("--method")) {
      return {
        stdout: "[]",
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/90/comments" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({
          id: 555,
          html_url: "https://github.com/example/bige/issues/90#issuecomment-555",
        }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/555" && !args.includes("--method")) {
      return {
        stdout: JSON.stringify({
          id: 555,
          html_url: "https://github.com/example/bige/issues/90#issuecomment-555",
        }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/555" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({
          id: 555,
          html_url: "https://github.com/example/bige/issues/90#issuecomment-555",
        }),
        stderr: "",
      };
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl,
  });

  const result = await runGitHubLiveAuthSmoke({
    state: createIssueState(),
    outputRoot,
    adapter,
    enabled: true,
    token: "token",
    execFileImpl,
    requestedTarget: {
      repository: "example/bige",
      targetType: "issue",
      targetNumber: 90,
      allowCorrelatedReuse: false,
    },
  });

  assert.equal(result.result.status, "passed");
  assert.equal(result.result.attemptedAction, "update");
  assert.equal(result.result.permissionResult, "ready");
  assert.equal(result.state.authSmokeStatus, "passed");
  assert.equal(result.state.targetSelectionStatus, "sandbox_explicit");
  assert.equal(result.state.lastStatusReportTarget?.commentId, 555);
  const evidence = JSON.parse(await readFile(result.evidencePath, "utf8")) as { result: { status: string } };
  assert.equal(evidence.result.status, "passed");
});

test("github live auth smoke classifies correlated update denial explicitly", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-live-auth-denied-"));
  const state = {
    ...createIssueState(),
    lastStatusReportTarget: {
      kind: "issue_comment" as const,
      repository: "example/bige",
      targetNumber: 90,
      commentId: 555,
      targetUrl: "https://github.com/example/bige/issues/90#issuecomment-555",
      correlationId: "orchestrator-status:github-live-auth-smoke-state",
      updatedAt: new Date().toISOString(),
    },
  };
  const execFileImpl = async (_file: string, args: readonly string[]) => {
    if (args[0] === "--version") {
      return { stdout: "gh version 2.0.0", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/555" && !args.includes("--method")) {
      return {
        stdout: JSON.stringify({
          id: 555,
          html_url: "https://github.com/example/bige/issues/90#issuecomment-555",
        }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/555" && args.includes("--method")) {
      throw new Error("HTTP 403 Resource not accessible by integration");
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl,
  });

  const result = await runGitHubLiveAuthSmoke({
    state,
    outputRoot,
    adapter,
    enabled: true,
    token: "token",
    execFileImpl,
    requestedTarget: {
      repository: null,
      targetType: null,
      targetNumber: null,
      allowCorrelatedReuse: true,
    },
  });

  assert.equal(result.result.status, "failed");
  assert.equal(result.result.permissionResult, "correlation_not_updatable");
  assert.equal(result.state.authSmokePermissionResult, "correlation_not_updatable");
});
