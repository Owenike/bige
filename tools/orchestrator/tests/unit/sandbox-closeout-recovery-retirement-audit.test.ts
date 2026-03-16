import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import {
  buildSandboxCloseoutRecoveryRetirementAudit,
  type SandboxCloseoutRecoveryRetirementAudit,
} from "../../src/sandbox-closeout-recovery-retirement-audit";
import { createCloseoutCompletionSandboxConfig } from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovery retirement audit allows fully cleared recovered cases to leave active governance", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovery-retirement-audit-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovery-retirement-audit",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Audit retirement readiness for recovered cases",
    objective: "closeout recovery retirement audit",
    subtasks: ["sandbox-closeout-recovery-retirement-audit"],
    successCriteria: ["fully cleared recovered cases can retire"],
  });

  const audit = await buildSandboxCloseoutRecoveryRetirementAudit({
    configPath,
    state,
    limit: 20,
    closeoutRecoveryConfidenceTrend: {
      latestRecoveryConfidenceLevel: "high_confidence_recovered",
      confidenceTrendReasons: ["improving_to_high_confidence"],
      trendRemainsUnresolved: false,
    } as never,
    closeoutRegressionResolutionSummary: {
      regressionResolutionStatus: "regression_resolved",
      regressionRemainsActive: false,
      regressionStillImpactsRecoveredState: false,
      regressionResolutionReasons: ["regression_resolved"],
      regressionBlockers: [],
      recommendedNextOperatorStep: "regression_resolved",
    } as never,
    closeoutRecoveredMonitoringExitAudit: {
      monitoringExitStatus: "monitoring_exit_allowed",
      monitoringExitAllowed: true,
      monitoringExitSupportingReasons: ["recovered_monitoring_exit_allowed"],
      monitoringExitBlockedReasons: [],
      caseRemainsMonitored: false,
      caseRecoveredButStillReopenable: false,
      auditedAt: "2026-03-17T00:00:00.000Z",
    } as never,
    closeoutRecoveryClearanceAudit: {
      latestWatchlistStatus: "empty",
      latestFollowupStatus: "empty",
      recoveryClearanceStatus: "clearance_allowed",
      recoveryClearanceAllowed: true,
      recoveryClearanceSupportingReasons: ["recovery_clearance_allowed"],
      recoveryClearanceBlockedReasons: [],
      caseRemainsReopenable: false,
      caseRemainsRegressionProne: false,
      recommendedNextOperatorStep: "recovery_governance_cleared",
      auditedAt: "2026-03-17T00:00:00.000Z",
    } as never,
    closeoutRecoveredExitHistory: {
      reEntryCount: 0,
      historyReasons: [],
    } as never,
    closeoutRecoveredLifecycle: {
      latestRecoveryStatus: "high_confidence_recovered",
      lifecycleStatus: "recovered_cleared",
      caseHasRegressed: false,
      caseHasReEnteredGovernance: false,
      caseRemainsReopenable: false,
      lifecycleReasons: ["recovered_case_cleared"],
      recommendedNextOperatorStep: "recovered_lifecycle_cleared",
    } as never,
  });

  assert.equal(audit.recoveryRetirementStatus, "retirement_allowed");
  assert.equal(audit.retirementAllowed, true);
  assert.equal(audit.caseLeavesActiveGovernance, true);
  assert.equal(audit.caseRemainsMonitored, false);
  assert.equal(audit.caseRemainsReopenable, false);
});
