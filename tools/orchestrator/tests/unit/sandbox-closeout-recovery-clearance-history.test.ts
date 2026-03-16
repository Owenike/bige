import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveryClearanceHistory } from "../../src/sandbox-closeout-recovery-clearance-history";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovery clearance history retains regressed clearance patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovery-clearance-history-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovery-clearance-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track recovery clearance history",
    objective: "closeout recovery clearance history",
    subtasks: ["sandbox-closeout-recovery-clearance-history"],
    successCriteria: ["clearance regressions remain visible in history"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovery-clearance-history",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovery-clearance-history",
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
    actorSource: "test-sandbox-closeout-recovery-clearance-history",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "recovered case regressed after clearance",
  });

  const history = await buildSandboxCloseoutRecoveryClearanceHistory({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(
    history.latestClearanceStatus.startsWith("clearance_blocked"),
    true,
  );
  assert.equal(
    history.previousClearanceAuditEntry?.recoveryClearanceStatus,
    "clearance_allowed",
  );
  assert.equal(history.repeatedClearanceThenRegressedPatterns.length > 0, true);
});
