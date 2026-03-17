import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRetirementExitCriteria } from "../../src/sandbox-closeout-retirement-exit-criteria";
import { createCloseoutCompletionSandboxConfig } from "./helpers/prepare-closeout-completion";

test("sandbox closeout retirement exit criteria keeps reopenable retirement as provisional pass", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-retirement-exit-criteria-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-retirement-exit-criteria",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Evaluate retirement exit criteria for recovered cases",
    objective: "closeout retirement exit criteria",
    subtasks: ["sandbox-closeout-retirement-exit-criteria"],
    successCriteria: ["provisional retirement passes remain explicit"],
  });

  const criteria = await buildSandboxCloseoutRetirementExitCriteria({
    configPath,
    state,
    limit: 20,
    closeoutRecoveryRetirementAudit: {
      latestRecoveryStatus: "high_confidence_recovered",
      recoveryRetirementStatus: "retirement_allowed_but_reopenable",
      latestRecoveryClearanceStatus: "clearance_allowed_but_reopenable",
      latestRegressionResolutionStatus: "regression_resolved",
      latestWatchlistStatus: "empty",
      retirementAllowed: true,
      retirementSupportingReasons: ["recovery_retirement_reviewed"],
      retirementBlockedReasons: ["case_remains_reopenable"],
      recommendedNextOperatorStep: "recovery_retirement_reviewed",
    } as never,
    closeoutRecoveredRetirementSummary: {
      latestMonitoringStatus: "monitoring_exit_allowed",
      retirementReady: false,
      retirementProvisional: true,
      retirementReasons: ["recovered_but_still_active"],
      retirementWarnings: ["retirement_provisional"],
      recommendedNextOperatorStep: "recovery_retirement_reviewed",
    } as never,
    closeoutRecoveryRetirementQueue: {
      queueStatus: "retirement_provisional",
      regressionRiskFlag: false,
      reentryRiskFlag: false,
      retirementBlockedReasons: ["case_remains_reopenable"],
      recommendedNextOperatorStep: "recovery_retirement_reviewed",
    } as never,
    closeoutRecoveryClearanceHistory: {
      historyReasons: ["clearance_allowed_but_reopenable"],
      repeatedClearanceThenReEnterPatterns: [],
    } as never,
    closeoutRecoveredLifecycleHistory: {
      repeatedReEnteredPatterns: [],
      historyReasons: ["recovered_but_reopenable"],
    } as never,
    closeoutRecoveryConfidenceTrend: {
      trendRemainsUnresolved: true,
      confidenceTrendReasons: ["stable_but_provisional"],
    } as never,
    closeoutRegressionResolutionSummary: {
      regressionRemainsActive: false,
      regressionStillImpactsRecoveredState: false,
      regressionResolutionStatus: "regression_resolved",
      regressionResolutionReasons: ["regression_resolved"],
      regressionBlockers: [],
    } as never,
  });

  assert.equal(criteria.retirementExitCriteriaStatus, "provisional_pass");
  assert.equal(criteria.retirementCriteriaMet, true);
  assert.equal(criteria.criteriaAreStrictPass, false);
  assert.equal(criteria.criteriaAreProvisionalPass, true);
  assert.equal(criteria.criteriaRemainUnmet, false);
});
