import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutPostFinalizationFollowupQueue } from "../../src/sandbox-closeout-post-finalization-followup-queue";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout post-finalization follow-up queue keeps reopened finalizations queued", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-post-finalization-followup-queue-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-post-finalization-followup-queue",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track post-finalization governance queue",
    objective: "closeout post-finalization follow-up queue",
    subtasks: ["sandbox-closeout-post-finalization-followup-queue"],
    successCriteria: ["post-finalization governance queue stays traceable"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-post-finalization-followup-queue",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-post-finalization-followup-queue",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-post-finalization-followup-queue",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "finalized thread was reopened by new evidence",
  });

  const queue = await buildSandboxCloseoutPostFinalizationFollowupQueue({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(queue.queueStatus, "reopened_after_finalization");
  assert.equal(queue.finalCompleteReached, true);
  assert.equal(queue.stableFinalComplete, false);
  assert.equal(queue.reopenedAfterFinalization, true);
  assert.ok(queue.blockedReasonsSummary.length > 0);
});
