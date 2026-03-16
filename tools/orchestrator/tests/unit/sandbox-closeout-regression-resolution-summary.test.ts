import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRegressionResolutionSummary } from "../../src/sandbox-closeout-regression-resolution-summary";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout regression resolution summary keeps reopened regressions active", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-regression-resolution-summary-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-regression-resolution-summary",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Decide whether recovery regression is resolved",
    objective: "closeout regression resolution summary",
    subtasks: ["sandbox-closeout-regression-resolution-summary"],
    successCriteria: ["active reopened regressions remain unresolved"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-regression-resolution-summary",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-regression-resolution-summary",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-regression-resolution-summary",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "regression remains active",
  });

  const summary = await buildSandboxCloseoutRegressionResolutionSummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(summary.regressionResolved, false);
  assert.equal(summary.regressionRemainsActive, true);
  assert.equal(summary.regressionResolutionStatus, "regression_reopened");
  assert.equal(summary.regressionStillImpactsRecoveredState, true);
});
