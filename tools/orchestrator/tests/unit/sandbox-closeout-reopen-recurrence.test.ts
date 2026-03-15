import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutReopenRecurrence } from "../../src/sandbox-closeout-reopen-recurrence";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout reopen recurrence tracks repeated reopen-after-finalization patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-reopen-recurrence-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-reopen-recurrence",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track reopen recurrence after finalization",
    objective: "closeout reopen recurrence",
    subtasks: ["sandbox-closeout-reopen-recurrence"],
    successCriteria: ["repeated reopen remains explicit"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-reopen-recurrence",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-reopen-recurrence",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-reopen-recurrence",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "first reopen after finalization",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-reopen-recurrence",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-reopen-recurrence",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "second reopen after finalization",
  });

  const recurrence = await buildSandboxCloseoutReopenRecurrence({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(recurrence.reopenRecurrenceActive, true);
  assert.equal(recurrence.reopenCount >= 2, true);
  assert.equal(
    recurrence.latestReopenStatus,
    "repeated_reopen_after_finalization",
  );
  assert.equal(recurrence.recurrenceSeverity, "high");
  assert.equal(
    recurrence.repeatedFinalizedThenReopenedPatterns.length > 0,
    true,
  );
});
