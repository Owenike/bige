import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveryConfidenceTrend } from "../../src/sandbox-closeout-recovery-confidence-trend";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovery confidence trend marks improving recovery confidence", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovery-confidence-trend-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovery-confidence-trend",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track whether recovery confidence is improving",
    objective: "closeout recovery confidence trend",
    subtasks: ["sandbox-closeout-recovery-confidence-trend"],
    successCriteria: ["recovery confidence improves to high confidence"],
  });
  state.lastCloseoutRecoveryConfidence = {
    latestRecoveryStatus: "recovery_provisional",
    latestWatchlistStatus: "empty",
    latestDriftStatus: "none",
    latestReopenRecurrenceStatus: "none",
    latestFollowupStatus: "empty",
    recoveryConfidenceLevel: "provisional_recovered",
    recoveryConfidenceReasons: ["previous_provisional_recovery"],
    recoveryConfidenceBlockers: ["case_remains_reopenable"],
    recoveryHighConfidence: false,
    recoveryProvisional: true,
    recoveryLowConfidence: false,
    caseRemainsReopenable: true,
    watchlistRemainsOpen: false,
    recommendedNextOperatorStep: "monitor_provisional_recovery",
    summaryLine: "Previous provisional recovery snapshot.",
  };
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovery-confidence-trend",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovery-confidence-trend",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  const trend = await buildSandboxCloseoutRecoveryConfidenceTrend({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(trend.previousRecoveryConfidenceLevel, "provisional_recovered");
  assert.equal(trend.latestRecoveryConfidenceLevel, "high_confidence_recovered");
  assert.equal(trend.confidenceTrend, "improving_to_high_confidence");
  assert.equal(trend.confidenceImproving, true);
});
