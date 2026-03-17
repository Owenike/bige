import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { GhCliGptCodeGitHubCommentTargetAdapter } from "../../src/gpt-code-external-automation";

test("external target adapter can route through source fallback when the state thread target is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gpt-code-external-target-"));
  const nextInstructionPath = path.join(root, "next-instruction.md");
  const outputPayloadPath = path.join(root, "output-payload.json");
  await writeFile(nextInstructionPath, "建議級別：小\n", "utf8");
  await writeFile(outputPayloadPath, "{}\n", "utf8");

  const state = {
    ...createInitialState({
      id: "external-target-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Dispatch next instruction externally",
      objective: "Use a GitHub comment as the first external target",
      subtasks: ["external-target"],
      successCriteria: ["external target receives the next instruction"],
    }),
    lastGptCodeAutomationState: {
      sourceAdapterStatus: "linked" as const,
      sourceType: "github_issue_comment",
      sourceLaneClassification: "github_issue_comment_lane" as const,
      sourceId: "github-comment:9911",
      sourceCorrelationId: "inbound:delivery-report-1",
      sourcePayloadPath: "C:/tmp/payload.json",
      sourceHeadersPath: "C:/tmp/headers.json",
      sourceReceivedAt: "2026-03-18T00:00:00.000Z",
      transportSource: "github_issue_comment",
      intakeStatus: "accepted" as const,
      bridgeStatus: "accepted" as const,
      dispatchStatus: "dispatched" as const,
      dispatchTarget: "repo_local_outbox",
      dispatchOutcome: "success" as const,
      intakeArtifactPath: null,
      bridgeArtifactRoot: null,
      outputPayloadPath,
      nextInstructionPath,
      dispatchArtifactPath: null,
      automaticTriggerStatus: "triggered" as const,
      targetAdapterStatus: "not_attempted" as const,
      targetType: null,
      targetLaneClassification: null,
      targetDestination: null,
      targetAttemptCount: 0,
      targetRetryCount: 0,
      targetMaxAttempts: 2,
      routingDecision: null,
      fallbackDecision: null,
      dispatchCorrelationId: null,
      targetExternalReferenceId: null,
      targetExternalUrl: null,
      targetDispatchArtifactPath: null,
      lastTargetFailureClass: null,
      dispatchReliabilityOutcome: "not_run" as const,
      externalAutomationOutcome: "not_run" as const,
      lastReceivedAt: "2026-03-18T00:00:00.000Z",
      lastAttemptedAt: "2026-03-18T00:00:00.000Z",
      lastDispatchedAt: null,
      recommendedNextStep: null,
      manualReviewReason: null,
    },
  };

  const adapter = new GhCliGptCodeGitHubCommentTargetAdapter({
    enabled: true,
    token: "token",
    execFileImpl: async (_file, args) => {
      if (args[1] === "repos/example/bige/issues/44/comments" && !args.includes("--method")) {
        return { stdout: "[]", stderr: "" };
      }
      return {
        stdout: JSON.stringify({
          id: 12345,
          html_url: "https://github.com/example/bige/issues/44#issuecomment-12345",
        }),
        stderr: "",
      };
    },
  });

  const result = await adapter.dispatchNextInstruction({
    state,
    source: {
      sourceType: "github_pull_request_review_comment",
      sourceLaneClassification: "github_pull_request_review_comment_lane",
      sourceId: "github-pr-review-comment:9933",
      sourceCorrelationId: "inbound:delivery-report-2",
      repository: "example/bige",
      issueNumber: null,
      prNumber: 44,
      commentId: 9933,
      payloadPath: "C:/tmp/payload.json",
      headersPath: "C:/tmp/headers.json",
      receivedAt: "2026-03-18T00:00:00.000Z",
    },
    nextInstructionPath,
    outputPayloadPath,
    outputRoot: root,
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.targetType, "github_issue_comment");
  assert.equal(result.targetDestination, "github://example/bige/issues/44/comments");
  assert.equal(result.targetLaneClassification, "github_source_thread_fallback_lane");
  assert.equal(result.routingDecision, "source_thread_fallback");
  assert.equal(result.fallbackDecision, "source_thread_fallback");
  assert.equal(result.externalReferenceId, "12345");
});
