import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutFinalizationAuditHistory } from "../../src/sandbox-closeout-finalization-audit-history";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout finalization audit history keeps finalized-then-reopened patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-finalization-audit-history-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-finalization-audit-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track finalization after reopen",
    objective: "closeout finalization audit history",
    subtasks: ["sandbox-closeout-finalization-audit-history"],
    successCriteria: ["reopened-after-finalization patterns stay visible"],
  });

  const contextA = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: contextA.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: contextA.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: contextA.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: contextA.completionAudit.id,
    reason: "new evidence reopened the finalization thread",
  });

  const contextB = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: contextB.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: contextB.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: contextB.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: contextB.completionAudit.id,
    reason: "new evidence reopened the finalization thread",
  });

  const contextC = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: contextC.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: contextC.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: contextC.loadedRegistry,
    action: "keep_carry_forward",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
    commandSource: "sandbox:closeout:completion:keep-carry-forward",
    completionAuditId: contextC.completionAudit.id,
    reason: "post-finalization follow-up remained open",
  });
  const contextD = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: contextD.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: contextD.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: contextD.loadedRegistry,
    action: "keep_carry_forward",
    actorSource: "test-sandbox-closeout-finalization-audit-history",
    commandSource: "sandbox:closeout:completion:keep-carry-forward",
    completionAuditId: contextD.completionAudit.id,
    reason: "post-finalization follow-up remained open",
  });

  const history = await buildSandboxCloseoutFinalizationAuditHistory({
    configPath,
    state,
    loadedRegistry: contextD.loadedRegistry,
    limit: 20,
  });

  assert.ok(history.retainedEntryCount >= 3);
  assert.equal(history.latestFinalizationStatus, "retained");
  assert.ok(history.repeatedReopenedAfterFinalizationPatterns.length > 0);
  assert.ok(history.repeatedRetainedAfterFinalizationPatterns.length > 0);
});
