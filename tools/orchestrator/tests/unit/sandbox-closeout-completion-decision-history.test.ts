import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutCompletionDecisionHistory } from "../../src/sandbox-closeout-completion-decision-history";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout completion decision history summarizes repeated retained and reopened patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-decision-history-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-decision-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track repeated completion decision patterns",
    objective: "closeout completion decision history",
    subtasks: ["sandbox-closeout-completion-decision-history"],
    successCriteria: ["completion decision trends stay visible"],
  });

  const finalizedContextA = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-completion-decision-history",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: finalizedContextA.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-completion-decision-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: finalizedContextA.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: finalizedContextA.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-completion-decision-history",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: finalizedContextA.completionAudit.id,
    reason: "new governance blocker observed",
  });

  const followupContext = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "request_followup",
    actorSource: "test-sandbox-closeout-completion-decision-history",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: followupContext.loadedRegistry,
    action: "keep_carry_forward",
    actorSource: "test-sandbox-closeout-completion-decision-history",
    commandSource: "sandbox:closeout:completion:keep-carry-forward",
    completionAuditId: followupContext.completionAudit.id,
    reason: "follow-up remains open",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: followupContext.loadedRegistry,
    action: "keep_carry_forward",
    actorSource: "test-sandbox-closeout-completion-decision-history",
    commandSource: "sandbox:closeout:completion:keep-carry-forward",
    completionAuditId: followupContext.completionAudit.id,
    reason: "follow-up remains open",
  });

  const finalizedContextB = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-completion-decision-history",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: finalizedContextB.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-completion-decision-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: finalizedContextB.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: finalizedContextB.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-completion-decision-history",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: finalizedContextB.completionAudit.id,
    reason: "regression reopened completion thread",
  });

  const history = await buildSandboxCloseoutCompletionDecisionHistory({
    configPath,
    state,
    loadedRegistry: finalizedContextB.loadedRegistry,
    limit: 30,
  });

  assert.ok(history.retainedEntryCount >= 6);
  assert.ok(history.repeatedKeepCarryForwardPatterns.length > 0);
  assert.ok(history.repeatedReopenCompletionPatterns.length > 0);
  assert.ok(history.repeatedFinalizedToReopenedPatterns.length > 0);
});
