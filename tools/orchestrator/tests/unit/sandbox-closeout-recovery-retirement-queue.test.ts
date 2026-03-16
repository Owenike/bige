import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveryRetirementQueue } from "../../src/sandbox-closeout-recovery-retirement-queue";
import { createCloseoutCompletionSandboxConfig } from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovery retirement queue retains recovered cases with re-entry risk", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovery-retirement-queue-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovery-retirement-queue",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Queue recovered cases that cannot retire",
    objective: "closeout recovery retirement queue",
    subtasks: ["sandbox-closeout-recovery-retirement-queue"],
    successCriteria: ["re-entry risk remains in retirement backlog"],
  });

  const queue = await buildSandboxCloseoutRecoveryRetirementQueue({
    configPath,
    state,
    limit: 20,
    closeoutRecoveryRetirementAudit: {
      latestRecoveryStatus: "high_confidence_recovered",
      latestMonitoringExitStatus: "monitoring_exit_allowed",
      recoveryRetirementStatus: "retirement_blocked_by_reentry_risk",
      caseRemainsMonitored: true,
      caseRemainsRegressionProne: false,
      auditedAt: "2026-03-17T00:00:00.000Z",
      retirementBlockedReasons: ["reentry_risk_remains_active"],
      recommendedNextOperatorStep: "review_reentry_risk",
    } as never,
    closeoutRecoveredRetirementSummary: {
      latestRecoveryStatus: "high_confidence_recovered",
      retirementReady: false,
      retirementProvisional: false,
      recommendedNextOperatorStep: "review_reentry_risk",
      retirementWarnings: ["reentry_risk_remains_active"],
    } as never,
    closeoutRecoveryClearanceHistory: {
      historyReasons: ["clearance_then_reenter"],
      repeatedClearanceThenReEnterPatterns: ["cleared_then_reenter"],
    } as never,
    closeoutRecoveredLifecycleHistory: {
      repeatedRegressedPatterns: [],
      repeatedReEnteredPatterns: ["recovered_reentered"],
      historyReasons: ["reentered_recovery_governance"],
    } as never,
  });

  assert.equal(queue.queueStatus, "reentry_risk");
  assert.equal(queue.latestQueueEntry?.queueStatus, "reentry_risk");
  assert.equal(queue.recovered, true);
  assert.equal(queue.retirementReady, false);
  assert.equal(queue.reentryRiskFlag, true);
});
