import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { approvePendingPatch, createInitialState, prepareHandoff } from "../../src/orchestrator";
import { buildPrDraftMetadata, validateHandoffPreconditions } from "../../src/handoff";
import { createPromotionReadyFixture } from "./promotion.fixture";

test("prepareHandoff creates a handoff-ready package after approval and live pass", async () => {
  const { dependencies, repoRoot } = await createPromotionReadyFixture("handoff-ready-state");
  await approvePendingPatch("handoff-ready-state", dependencies);
  let state = await dependencies.storage.loadState("handoff-ready-state");
  assert.ok(state);

  const liveRoot = path.join(repoRoot, ".tmp", "live-pass");
  await mkdir(liveRoot, { recursive: true });
  await writeFile(path.join(liveRoot, "report.json"), "{}\n", "utf8");
  await writeFile(path.join(liveRoot, "tool-log.json"), "[]\n", "utf8");
  await writeFile(path.join(liveRoot, "command-log.json"), "[]\n", "utf8");
  await writeFile(path.join(liveRoot, "summary.json"), "{}\n", "utf8");

  await dependencies.storage.saveState({
    ...state!,
    livePassStatus: "passed",
    liveAcceptanceStatus: "passed",
    lastLiveAcceptanceResult: {
      status: "passed",
      reason: "real pass",
      provider: "openai_responses",
      model: "gpt-5",
      summary: "live pass completed",
      reportPath: path.join(liveRoot, "report.json"),
      diffPath: state!.lastExecutionReport?.artifacts.find((artifact) => artifact.kind === "diff")?.path ?? null,
      transcriptSummaryPath: path.join(liveRoot, "summary.json"),
      toolLogPath: path.join(liveRoot, "tool-log.json"),
      commandLogPath: path.join(liveRoot, "command-log.json"),
      ranAt: new Date().toISOString(),
    },
  });

  const result = await prepareHandoff("handoff-ready-state", dependencies, {
    publishBranch: false,
    createBranch: false,
    githubHandoffEnabled: false,
  });

  assert.equal(result.result.status, "handoff_ready");
  assert.equal(Boolean(result.result.handoffPackagePath), true);
  assert.equal(Boolean(result.result.prDraftPath), true);
  assert.equal(result.state.handoffStatus, "handoff_ready");
  assert.equal(result.state.prDraftStatus, "metadata_ready");
  assert.equal(result.state.handoffArtifactPaths.length >= 4, true);
  assert.equal(result.result.githubHandoffStatus, "skipped");

  const handoffPackage = JSON.parse(await readFile(result.result.handoffPackagePath!, "utf8")) as { prDraft: { title: string } };
  assert.equal(typeof handoffPackage.prDraft.title, "string");
});

test("prepareHandoff reports handoff_failed when preconditions are missing", async () => {
  const { dependencies } = await createPromotionReadyFixture("handoff-fail-state");
  const state = await dependencies.storage.loadState("handoff-fail-state");
  assert.ok(state);
  const issues = validateHandoffPreconditions(state!);
  assert.equal(issues.some((issue) => issue.includes("live pass")), true);
  assert.equal(issues.some((issue) => issue.includes("approved patch")), true);

  const result = await prepareHandoff("handoff-fail-state", dependencies, {
    publishBranch: false,
    createBranch: false,
    githubHandoffEnabled: false,
  });

  assert.equal(result.result.status, "handoff_failed");
  assert.equal(result.state.handoffStatus, "handoff_failed");
  assert.equal(result.result.issues.length >= 2, true);
});

test("buildPrDraftMetadata includes external automation handoff context when manual review is required", () => {
  const state = createInitialState({
    id: "handoff-external-automation-state",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Prepare a handoff package",
    objective: "Surface external automation handoff context",
    subtasks: ["handoff", "external-automation"],
    successCriteria: ["operator sees the external automation summary"],
  });

  state.lastExecutionReport = {
    iterationNumber: 1,
    changedFiles: ["tools/orchestrator/src/gpt-code-external-automation/index.ts"],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: ["Extended GitHub lane reliability summaries."],
    whyThisWasDone: ["Operator handoff needs dispatch context."],
    howBehaviorWasKeptStable: ["Only orchestrator automation state changed."],
    localValidation: [],
    ciValidation: null,
    blockers: [],
    risks: [],
    recommendedNextStep: "Review the external automation handoff context.",
    shouldCloseSlice: false,
    artifacts: [],
  };
  state.lastReviewVerdict = {
    verdict: "revise",
    reasons: ["Manual review is still required for the external lane."],
    violatedConstraints: [],
    missingValidation: [],
    suggestedPatchScope: [],
    canAutoContinue: false,
  };
  state.lastGptCodeAutomationState = {
    sourceAdapterStatus: "linked",
    sourceType: "github_pull_request_body",
    sourceLaneClassification: "github_pull_request_body_lane",
    sourceId: "github-pull-request-body:701",
    sourceCorrelationId: "inbound:delivery-handoff",
    sourcePayloadPath: "C:/tmp/payload.json",
    sourceHeadersPath: "C:/tmp/headers.json",
    sourceReceivedAt: "2026-03-18T00:00:00.000Z",
    transportSource: "github_pull_request_body",
    intakeStatus: "accepted",
    bridgeStatus: "accepted",
    dispatchStatus: "manual_required",
    dispatchTarget: "github_issue_comment",
    dispatchOutcome: "manual_required",
    intakeArtifactPath: null,
    bridgeArtifactRoot: null,
    outputPayloadPath: "C:/tmp/output.json",
    nextInstructionPath: "C:/tmp/next-instruction.md",
    dispatchArtifactPath: "C:/tmp/dispatch.json",
    automaticTriggerStatus: "triggered",
    targetAdapterStatus: "manual_required",
    targetType: "github_issue_comment",
    targetLaneClassification: "github_status_report_comment_lane",
    targetDestination: "github://example/bige/issues/comments/62002",
    targetAttemptCount: 2,
    targetRetryCount: 1,
    targetMaxAttempts: 2,
    routingDecision: "status_report_target",
    fallbackDecision: "live_smoke_target_fallback",
    dispatchCorrelationId: "orchestrator-next-instruction:handoff-external-automation-state",
    targetExternalReferenceId: "62002",
    targetExternalUrl: "https://github.com/example/bige/pull/78#issuecomment-62002",
    targetDispatchArtifactPath: "C:/tmp/dispatch-attempt-2.json",
    lastTargetFailureClass: "network",
    dispatchAttemptHistory: [],
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
    lastReplayOutcome: "manual_required",
    recoveryHistorySummary: "recovery#1 replay -> manual_required at 2026-03-18T00:00:02.000Z",
    operatorRecoveryRecommendation: "External lane can be replayed once under operator control; reuse the existing next instruction and re-check the routed target.",
    canRetryDispatch: false,
    dispatchExhausted: true,
    dispatchReliabilityOutcome: "manual_required",
    externalAutomationOutcome: "manual_required",
    lastReceivedAt: "2026-03-18T00:00:00.000Z",
    lastAttemptedAt: "2026-03-18T00:00:02.000Z",
    lastDispatchedAt: "2026-03-18T00:00:02.000Z",
    recommendedNextStep: "Review the dispatch history and fallback chain, then decide whether a safe manual retry is still possible.",
    manualReviewReason: "External target dispatch exhausted after 2/2 attempts.",
  };

  const prDraft = buildPrDraftMetadata({
    state,
    branchName: null,
    payloadPath: null,
    githubHandoffStatus: "skipped",
    githubHandoffReason: "metadata only",
    createdAt: "2026-03-18T00:00:03.000Z",
  });

  assert.equal(prDraft.body.includes("External automation:"), true);
  assert.equal(prDraft.body.includes("dispatch exhausted"), true);
  assert.equal(prDraft.approvalNotes.some((note) => note.includes("externalDispatchHistory=")), true);
  assert.equal(prDraft.approvalNotes.some((note) => note.includes("externalHandoff=")), true);
});
