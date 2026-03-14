import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import type { OrchestratorState } from "../../src/schemas";
import { applyStatusReportToState, GhCliStatusReportingAdapter, reportStateStatus } from "../../src/status-reporting";

test("status reporting reuses the same correlated comment instead of creating a new one", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-comment-upsert-"));
  const calls: string[] = [];
  let state: OrchestratorState = {
    ...createInitialState({
      id: "comment-upsert-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Track a correlated GitHub status comment",
      objective: "Update the same comment on repeated reports",
      subtasks: ["status-reporting", "comment-upsert"],
      successCriteria: ["status report uses a stable target"],
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

  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl: async (_file, args) => {
      calls.push(args.join(" "));
      if (args[0] === "--version") {
        return { stdout: "gh version 2.0.0", stderr: "" };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/77/comments" && args.includes("--method") === false) {
        return { stdout: "[]", stderr: "" };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/77/comments" && args.includes("POST")) {
        return {
          stdout: JSON.stringify({
            id: 111,
            html_url: "https://github.com/example/bige/issues/77#issuecomment-111",
          }),
          stderr: "",
        };
      }
      if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/111" && args.includes("PATCH")) {
        return {
          stdout: JSON.stringify({
            id: 111,
            html_url: "https://github.com/example/bige/issues/77#issuecomment-111",
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected gh call: ${args.join(" ")}`);
    },
  });

  const created = await reportStateStatus({
    state,
    outputRoot,
    adapter,
  });
  assert.equal(created.status, "comment_created");
  state = applyStatusReportToState(state, created);
  assert.equal(state.lastStatusReportTarget?.commentId, 111);

  const updated = await reportStateStatus({
    state,
    outputRoot,
    adapter,
  });
  assert.equal(updated.status, "comment_updated");
  assert.equal(updated.commentId, 111);
  assert.equal(calls.some((value) => value.includes("PATCH")), true);
});
