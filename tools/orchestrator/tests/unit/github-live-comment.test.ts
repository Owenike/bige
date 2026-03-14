import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { GhCliStatusReportingAdapter, runGitHubLiveCommentSmoke } from "../../src/status-reporting";

function createState() {
  return {
    ...createInitialState({
      id: "github-live-comment-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Smoke GitHub live comment reporting",
      objective: "Exercise create then update on the same correlated comment",
      subtasks: ["status-reporting", "github-live-comment"],
      successCriteria: ["create and update both work"],
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:66:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 66,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#66",
    },
  };
}

test("github live comment smoke exercises create then update for the same correlated thread", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-live-comment-"));
  let listCalls = 0;
  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl: async (_file, args) => {
      if (args[0] === "--version") {
        return { stdout: "gh version 2.0.0", stderr: "" };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/66/comments" && !args.includes("--method")) {
        listCalls += 1;
        return {
          stdout:
            listCalls === 1
              ? "[]"
              : JSON.stringify([
                  {
                    id: 501,
                    body: "<!-- orchestrator-status:github-live-comment-state -->\nexisting body",
                    html_url: "https://github.com/example/bige/issues/66#issuecomment-501",
                  },
                ]),
          stderr: "",
        };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/66/comments" && args.includes("POST")) {
        return {
          stdout: JSON.stringify({
            id: 501,
            html_url: "https://github.com/example/bige/issues/66#issuecomment-501",
          }),
          stderr: "",
        };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/501" && !args.includes("--method")) {
        return {
          stdout: JSON.stringify({
            id: 501,
            html_url: "https://github.com/example/bige/issues/66#issuecomment-501",
          }),
          stderr: "",
        };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/501" && args.includes("PATCH")) {
        return {
          stdout: JSON.stringify({
            id: 501,
            html_url: "https://github.com/example/bige/issues/66#issuecomment-501",
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected gh call: ${args.join(" ")}`);
    },
  });

  const result = await runGitHubLiveCommentSmoke({
    state: createState(),
    outputRoot,
    adapter,
  });
  assert.equal(result.first.action, "created");
  assert.equal(result.second?.action, "updated");
  assert.equal(result.final.commentId, 501);
  assert.equal(result.state.lastStatusReportAction, "updated");
  assert.equal(result.state.lastStatusReportTarget?.commentId, 501);
});

test("github live comment smoke degrades cleanly when token is missing", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-live-comment-skip-"));
  const result = await runGitHubLiveCommentSmoke({
    state: createState(),
    outputRoot,
    adapter: new GhCliStatusReportingAdapter({
      enabled: true,
      token: null,
    }),
  });
  assert.equal(result.first.status, "skipped");
  assert.equal(result.final.readiness, "degraded");
  assert.equal(result.state.lastStatusReportFailureReason, "missing_github_token");
});
