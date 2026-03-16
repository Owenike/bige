import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveredLifecycle } from "../../src/sandbox-closeout-recovered-lifecycle";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovered lifecycle marks reopened recovered cases as regressed", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovered-lifecycle-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovered-lifecycle",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track the recovered governance lifecycle",
    objective: "closeout recovered lifecycle",
    subtasks: ["sandbox-closeout-recovered-lifecycle"],
    successCriteria: ["reopened recovered cases stay regressed"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovered-lifecycle",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovered-lifecycle",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-recovered-lifecycle",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "recovered case regressed back into governance",
  });

  const lifecycle = await buildSandboxCloseoutRecoveredLifecycle({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(lifecycle.lifecycleStatus, "recovered_regressed");
  assert.equal(lifecycle.caseHasRegressed, true);
  assert.equal(lifecycle.caseCleared, false);
});
