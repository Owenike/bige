import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagnosticsSummary, formatDiagnosticsSummary } from "../../src/diagnostics";
import { createInitialState } from "../../src/orchestrator";

test("diagnostics summarize latest state, blocked reasons, and next action in a readable form", () => {
  const state = createInitialState({
    id: "diagnostics-state",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Inspect orchestrator status",
    objective: "Build diagnostics summary",
    subtasks: ["preflight", "diagnostics", "storage", "reviewer"],
    successCriteria: ["operator summary is readable"],
  });

  state.status = "needs_revision";
  state.iterationNumber = 1;
  state.lastExecutionReport = {
    iterationNumber: 1,
    changedFiles: ["tools/orchestrator/src/cli.ts"],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: ["Recorded a diagnostic-friendly change set."],
    whyThisWasDone: ["Exercise diagnostics output."],
    howBehaviorWasKeptStable: ["Only orchestrator files changed."],
    localValidation: [],
    ciValidation: null,
    blockers: ["Need OPENAI_API_KEY for live acceptance."],
    risks: [],
    recommendedNextStep: "Provide OPENAI_API_KEY or continue with non-live paths.",
    shouldCloseSlice: false,
    artifacts: [],
  };
  state.lastReviewVerdict = {
    verdict: "revise",
    reasons: ["Preflight prerequisites are still missing."],
    violatedConstraints: [],
    missingValidation: [],
    suggestedPatchScope: ["tools/orchestrator/src/preflight/index.ts"],
    canAutoContinue: false,
  };
  state.lastBlockedReasons = [
    {
      code: "missing_openai_api_key",
      summary: "OpenAI live paths require OPENAI_API_KEY.",
      missingPrerequisites: ["OPENAI_API_KEY"],
      recoverable: true,
      suggestedNextAction: "Set OPENAI_API_KEY or use a non-live provider.",
    },
  ];
  state.lastPreflightResult = {
    checkedAt: new Date().toISOString(),
    profileId: state.task.profileId,
    availableProviders: ["planner:rule_based", "reviewer:rule_based", "executor:mock"],
    unavailableProviders: [{ name: "executor:openai_responses", reason: "OPENAI_API_KEY is missing." }],
    missingEnv: ["OPENAI_API_KEY"],
    missingTools: [],
    allowedExecutionModes: ["mock", "dry_run"],
    allowedHandoffModes: ["payload_only"],
    allowedPromotionModes: ["patch_export"],
    blockedReasons: state.lastBlockedReasons,
    targets: [
      {
        target: "live_acceptance",
        status: "blocked",
        blockedReasons: state.lastBlockedReasons,
        summary: "OpenAI live paths require OPENAI_API_KEY.",
      },
    ],
    summary: "Preflight found missing live prerequisites.",
  };

  const summary = buildDiagnosticsSummary(state);
  const rendered = formatDiagnosticsSummary(summary);

  assert.equal(summary.status, "needs_revision");
  assert.equal(summary.blockedReasons[0]?.code, "missing_openai_api_key");
  assert.equal(summary.nextSuggestedAction.includes("OPENAI_API_KEY"), true);
  assert.equal(rendered.includes("Blocked reasons:"), true);
  assert.equal(rendered.includes("Next action:"), true);
});

test("diagnostics render external automation observability summaries for operator review", () => {
  const state = createInitialState({
    id: "diagnostics-external-automation-state",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Inspect external automation status",
    objective: "Build external automation diagnostics summary",
    subtasks: ["diagnostics", "external-automation"],
    successCriteria: ["external automation summary is readable"],
  });

  state.lastGptCodeAutomationState = {
    sourceAdapterStatus: "linked",
    sourceType: "github_pull_request_body",
    sourceLaneClassification: "github_pull_request_body_lane",
    sourceId: "github-pull-request-body:701",
    sourceCorrelationId: "inbound:delivery-diagnostics",
    sourcePayloadPath: "C:/tmp/pr-body.json",
    sourceHeadersPath: "C:/tmp/pr-body-headers.json",
    sourceReceivedAt: "2026-03-18T00:00:00.000Z",
    transportSource: "github_pull_request_body",
    intakeStatus: "accepted",
    bridgeStatus: "accepted",
    dispatchStatus: "dispatched",
    dispatchTarget: "github_issue_comment",
    dispatchOutcome: "exhausted",
    intakeArtifactPath: null,
    bridgeArtifactRoot: null,
    outputPayloadPath: "C:/tmp/output-payload.json",
    nextInstructionPath: "C:/tmp/next-instruction.md",
    dispatchArtifactPath: "C:/tmp/dispatch.json",
    automaticTriggerStatus: "triggered",
    targetAdapterStatus: "exhausted",
    targetType: "github_issue_comment",
    targetLaneClassification: "github_status_report_comment_lane",
    targetDestination: "github://example/bige/issues/comments/62002",
    targetAttemptCount: 2,
    targetRetryCount: 1,
    targetMaxAttempts: 2,
    routingDecision: "status_report_target",
    fallbackDecision: "live_smoke_target_fallback",
    dispatchCorrelationId: "orchestrator-next-instruction:diagnostics-external-automation-state",
    targetExternalReferenceId: "62002",
    targetExternalUrl: "https://github.com/example/bige/pull/78#issuecomment-62002",
    targetDispatchArtifactPath: "C:/tmp/dispatch-attempt-2.json",
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
        dispatchedAt: "2026-03-18T00:00:01.000Z",
        routeTrace: ["live_smoke_target | github_live_smoke_comment_lane | github://example/bige/issues/comments/61001 | retryable | network"],
        deliverySummary: "Attempt 1/2 ended as retryable (network)",
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
        outcome: "exhausted",
        retryEligible: false,
        failureClass: "network",
        externalReferenceId: "62002",
        externalUrl: "https://github.com/example/bige/pull/78#issuecomment-62002",
        dispatchedAt: "2026-03-18T00:00:02.000Z",
        routeTrace: [
          "live_smoke_target | github_live_smoke_comment_lane | github://example/bige/issues/comments/61001 | failed | target_invalid",
          "status_report_target | github_status_report_comment_lane | github://example/bige/issues/comments/62002 | exhausted | network",
        ],
        deliverySummary: "Attempt 2/2 exhausted after retryable failures",
      },
    ],
    retryPolicySummary: "Retry policy exhausted after 2/2 attempts (1 retries).",
    dispatchHistorySummary: "#1 retryable github_live_smoke_comment_lane network | #2 exhausted github_status_report_comment_lane network",
    fallbackChainSummary: "Fallback chain: live_smoke_target => status_report_target",
    recoverabilitySummary: "External lane exhausted its safe retries; operator review is required before any further retry.",
    operatorHandoffSummary:
      "External target dispatch exhausted after 2/2 attempts. Tried 2/2 attempt(s). live_smoke_target => status_report_target Safe retry remaining: false. Next: Review the dispatch history and fallback chain, then decide whether a safe manual retry is still possible.",
    replayEligibility: "safe_to_replay",
    replayBlockReason: null,
    replayAttemptCount: 1,
    lastReplayAction: "replay",
    lastReplayOutcome: "exhausted",
    recoveryHistorySummary: "recovery#1 replay -> exhausted at 2026-03-18T00:00:02.000Z",
    operatorRecoveryRecommendation: "External lane can be replayed once under operator control; reuse the existing next instruction and re-check the routed target.",
    canRetryDispatch: false,
    dispatchExhausted: true,
    dispatchReliabilityOutcome: "exhausted",
    externalAutomationOutcome: "exhausted",
    lastReceivedAt: "2026-03-18T00:00:00.000Z",
    lastAttemptedAt: "2026-03-18T00:00:02.000Z",
    lastDispatchedAt: "2026-03-18T00:00:02.000Z",
    recommendedNextStep: "Review the dispatch history and fallback chain, then decide whether a safe manual retry is still possible.",
    manualReviewReason: "External target dispatch exhausted after 2/2 attempts.",
  };

  const summary = buildDiagnosticsSummary(state);
  const rendered = formatDiagnosticsSummary(summary);

  assert.equal(summary.externalAutomation.targetAdapterStatus, "exhausted");
  assert.equal(summary.externalAutomation.dispatchExhausted, true);
  assert.equal(rendered.includes("External automation:"), true);
  assert.equal(rendered.includes("External automation dispatch history:"), true);
  assert.equal(rendered.includes("External automation handoff:"), true);
  assert.equal(summary.nextSuggestedAction.includes("can be replayed once under operator control"), true);
});
