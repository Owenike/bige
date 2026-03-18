import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { GhCliGptCodeGitHubCommentTargetAdapter } from "../../src/gpt-code-external-automation";

test("external routing prefers the correlated status report target for body-based sources and falls back to the thread lane when it is stale", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gpt-code-external-routing-"));
  const nextInstructionPath = path.join(root, "next-instruction.md");
  const outputPayloadPath = path.join(root, "output-payload.json");
  await writeFile(nextInstructionPath, "下一輪請補 external target coverage。\n", "utf8");
  await writeFile(outputPayloadPath, "{}\n", "utf8");

  const state = {
    ...createInitialState({
      id: "external-routing-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Route external automation output",
      objective: "Prefer a correlated status report target but fall back safely when it is stale",
      subtasks: ["external-routing"],
      successCriteria: ["routing and fallback are explicit"],
    }),
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
      commentId: 8765,
      targetUrl: "https://github.com/example/bige/issues/45#issuecomment-8765",
      correlationId: "status-report:external-routing-state",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
  };

  const adapter = new GhCliGptCodeGitHubCommentTargetAdapter({
    enabled: true,
    token: "token",
    execFileImpl: async (_file, args) => {
      const joined = args.join(" ");
      if (joined.includes("issues/comments/8765") && joined.includes("PATCH")) {
        throw new Error("HTTP 404 target not found");
      }
      if (joined.includes("issues/45/comments") && !joined.includes("--method")) {
        return { stdout: "[]", stderr: "" };
      }
      return {
        stdout: JSON.stringify({
          id: 22222,
          html_url: "https://github.com/example/bige/issues/45#issuecomment-22222",
        }),
        stderr: "",
      };
    },
  });

  const result = await adapter.dispatchNextInstruction({
    state,
    source: {
      sourceType: "github_issue_body",
      sourceLaneClassification: "github_issue_body_lane",
      sourceId: "github-issue-body:501:edited:2026-03-18T00:00:01.000Z",
      sourceCorrelationId: "inbound:delivery-report-3",
      repository: "example/bige",
      issueNumber: 45,
      prNumber: null,
      commentId: null,
      payloadPath: "C:/tmp/issue-body-payload.json",
      headersPath: "C:/tmp/issue-body-headers.json",
      receivedAt: "2026-03-18T00:00:02.000Z",
    },
    nextInstructionPath,
    outputPayloadPath,
    outputRoot: root,
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.targetLaneClassification, "github_issue_thread_comment_lane");
  assert.equal(result.routingDecision, "state_thread_target");
  assert.equal(result.fallbackDecision, "status_report_target_fallback");
  assert.equal(result.externalReferenceId, "22222");
  assert.equal(result.routeTrace.length, 2);
  assert.equal(result.routeTrace[0]?.includes("status_report_target"), true);
  assert.equal(result.routeTrace[1]?.includes("state_thread_target"), true);
});

test("external routing prefers the correlated live smoke target for pull request body sources and falls back to the status report target when it is stale", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gpt-code-external-live-smoke-routing-"));
  const nextInstructionPath = path.join(root, "next-instruction.md");
  const outputPayloadPath = path.join(root, "output-payload.json");
  await writeFile(nextInstructionPath, "route PR body automation through live smoke then status report fallback\n", "utf8");
  await writeFile(outputPayloadPath, "{}\n", "utf8");

  const state = {
    ...createInitialState({
      id: "external-live-smoke-routing-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Route PR body automation output",
      objective: "Prefer a correlated live smoke target but fall back to the status report target when it is stale",
      subtasks: ["external-routing"],
      successCriteria: ["routing and fallback are explicit"],
    }),
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: null,
      prNumber: 78,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "pull_request_opened from example/bige#78",
    },
    lastLiveSmokeTarget: {
      repository: "example/bige",
      targetType: "pull_request" as const,
      targetNumber: 78,
      commentId: 61001,
      selectionStatus: "correlated_reuse" as const,
      selectionSummary: "Reuse the correlated live smoke pull request comment.",
    },
    lastStatusReportTarget: {
      kind: "pull_request_comment" as const,
      repository: "example/bige",
      targetNumber: 78,
      commentId: 62002,
      targetUrl: "https://github.com/example/bige/pull/78#issuecomment-62002",
      correlationId: "status-report:external-live-smoke-routing-state",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
  };

  const adapter = new GhCliGptCodeGitHubCommentTargetAdapter({
    enabled: true,
    token: "token",
    execFileImpl: async (_file, args) => {
      const joined = args.join(" ");
      if (joined.includes("issues/comments/61001") && joined.includes("PATCH")) {
        throw new Error("HTTP 404 target not found");
      }
      assert.equal(joined.includes("issues/comments/62002"), true);
      return {
        stdout: JSON.stringify({
          id: 62002,
          html_url: "https://github.com/example/bige/pull/78#issuecomment-62002",
        }),
        stderr: "",
      };
    },
  });

  const result = await adapter.dispatchNextInstruction({
    state,
    source: {
      sourceType: "github_pull_request_body",
      sourceLaneClassification: "github_pull_request_body_lane",
      sourceId: "github-pull-request-body:701:opened:2026-03-18T00:00:03.000Z",
      sourceCorrelationId: "inbound:delivery-report-4",
      repository: "example/bige",
      issueNumber: null,
      prNumber: 78,
      commentId: null,
      payloadPath: "C:/tmp/pr-body-payload.json",
      headersPath: "C:/tmp/pr-body-headers.json",
      receivedAt: "2026-03-18T00:00:04.000Z",
    },
    nextInstructionPath,
    outputPayloadPath,
    outputRoot: root,
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.targetLaneClassification, "github_status_report_comment_lane");
  assert.equal(result.routingDecision, "status_report_target");
  assert.equal(result.fallbackDecision, "live_smoke_target_fallback");
  assert.equal(result.externalReferenceId, "62002");
  assert.equal(result.routeTrace.length, 2);
  assert.equal(result.routeTrace[0]?.includes("live_smoke_target"), true);
  assert.equal(result.routeTrace[1]?.includes("status_report_target"), true);
});
