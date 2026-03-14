import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import {
  GhCliStatusReportingAdapter,
  applyStatusReportToState,
  assessGitHubLiveReporting,
  reportStateStatus,
} from "../../src/status-reporting";

test("github live reporting readiness degrades cleanly without token", async () => {
  const readiness = await assessGitHubLiveReporting({
    enabled: true,
    token: null,
  });
  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.missingPrerequisites.includes("GITHUB_TOKEN or GH_TOKEN"), true);
});

test("github live reporting updates an existing correlated comment and persists live status", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-live-report-"));
  const baseState = {
    ...createInitialState({
      id: "github-live-report-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Harden live GitHub reporting",
      objective: "Update an existing correlated GitHub comment",
      subtasks: ["status-reporting", "github-live-report"],
      successCriteria: ["correlated comment is updated"],
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:55:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 55,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#55",
    },
  };

  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl: async (_file, args) => {
      if (args[0] === "--version") {
        return {
          stdout: "gh version 2.0.0",
          stderr: "",
        };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/55/comments" && !args.includes("--method")) {
        return {
          stdout: JSON.stringify([
            {
              id: 321,
              body: "<!-- orchestrator-status:github-live-report-state -->\nprevious body",
              html_url: "https://github.com/example/bige/issues/55#issuecomment-321",
            },
          ]),
          stderr: "",
        };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/321" && args.includes("PATCH")) {
        return {
          stdout: JSON.stringify({
            id: 321,
            html_url: "https://github.com/example/bige/issues/55#issuecomment-321",
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected gh call: ${args.join(" ")}`);
    },
  });

  const result = await reportStateStatus({
    state: baseState,
    outputRoot,
    adapter,
  });
  assert.equal(result.status, "comment_updated");
  const updatedState = applyStatusReportToState(baseState, result);
  assert.equal(updatedState.liveStatusReportStatus, "ready");
  assert.equal(updatedState.lastStatusReportTarget?.commentId, 321);
});
