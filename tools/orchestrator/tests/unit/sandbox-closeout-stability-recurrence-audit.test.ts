import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutStabilityRecurrenceAudit } from "../../src/sandbox-closeout-stability-recurrence-audit";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout stability recurrence audit captures repeated reopen and watchlist re-add patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-stability-recurrence-audit-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-stability-recurrence-audit",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track recurring stability risk patterns",
    objective: "closeout stability recurrence audit",
    subtasks: ["sandbox-closeout-stability-recurrence-audit"],
    successCriteria: ["repeated drift and re-add patterns remain visible"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-stability-recurrence-audit",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-stability-recurrence-audit",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-stability-recurrence-audit",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "first recurrence after finalization",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-stability-recurrence-audit",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-stability-recurrence-audit",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "second recurrence after finalization",
  });

  const audit = await buildSandboxCloseoutStabilityRecurrenceAudit({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(audit.recurrenceRemainsActive, true);
  assert.equal(audit.reopenRecurrenceCount >= 2, true);
  assert.equal(audit.watchlistReAddCount >= 2, true);
  assert.equal(audit.recurrenceSeverity, "high");
  assert.equal(audit.repeatedReopenAfterFinalizationPatterns.length > 0, true);
});
