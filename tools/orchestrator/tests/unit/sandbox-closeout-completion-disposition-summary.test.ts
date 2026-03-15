import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutCompletionDispositionSummary } from "../../src/sandbox-closeout-completion-disposition-summary";
import { runSandboxCloseoutCompletionAction } from "../../src/sandbox-closeout-completion-actions";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout completion disposition summary reports closeout_complete_confirmed", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-disposition-complete-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-disposition-complete",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize finalized closeout completion disposition",
    objective: "closeout completion disposition",
    subtasks: ["sandbox-closeout-completion-disposition-summary"],
    successCriteria: ["closeout complete confirmation is summarized centrally"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-completion-disposition",
  });
  const action = await runSandboxCloseoutCompletionAction({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-completion-disposition",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  assert.equal(action.status, "accepted");

  const summary = await buildSandboxCloseoutCompletionDispositionSummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(summary.dispositionResult, "closeout_complete_confirmed");
  assert.equal(summary.completionQueueExitAllowed, true);
  assert.equal(summary.carryForwardRemainsOpen, false);
});

test("sandbox closeout completion disposition summary reports carry_forward_retained", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-disposition-retained-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-disposition-retained",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize retained carry-forward completion disposition",
    objective: "closeout completion disposition",
    subtasks: ["sandbox-closeout-completion-disposition-summary"],
    successCriteria: ["carry-forward retention is summarized centrally"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "request_followup",
    actorSource: "test-sandbox-closeout-completion-disposition",
  });
  const action = await runSandboxCloseoutCompletionAction({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "keep_carry_forward",
    actorSource: "test-sandbox-closeout-completion-disposition",
    commandSource: "sandbox:closeout:completion:keep-carry-forward",
    completionAuditId: context.completionAudit.id,
  });
  assert.equal(action.status, "accepted");

  const summary = await buildSandboxCloseoutCompletionDispositionSummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(summary.dispositionResult, "carry_forward_retained");
  assert.equal(summary.carryForwardRemainsOpen, true);
  assert.equal(summary.completionQueueExitAllowed, false);
});
