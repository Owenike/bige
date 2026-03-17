import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveryRetirementHistory } from "../../src/sandbox-closeout-recovery-retirement-history";
import { createCloseoutCompletionSandboxConfig } from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovery retirement history retains retired then regressed patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovery-retirement-history-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovery-retirement-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track retirement history for recovered cases",
    objective: "closeout recovery retirement history",
    subtasks: ["sandbox-closeout-recovery-retirement-history"],
    successCriteria: ["retired then regressed patterns remain visible"],
  });

  state.lastCloseoutRecoveryRetirementHistory =
    await buildSandboxCloseoutRecoveryRetirementHistory({
      configPath,
      state,
      limit: 20,
      closeoutRecoveryRetirementAudit: {
        recoveryRetirementStatus: "retirement_allowed",
        retirementAllowed: true,
        caseLeavesActiveGovernance: true,
        caseRemainsReopenable: false,
        caseRemainsRegressionProne: false,
        auditedAt: "2026-03-17T00:00:00.000Z",
        summaryLine: "Sandbox closeout recovery retirement audit: case retired.",
        retirementBlockedReasons: [],
        recommendedNextOperatorStep: "recovery_governance_retired",
      } as never,
      closeoutRecoveredReentryAudit: {
        reentryDetected: false,
        latestReentryStatus: "no_reentry",
        repeatedExitThenReenterPatterns: [],
        repeatedClearedThenReenterPatterns: [],
        repeatedRecoveredThenRegressedPatterns: [],
        reentryReasons: [],
        recommendedNextOperatorStep: "recovery_governance_retired",
      } as never,
      closeoutRecoveredLifecycle: {
        caseHasRegressed: false,
        lifecycleStatus: "recovered_cleared",
        lifecycleReasons: ["recovered_case_cleared"],
      } as never,
      closeoutWatchlistReAddHistory: {
        reAddCount: 0,
        repeatedResolvedThenReAddedPatterns: [],
        repeatedExitThenReopenPatterns: [],
        repeatedExitThenFollowupOpenPatterns: [],
        unresolvedReAddReasons: [],
      } as never,
    });

  const history = await buildSandboxCloseoutRecoveryRetirementHistory({
    configPath,
    state,
    limit: 20,
    closeoutRecoveryRetirementAudit: {
      recoveryRetirementStatus: "retirement_blocked_by_regression",
      retirementAllowed: false,
      caseLeavesActiveGovernance: false,
      caseRemainsReopenable: false,
      caseRemainsRegressionProne: true,
      auditedAt: "2026-03-17T01:00:00.000Z",
      summaryLine: "Sandbox closeout recovery retirement audit: blocked by regression.",
      retirementBlockedReasons: ["regression_reopened"],
      recommendedNextOperatorStep: "reopen_recovery_governance",
    } as never,
    closeoutRecoveredReentryAudit: {
      reentryDetected: true,
      latestReentryStatus: "recovered_then_regressed",
      repeatedExitThenReenterPatterns: [],
      repeatedClearedThenReenterPatterns: [],
      repeatedRecoveredThenRegressedPatterns: ["recovered_then_regressed"],
      reentryReasons: ["recovered_then_regressed"],
      recommendedNextOperatorStep: "reopen_recovery_governance",
    } as never,
    closeoutRecoveredLifecycle: {
      caseHasRegressed: true,
      lifecycleStatus: "recovered_regressed",
      lifecycleReasons: ["recovered_case_regressed"],
    } as never,
    closeoutWatchlistReAddHistory: {
      reAddCount: 0,
      repeatedResolvedThenReAddedPatterns: [],
      repeatedExitThenReopenPatterns: [],
      repeatedExitThenFollowupOpenPatterns: [],
      unresolvedReAddReasons: [],
    } as never,
  });

  assert.equal(history.latestRetirementStatus, "retirement_blocked_by_regression");
  assert.equal(
    history.previousRetirementAuditEntry?.recoveryRetirementStatus,
    "retirement_allowed",
  );
  assert.equal(history.repeatedRetiredThenRegressedPatterns.length > 0, true);
});
