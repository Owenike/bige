import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { evaluateGitHubLiveCommentReadiness } from "../../src/status-reporting";

function createState() {
  return {
    ...createInitialState({
      id: "reporting-readiness-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Inspect live reporting readiness",
      objective: "Explain why GitHub live comment reporting can or cannot run",
      subtasks: ["status-reporting", "readiness"],
      successCriteria: ["readiness is explicit"],
    }),
    sourceEventType: "pull_request_opened" as const,
    sourceEventId: "pr:8:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "feature/reporting",
      issueNumber: null,
      prNumber: 8,
      commentId: null,
      label: null,
      headSha: "abc123",
      command: null,
      triggerReason: "pull_request_opened from example/bige#8",
    },
  };
}

test("reporting readiness degrades cleanly when token is missing", async () => {
  const readiness = await evaluateGitHubLiveCommentReadiness({
    state: createState(),
    enabled: true,
    token: null,
  });
  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.action, "skip");
  assert.equal(readiness.failureReason, "missing_github_token");
});

test("reporting readiness blocks when no GitHub thread target exists", async () => {
  const readiness = await evaluateGitHubLiveCommentReadiness({
    state: createInitialState({
      id: "reporting-readiness-blocked",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Inspect live reporting readiness",
      objective: "Explain why GitHub live comment reporting can or cannot run",
      subtasks: ["status-reporting", "readiness"],
      successCriteria: ["readiness is explicit"],
    }),
    enabled: true,
    token: "token",
    execFileImpl: async () => ({ stdout: "gh version 2.0.0", stderr: "" }),
  });
  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.action, "blocked");
  assert.equal(readiness.failureReason, "missing_github_thread_target");
});

test("reporting readiness reports create when GitHub prerequisites and thread target are available", async () => {
  const readiness = await evaluateGitHubLiveCommentReadiness({
    state: createState(),
    enabled: true,
    token: "token",
    execFileImpl: async () => ({ stdout: "gh version 2.0.0", stderr: "" }),
  });
  assert.equal(readiness.status, "ready");
  assert.equal(readiness.action, "create");
  assert.equal(readiness.targetKind, "pull_request_comment");
  assert.equal(readiness.targetId, 8);
});
