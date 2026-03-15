import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutCompletionLifecycle } from "../../src/sandbox-closeout-completion-lifecycle";
import { runSandboxCloseoutCompletionAction } from "../../src/sandbox-closeout-completion-actions";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout completion lifecycle finalizes closeout-complete confirmations", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-lifecycle-complete-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-lifecycle-complete",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Finalize closeout-complete lifecycle",
    objective: "closeout completion lifecycle",
    subtasks: ["sandbox-closeout-completion-lifecycle"],
    successCriteria: ["closeout complete confirmation becomes finalized"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-completion-lifecycle",
  });
  const action = await runSandboxCloseoutCompletionAction({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-completion-lifecycle",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  assert.equal(action.status, "accepted");

  const lifecycle = await buildSandboxCloseoutCompletionLifecycle({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(lifecycle.lifecycleStatus, "closeout_complete_finalized");
  assert.equal(lifecycle.closeoutCompleteFinalized, true);
  assert.equal(lifecycle.carryForwardQueueShouldRemain, false);
  assert.equal(lifecycle.carryForwardQueueExitAllowed, true);
});

test("sandbox closeout completion lifecycle keeps carry-forward open when requested", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-lifecycle-retained-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-lifecycle-retained",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Retain carry-forward lifecycle",
    objective: "closeout completion lifecycle",
    subtasks: ["sandbox-closeout-completion-lifecycle"],
    successCriteria: ["carry-forward request keeps lifecycle open"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "request_followup",
    actorSource: "test-sandbox-closeout-completion-lifecycle",
  });
  const action = await runSandboxCloseoutCompletionAction({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "keep_carry_forward",
    actorSource: "test-sandbox-closeout-completion-lifecycle",
    commandSource: "sandbox:closeout:completion:keep-carry-forward",
    completionAuditId: context.completionAudit.id,
  });
  assert.equal(action.status, "accepted");

  const lifecycle = await buildSandboxCloseoutCompletionLifecycle({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(lifecycle.lifecycleStatus, "carry_forward_retained");
  assert.equal(lifecycle.keptCarryForwardOpen, true);
  assert.equal(lifecycle.carryForwardQueueShouldRemain, true);
  assert.equal(lifecycle.carryForwardQueueExitAllowed, false);
});

test("sandbox closeout completion lifecycle reopens finalized completion threads", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-lifecycle-reopen-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-lifecycle-reopen",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Reopen completion lifecycle",
    objective: "closeout completion lifecycle",
    subtasks: ["sandbox-closeout-completion-lifecycle"],
    successCriteria: ["reopen moves lifecycle back to retained governance"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-completion-lifecycle",
  });
  const action = await runSandboxCloseoutCompletionAction({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-completion-lifecycle",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
  });
  assert.equal(action.status, "accepted");

  const lifecycle = await buildSandboxCloseoutCompletionLifecycle({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(lifecycle.lifecycleStatus, "completion_reopened");
  assert.equal(lifecycle.completionReopened, true);
  assert.equal(lifecycle.carryForwardQueueShouldRemain, true);
  assert.equal(lifecycle.carryForwardQueueExitAllowed, false);
});
