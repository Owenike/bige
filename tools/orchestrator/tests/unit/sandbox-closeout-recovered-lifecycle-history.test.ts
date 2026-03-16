import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveredLifecycleHistory } from "../../src/sandbox-closeout-recovered-lifecycle-history";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovered lifecycle history retains lifecycle transitions", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovered-lifecycle-history-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovered-lifecycle-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track recovered lifecycle history",
    objective: "closeout recovered lifecycle history",
    subtasks: ["sandbox-closeout-recovered-lifecycle-history"],
    successCriteria: ["lifecycle transitions remain visible"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovered-lifecycle-history",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovered-lifecycle-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  state.lastCloseoutRecoveredLifecycleHistory =
    await buildSandboxCloseoutRecoveredLifecycleHistory({
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
    actorSource: "test-sandbox-closeout-recovered-lifecycle-history",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "recovered lifecycle regressed after clearance",
  });

  const history = await buildSandboxCloseoutRecoveredLifecycleHistory({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(history.latestLifecycleStatus, "recovered_regressed");
  assert.equal(
    history.previousLifecycleEntry?.lifecycleStatus,
    "recovered_cleared",
  );
  assert.equal(
    history.lifecycleTransitionSummary.includes(
      "recovered_cleared->recovered_regressed",
    ),
    true,
  );
});
