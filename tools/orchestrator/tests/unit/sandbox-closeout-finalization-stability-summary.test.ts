import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutFinalizationStabilitySummary } from "../../src/sandbox-closeout-finalization-stability-summary";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout finalization stability summary marks converged finalizations as stable", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-finalization-stability-stable-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-finalization-stability-stable",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Confirm stable final-complete",
    objective: "closeout finalization stability summary",
    subtasks: ["sandbox-closeout-finalization-stability-summary"],
    successCriteria: ["stable final-complete remains explicit"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-finalization-stability",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-finalization-stability",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  const stability = await buildSandboxCloseoutFinalizationStabilitySummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(stability.stabilityStatus, "stable_final_complete");
  assert.equal(stability.completionThreadStableFinalComplete, true);
  assert.equal(stability.postFinalizationFollowUpRemainsOpen, false);
});

test("sandbox closeout finalization stability summary keeps reopened threads out of stable final-complete", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-finalization-stability-reopened-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-finalization-stability-reopened",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Keep reopened finalization threads visible",
    objective: "closeout finalization stability summary",
    subtasks: ["sandbox-closeout-finalization-stability-summary"],
    successCriteria: ["reopened finalization threads stay unstable"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-finalization-stability",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-finalization-stability",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-finalization-stability",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "fresh blocker reopened the thread",
  });

  const stability = await buildSandboxCloseoutFinalizationStabilitySummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(stability.stabilityStatus, "reopened_after_finalization");
  assert.equal(stability.completionThreadStableFinalComplete, false);
  assert.equal(stability.completionThreadReopenedAfterFinalization, true);
});
