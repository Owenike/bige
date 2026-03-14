import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { GhCliStatusReportingAdapter, buildStatusReportPayload, reportStateStatus } from "../../src/status-reporting";

test("status reporting writes GitHub-friendly payloads and skips cleanly without token", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-status-report-"));
  const state = {
    ...createInitialState({
      id: "status-reporting-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Report orchestrator status",
      objective: "Emit a GitHub-friendly status summary",
      subtasks: ["status-reporting", "github-events"],
      successCriteria: ["comment payload is readable"],
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:1:opened",
    triggerPolicyId: "issue-default",
    idempotencyKey: "example/bige:issue_opened:1:none:none:issue:1:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 1,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#1",
    },
  };

  const payload = buildStatusReportPayload(state);
  assert.equal(payload.markdown.includes("## Orchestrator Status"), true);
  assert.equal(payload.correlationId, "orchestrator-status:status-reporting-state");

  const skipped = await reportStateStatus({
    state,
    outputRoot,
    adapter: new GhCliStatusReportingAdapter({
      enabled: true,
      token: null,
    }),
  });
  assert.equal(skipped.status, "skipped");
  assert.equal(Boolean(skipped.payloadPath), true);
  const saved = JSON.parse(await readFile(skipped.payloadPath!, "utf8")) as { stateId: string };
  assert.equal(saved.stateId, state.id);
});

test("status reporting can record a posted comment result through the GitHub adapter", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-status-report-posted-"));
  const state = {
    ...createInitialState({
      id: "status-reporting-posted",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Report orchestrator status",
      objective: "Emit a GitHub-friendly status summary",
      subtasks: ["status-reporting", "github-events"],
      successCriteria: ["comment payload is readable"],
    }),
    sourceEventType: "pull_request_opened" as const,
    sourceEventId: "pr:2:opened",
    triggerPolicyId: "pull-request-default",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "feature/orchestrator",
      issueNumber: null,
      prNumber: 2,
      commentId: null,
      label: null,
      headSha: "abc123",
      command: null,
      triggerReason: "pull_request_opened from example/bige#2",
    },
  };

  const result = await reportStateStatus({
    state,
    outputRoot,
    adapter: new GhCliStatusReportingAdapter({
      enabled: true,
      token: "token",
      execFileImpl: async (_file, args) => {
        if (args[0] === "api" && args[1] === "repos/example/bige/issues/2/comments" && !args.includes("--method")) {
          return {
            stdout: "[]",
            stderr: "",
          };
        }
        return {
          stdout: JSON.stringify({
            id: 1,
            html_url: "https://github.com/example/bige/pull/2#issuecomment-1",
          }),
          stderr: "",
        };
      },
    }),
  });

  assert.equal(result.status, "comment_created");
  assert.equal(result.targetUrl, "https://github.com/example/bige/pull/2#issuecomment-1");
  assert.equal(result.commentId, 1);
  assert.equal(result.correlationId, "orchestrator-status:status-reporting-posted");
});
