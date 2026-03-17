import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRetiredCaseAuditHistory } from "../../src/sandbox-closeout-retired-case-audit-history";
import { createCloseoutCompletionSandboxConfig } from "./helpers/prepare-closeout-completion";

test("sandbox closeout retired-case audit history retains retired then re-added patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-retired-case-audit-history-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-retired-case-audit-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track retired-case audit history",
    objective: "closeout retired-case audit history",
    subtasks: ["sandbox-closeout-retired-case-audit-history"],
    successCriteria: ["retired then re-added patterns remain visible"],
  });

  state.lastCloseoutRetiredCaseAuditHistory =
    await buildSandboxCloseoutRetiredCaseAuditHistory({
      configPath,
      state,
      limit: 20,
      closeoutRecoveryRetirementHistory: {
        entries: [
          {
            recordedAt: "2026-03-17T00:00:00.000Z",
            recoveryRetirementStatus: "retirement_allowed",
            retirementAllowed: true,
            caseLeavesActiveGovernance: true,
            caseRemainsReopenable: false,
            caseRemainsRegressionProne: false,
            summaryLine: "retired",
          },
        ],
        latestRetirementStatus: "retirement_allowed",
        repeatedRetiredThenReenteredPatterns: [],
        repeatedRetiredThenRegressedPatterns: [],
        repeatedRetiredThenWatchlistReaddedPatterns: [],
        historyReasons: [],
      } as never,
      closeoutRecoveredExitHistory: {
        reEntryCount: 0,
        repeatedExitThenReEnterPatterns: [],
        latestReEntryEntry: null,
        historyReasons: [],
      } as never,
      closeoutRecoveredLifecycle: {
        caseHasReEnteredGovernance: false,
        caseHasRegressed: false,
        lifecycleReasons: ["retired_case_stable"],
        recommendedNextOperatorStep: "retired_case_stable",
      } as never,
      closeoutRecoveryRegressionAudit: {
        regressionDetected: false,
        latestRegressionStatus: "none",
        repeatedRecoveredThenRegressedPatterns: [],
        regressionReasons: [],
      } as never,
      closeoutWatchlistReAddHistory: {
        reAddCount: 0,
        latestReAddEntry: null,
        repeatedResolvedThenReAddedPatterns: [],
        repeatedExitThenReopenPatterns: [],
        unresolvedReAddReasons: [],
      } as never,
    });

  const history = await buildSandboxCloseoutRetiredCaseAuditHistory({
    configPath,
    state,
    limit: 20,
    closeoutRecoveryRetirementHistory: {
      entries: [
        {
          recordedAt: "2026-03-17T00:00:00.000Z",
          recoveryRetirementStatus: "retirement_allowed",
          retirementAllowed: true,
          caseLeavesActiveGovernance: true,
          caseRemainsReopenable: false,
          caseRemainsRegressionProne: false,
          summaryLine: "retired",
        },
      ],
      latestRetirementStatus: "retirement_allowed",
      repeatedRetiredThenReenteredPatterns: [],
      repeatedRetiredThenRegressedPatterns: [],
      repeatedRetiredThenWatchlistReaddedPatterns: ["resolved_then_readded"],
      historyReasons: ["watchlist_readded"],
    } as never,
    closeoutRecoveredExitHistory: {
      reEntryCount: 0,
      repeatedExitThenReEnterPatterns: [],
      latestReEntryEntry: null,
      historyReasons: [],
    } as never,
    closeoutRecoveredLifecycle: {
      caseHasReEnteredGovernance: false,
      caseHasRegressed: false,
      lifecycleReasons: ["retired_case_readded"],
      recommendedNextOperatorStep: "reassess_retired_case",
    } as never,
    closeoutRecoveryRegressionAudit: {
      regressionDetected: false,
      latestRegressionStatus: "none",
      repeatedRecoveredThenRegressedPatterns: [],
      regressionReasons: [],
    } as never,
    closeoutWatchlistReAddHistory: {
      reAddCount: 1,
      latestReAddEntry: {
        addedAt: "2026-03-17T01:00:00.000Z",
        reAddPattern: "resolved_then_readded",
      },
      repeatedResolvedThenReAddedPatterns: ["resolved_then_readded"],
      repeatedExitThenReopenPatterns: [],
      unresolvedReAddReasons: ["watchlist_readded"],
      recommendedNextOperatorStep: "reassess_retired_case",
    } as never,
  });

  assert.equal(history.latestPostRetirementStatus, "retired_then_readded");
  assert.equal(
    history.repeatedRetiredThenWatchlistReaddedPatterns.length > 0,
    true,
  );
  assert.equal(history.retiredCaseStateRemainsStable, false);
});
