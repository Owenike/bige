import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveredExitHistory } from "../../src/sandbox-closeout-recovered-exit-history";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovered exit history keeps cleared-then-reopened patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovered-exit-history-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovered-exit-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track recovered cases that exit and re-enter governance",
    objective: "closeout recovered exit history",
    subtasks: ["sandbox-closeout-recovered-exit-history"],
    successCriteria: ["exit and re-entry patterns remain visible"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovered-exit-history",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovered-exit-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  state.lastCloseoutRecoveredExitHistory =
    await buildSandboxCloseoutRecoveredExitHistory({
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
    actorSource: "test-sandbox-closeout-recovered-exit-history",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "cleared case reopened after exit",
  });

  const history = await buildSandboxCloseoutRecoveredExitHistory({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(history.exitCount >= 1, true);
  assert.equal(history.reEntryCount >= 1, true);
  assert.equal(
    history.repeatedClearedThenReopenedPatterns.includes("recovered_then_reopened") ||
      history.latestReEntryEntry?.pattern === "cleared_then_reopened",
    true,
  );
});
