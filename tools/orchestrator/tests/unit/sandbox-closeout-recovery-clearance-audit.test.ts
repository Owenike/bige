import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveryClearanceAudit } from "../../src/sandbox-closeout-recovery-clearance-audit";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovery clearance audit clears clean recovered cases", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovery-clearance-audit-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovery-clearance-audit",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Decide when a recovered case can leave recovery governance",
    objective: "closeout recovery clearance audit",
    subtasks: ["sandbox-closeout-recovery-clearance-audit"],
    successCriteria: ["clean recovered cases are cleared from governance"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovery-clearance-audit",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovery-clearance-audit",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  const audit = await buildSandboxCloseoutRecoveryClearanceAudit({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(audit.recoveryClearanceStatus, "clearance_allowed");
  assert.equal(audit.recoveryClearanceAllowed, true);
  assert.equal(audit.caseClearedFromGovernanceMonitoring, true);
  assert.equal(audit.caseRemainsMonitored, false);
});
