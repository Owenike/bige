import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveryClearanceHistory } from "../../src/sandbox-closeout-recovery-clearance-history";
import { buildSandboxCloseoutRecoveredReentryAudit } from "../../src/sandbox-closeout-recovered-reentry-audit";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovered re-entry audit detects cleared cases that re-enter governance", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovered-reentry-audit-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovered-reentry-audit",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track recovered re-entry audit events",
    objective: "closeout recovered re-entry audit",
    subtasks: ["sandbox-closeout-recovered-reentry-audit"],
    successCriteria: ["re-entry events remain auditable"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovered-reentry-audit",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovered-reentry-audit",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  state.lastCloseoutRecoveryClearanceHistory =
    await buildSandboxCloseoutRecoveryClearanceHistory({
      configPath,
      state,
      loadedRegistry: context.loadedRegistry,
      limit: 20,
    });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-recovered-reentry-audit",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "cleared case re-entered governance",
  });

  const audit = await buildSandboxCloseoutRecoveredReentryAudit({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(audit.reentryDetected, true);
  assert.equal(audit.reentryCount >= 1, true);
  assert.equal(
    audit.latestReentryStatus === "reopened_after_cleared" ||
      audit.latestReentryStatus === "recovered_then_regressed",
    true,
  );
  assert.equal(audit.reentryRemainsActive, true);
});
