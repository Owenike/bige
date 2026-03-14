import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { selectGitHubLiveSmokeTarget } from "../../src/github-live-targets";

function createIssueState() {
  return {
    ...createInitialState({
      id: "github-live-targeting-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Select a safe GitHub live smoke target",
      objective: "Require explicit sandbox targets before live comment smoke",
      subtasks: ["github-live-targeting"],
      successCriteria: ["sandbox target selection is explicit"],
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:77:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 77,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#77",
    },
  };
}

test("github live target selection accepts an explicit sandbox issue target", () => {
  const result = selectGitHubLiveSmokeTarget({
    state: createIssueState(),
    requestedTarget: {
      repository: "example/bige",
      targetType: "issue",
      targetNumber: 90,
      allowCorrelatedReuse: false,
    },
  });

  assert.equal(result.status, "sandbox_explicit");
  assert.equal(result.mode, "sandbox_issue");
  assert.equal(result.target.repository, "example/bige");
  assert.equal(result.target.targetNumber, 90);
  assert.equal(result.attemptedAction, "create");
});

test("github live target selection reuses correlated target when explicitly allowed", () => {
  const result = selectGitHubLiveSmokeTarget({
    state: {
      ...createIssueState(),
      lastStatusReportTarget: {
        kind: "issue_comment" as const,
        repository: "example/bige",
        targetNumber: 77,
        commentId: 901,
        targetUrl: "https://github.com/example/bige/issues/77#issuecomment-901",
        correlationId: "orchestrator-status:github-live-targeting-state",
        updatedAt: new Date().toISOString(),
      },
    },
    requestedTarget: {
      repository: null,
      targetType: null,
      targetNumber: null,
      allowCorrelatedReuse: true,
    },
  });

  assert.equal(result.status, "correlated_reuse");
  assert.equal(result.mode, "correlated_reuse");
  assert.equal(result.target.commentId, 901);
  assert.equal(result.attemptedAction, "update");
});

test("github live target selection blocks repository mismatch for explicit sandbox target", () => {
  const result = selectGitHubLiveSmokeTarget({
    state: {
      ...createIssueState(),
      lastStatusReportTarget: {
        kind: "issue_comment" as const,
        repository: "example/bige",
        targetNumber: 77,
        commentId: 901,
        targetUrl: "https://github.com/example/bige/issues/77#issuecomment-901",
        correlationId: "orchestrator-status:github-live-targeting-state",
        updatedAt: new Date().toISOString(),
      },
    },
    requestedTarget: {
      repository: "other/repo",
      targetType: "issue",
      targetNumber: 90,
      allowCorrelatedReuse: false,
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.permissionResult, "repository_mismatch");
  assert.equal(result.failureReason, "github_auth_smoke_repository_mismatch");
});

test("github live target selection requires an explicit sandbox target when no correlated target exists", () => {
  const result = selectGitHubLiveSmokeTarget({
    state: createIssueState(),
    requestedTarget: {
      repository: null,
      targetType: null,
      targetNumber: null,
      allowCorrelatedReuse: false,
    },
  });

  assert.equal(result.status, "manual_required");
  assert.equal(result.permissionResult, "blocked");
  assert.equal(result.failureReason, "github_auth_smoke_missing_sandbox_target");
});
