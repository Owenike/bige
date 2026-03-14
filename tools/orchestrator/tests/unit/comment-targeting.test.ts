import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { resolveCommentTargetingDecision } from "../../src/comment-targeting";

function createIssueState() {
  return {
    ...createInitialState({
      id: "comment-targeting-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Harden comment targeting",
      objective: "Choose create vs update safely",
      subtasks: ["comment-targeting"],
      successCriteria: ["target strategy is stable"],
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:88:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 88,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#88",
    },
  };
}

test("comment targeting creates when no correlated comment exists", () => {
  const decision = resolveCommentTargetingDecision({
    state: createIssueState(),
  });
  assert.equal(decision.status, "ready");
  assert.equal(decision.action, "create");
  assert.equal(decision.targetKind, "issue_comment");
  assert.equal(decision.targetNumber, 88);
});

test("comment targeting updates when a correlated target is already known", () => {
  const decision = resolveCommentTargetingDecision({
    state: {
      ...createIssueState(),
      lastStatusReportTarget: {
        kind: "issue_comment" as const,
        repository: "example/bige",
        targetNumber: 88,
        commentId: 901,
        targetUrl: "https://github.com/example/bige/issues/88#issuecomment-901",
        correlationId: "orchestrator-status:comment-targeting-state",
        updatedAt: new Date().toISOString(),
      },
    },
  });
  assert.equal(decision.status, "ready");
  assert.equal(decision.action, "update");
  assert.equal(decision.commentId, 901);
});

test("comment targeting blocks live reporting when no GitHub issue or PR target exists", () => {
  const decision = resolveCommentTargetingDecision({
    state: createInitialState({
      id: "comment-targeting-artifact-only",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Harden comment targeting",
      objective: "Do not guess a GitHub thread",
      subtasks: ["comment-targeting"],
      successCriteria: ["target strategy is stable"],
    }),
  });
  assert.equal(decision.status, "blocked");
  assert.equal(decision.action, "blocked");
  assert.equal(decision.failureReason, "missing_github_thread_target");
});
