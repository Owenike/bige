import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutStabilityRecoverySummary } from "../../src/sandbox-closeout-stability-recovery-summary";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout stability recovery summary marks clean exits as recovered", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-stability-recovery-summary-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-stability-recovery-summary",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Confirm when a watchlist case is truly recovered",
    objective: "closeout stability recovery summary",
    subtasks: ["sandbox-closeout-stability-recovery-summary"],
    successCriteria: ["clean exits are marked recovered"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-stability-recovery-summary",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-stability-recovery-summary",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  const recovery = await buildSandboxCloseoutStabilityRecoverySummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(recovery.recoveryAchieved, true);
  assert.equal(recovery.recoveryStatus, "recovery_achieved");
  assert.equal(recovery.watchlistRemainsOpen, false);
  assert.equal(recovery.reAddRiskRemainsHigh, false);
});

test("sandbox closeout stability recovery summary blocks reopened watchlist cases", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-stability-recovery-summary-blocked-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-stability-recovery-summary-blocked",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Do not overstate recovery while watchlist risk remains active",
    objective: "closeout stability recovery summary blocked",
    subtasks: ["sandbox-closeout-stability-recovery-summary-blocked"],
    successCriteria: ["reopened watchlist cases stay blocked"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-stability-recovery-summary-blocked",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-stability-recovery-summary-blocked",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-stability-recovery-summary-blocked",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "watchlist re-opened after apparent recovery",
  });

  const recovery = await buildSandboxCloseoutStabilityRecoverySummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(recovery.recoveryBlocked, true);
  assert.equal(recovery.watchlistRemainsOpen, true);
  assert.equal(recovery.recoveryStatus, "watchlist_still_open");
});
