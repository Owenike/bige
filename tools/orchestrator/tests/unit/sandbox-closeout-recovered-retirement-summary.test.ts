import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveredRetirementSummary } from "../../src/sandbox-closeout-recovered-retirement-summary";
import { createCloseoutCompletionSandboxConfig } from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovered retirement summary keeps reopenable cases active as provisional retirement", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovered-retirement-summary-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovered-retirement-summary",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize retirement readiness for recovered cases",
    objective: "closeout recovered retirement summary",
    subtasks: ["sandbox-closeout-recovered-retirement-summary"],
    successCriteria: ["reopenable recovered cases stay provisionally active"],
  });

  const summary = await buildSandboxCloseoutRecoveredRetirementSummary({
    configPath,
    state,
    limit: 20,
    closeoutRecoveryRetirementAudit: {
      latestRecoveryStatus: "high_confidence_recovered",
      latestRecoveredLifecycleStatus: "recovered_but_reopenable",
      latestRecoveryClearanceStatus: "clearance_allowed_but_reopenable",
      latestRegressionResolutionStatus: "regression_resolved",
      latestMonitoringExitStatus: "monitoring_exit_allowed",
      recoveryRetirementStatus: "retirement_allowed_but_reopenable",
      retirementAllowed: true,
      retirementSupportingReasons: ["recovery_retirement_reviewed"],
      retirementBlockedReasons: ["case_remains_reopenable"],
      caseLeavesActiveGovernance: false,
      caseRemainsMonitored: true,
      caseRemainsReopenable: true,
      caseRemainsRegressionProne: false,
      recommendedNextOperatorStep: "recovery_retirement_reviewed",
    } as never,
    closeoutRecoveryClearanceHistory: {
      historyReasons: ["clearance_allowed_but_reopenable"],
      repeatedClearanceThenReEnterPatterns: [],
      repeatedClearanceThenRegressedPatterns: [],
    } as never,
    closeoutRecoveredReentryAudit: {
      reentryReasons: [],
      recommendedNextOperatorStep: "recovered_reentry_reviewed",
    } as never,
    closeoutRecoveredLifecycleHistory: {
      historyReasons: ["recovered_but_reopenable"],
      lifecycleTransitionSummary: [
        "recovered_cleared->recovered_but_reopenable",
      ],
      recommendedNextOperatorStep: "recovered_lifecycle_watch",
    } as never,
    closeoutRecoveryConfidenceTrend: {
      confidenceTrendReasons: ["stable_but_provisional"],
      trendRemainsUnresolved: true,
    } as never,
    closeoutRegressionResolutionSummary: {
      regressionResolutionReasons: ["regression_resolved"],
    } as never,
  });

  assert.equal(summary.retirementReady, false);
  assert.equal(summary.retirementProvisional, true);
  assert.equal(summary.retirementBlocked, false);
  assert.equal(summary.caseRecoveredButStillActive, true);
  assert.equal(summary.caseRecoveredAndRetireable, false);
});
