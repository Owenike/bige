import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveryRegressionAudit } from "../../src/sandbox-closeout-recovery-regression-audit";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovery regression audit captures repeated recovered-then-reopened patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovery-regression-audit-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovery-regression-audit",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track recovery regressions after apparent recovery",
    objective: "closeout recovery regression audit",
    subtasks: ["sandbox-closeout-recovery-regression-audit"],
    successCriteria: ["recovered-then-reopened patterns remain visible"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovery-regression-audit",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovery-regression-audit",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-recovery-regression-audit",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "first regression after recovery",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovery-regression-audit",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-recovery-regression-audit",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "second regression after recovery",
  });

  const regression = await buildSandboxCloseoutRecoveryRegressionAudit({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(regression.regressionDetected, true);
  assert.equal(regression.latestRegressionStatus, "recovered_then_reopened");
  assert.equal(regression.regressionSeverity, "high");
  assert.equal(regression.repeatedRecoveredThenReopenedPatterns.length > 0, true);
  assert.equal(regression.regressionCount >= 2, true);
});
