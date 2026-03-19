import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationRecovery } from "../../src/gpt-code-external-automation";
import { gptCodeAutomationStateSchema } from "../../src/schemas";

test("recovery inspect builds recent history, repeated failure pattern, and audit summary for operator review", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "external-recovery-audit-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "external-recovery-audit",
    repoPath,
    repoName: "bige",
    userGoal: "Inspect recovery audit summaries",
    objective: "Make repeated failures and recovery history visible",
    subtasks: ["external-automation", "audit"],
    successCriteria: ["audit summary is readable"],
  });
  state.sourceEventSummary = {
    repository: "example/bige",
    branch: "main",
    issueNumber: 88,
    prNumber: null,
    commentId: 9988,
    label: null,
    headSha: null,
    command: null,
    triggerReason: "issue_comment_created from example/bige#88",
  };
  state.lastGptCodeAutomationState = gptCodeAutomationStateSchema.parse({
    sourceAdapterStatus: "linked",
    sourceType: "github_issue_comment",
    sourceLaneClassification: "github_issue_comment_lane",
    sourceId: "github-comment:9988",
    sourceCorrelationId: "inbound:delivery-audit",
    sourcePayloadPath: "C:/tmp/payload.json",
    sourceHeadersPath: "C:/tmp/headers.json",
    sourceReceivedAt: "2026-03-19T00:00:00.000Z",
    transportSource: "github_issue_comment",
    intakeStatus: "accepted",
    bridgeStatus: "accepted",
    dispatchStatus: "dispatched",
    dispatchTarget: "github_issue_comment",
    dispatchOutcome: "manual_required",
    outputPayloadPath: "C:/tmp/output.json",
    nextInstructionPath: "C:/tmp/next.md",
    automaticTriggerStatus: "triggered",
    targetAdapterStatus: "manual_required",
    targetType: "github_issue_comment",
    targetLaneClassification: "github_status_report_comment_lane",
    targetDestination: "github://example/bige/issues/comments/62002",
    targetAttemptCount: 3,
    targetRetryCount: 2,
    targetMaxAttempts: 3,
    routingDecision: "status_report_target",
    fallbackDecision: "live_smoke_target_fallback",
    dispatchCorrelationId: "orchestrator-next-instruction:external-recovery-audit",
    lastTargetFailureClass: "network",
    dispatchAttemptHistory: [
      {
        attemptCount: 1,
        retryCount: 0,
        recoveryAction: "none",
        recoveryAttemptCount: 0,
        targetLaneClassification: "github_live_smoke_comment_lane",
        targetDestination: "github://example/bige/issues/comments/61001",
        routingDecision: "live_smoke_target",
        fallbackDecision: "not_needed",
        outcome: "retryable",
        retryEligible: true,
        failureClass: "network",
        externalReferenceId: null,
        externalUrl: null,
        dispatchedAt: "2026-03-19T00:00:01.000Z",
        routeTrace: ["live_smoke_target | github_live_smoke_comment_lane | github://example/bige/issues/comments/61001 | retryable | network"],
        deliverySummary: "Attempt 1/3 ended as retryable (network)",
      },
      {
        attemptCount: 2,
        retryCount: 1,
        recoveryAction: "replay",
        recoveryAttemptCount: 1,
        targetLaneClassification: "github_status_report_comment_lane",
        targetDestination: "github://example/bige/issues/comments/62002",
        routingDecision: "status_report_target",
        fallbackDecision: "live_smoke_target_fallback",
        outcome: "retryable",
        retryEligible: true,
        failureClass: "network",
        externalReferenceId: "62002",
        externalUrl: null,
        dispatchedAt: "2026-03-19T00:00:02.000Z",
        routeTrace: ["status_report_target | github_status_report_comment_lane | github://example/bige/issues/comments/62002 | retryable | network"],
        deliverySummary: "Attempt 2/3 ended as retryable (network)",
      },
      {
        attemptCount: 3,
        retryCount: 2,
        recoveryAction: "replay",
        recoveryAttemptCount: 2,
        targetLaneClassification: "github_status_report_comment_lane",
        targetDestination: "github://example/bige/issues/comments/62002",
        routingDecision: "status_report_target",
        fallbackDecision: "live_smoke_target_fallback",
        outcome: "manual_required",
        retryEligible: false,
        failureClass: "network",
        externalReferenceId: "62002",
        externalUrl: null,
        dispatchedAt: "2026-03-19T00:00:03.000Z",
        routeTrace: ["status_report_target | github_status_report_comment_lane | github://example/bige/issues/comments/62002 | manual_required | network"],
        deliverySummary: "Attempt 3/3 stopped for operator review",
      },
    ],
    recoveryHistorySummary: "decision auto -> safe_to_replay (retryable) at 2026-03-19T00:00:02.000Z | recovery#2 replay -> manual_required at 2026-03-19T00:00:03.000Z",
    canRetryDispatch: false,
    dispatchExhausted: true,
    dispatchReliabilityOutcome: "manual_required",
    externalAutomationOutcome: "manual_required",
    recommendedNextStep: "Review the dispatch history and fallback chain, then decide whether a safe manual retry is still possible.",
    manualReviewReason: "External target dispatch exhausted after repeated network failures.",
  });
  await dependencies.storage.saveState(state);

  await runGptCodeExternalAutomationRecovery({
    stateId: state.id,
    dependencies,
    requestedAction: "inspect",
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(updated?.lastGptCodeAutomationState?.recentRecoveryHistory.length, 4);
  assert.equal(
    updated?.lastGptCodeAutomationState?.recentRecoveryHistory.some((entry) => entry.includes("recovery#2 replay")),
    true,
  );
  assert.equal(updated?.lastGptCodeAutomationState?.repeatedFailurePattern?.includes("Repeated network failures"), true);
  assert.equal(updated?.lastGptCodeAutomationState?.recoveryAuditSummary?.includes("queue="), true);
  assert.equal(updated?.lastGptCodeAutomationState?.recoveryAuditSummary?.includes("pattern="), true);
});
