import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import {
  listSandboxCloseoutCompletionActions,
  runSandboxCloseoutCompletionAction,
} from "../../src/sandbox-closeout-completion-actions";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout completion actions record accepted completion confirmations", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-actions-complete-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-actions-complete",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Confirm closeout completion decisions",
    objective: "closeout completion actions",
    subtasks: ["sandbox-closeout-completion-actions"],
    successCriteria: ["completion confirmations stay centralized"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-completion-actions",
  });

  const confirmReview = await runSandboxCloseoutCompletionAction({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_review_complete",
    actorSource: "test-sandbox-closeout-completion-actions",
    commandSource: "sandbox:closeout:completion:confirm-review",
    completionAuditId: context.completionAudit.id,
  });
  assert.equal(confirmReview.status, "accepted");
  assert.equal(confirmReview.completionAction.reviewCompleteConfirmed, true);

  const confirmCloseout = await runSandboxCloseoutCompletionAction({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-completion-actions",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  assert.equal(confirmCloseout.status, "accepted");
  assert.equal(confirmCloseout.completionAction.closeoutCompleteConfirmed, true);

  const trail = await listSandboxCloseoutCompletionActions({
    configPath,
    limit: 10,
  });
  assert.equal(trail.records[0]?.latestCompletionAction, "confirm_closeout_complete");
  assert.equal(trail.records[1]?.latestCompletionAction, "confirm_review_complete");
});

test("sandbox closeout completion actions retain carry-forward when follow-up remains open", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-actions-followup-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-actions-followup",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Retain carry-forward for incomplete completion thread",
    objective: "closeout completion actions",
    subtasks: ["sandbox-closeout-completion-actions"],
    successCriteria: ["follow-up-open case keeps carry-forward action"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "request_followup",
    actorSource: "test-sandbox-closeout-completion-actions",
  });

  const result = await runSandboxCloseoutCompletionAction({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "keep_carry_forward",
    actorSource: "test-sandbox-closeout-completion-actions",
    commandSource: "sandbox:closeout:completion:keep-carry-forward",
    completionAuditId: context.completionAudit.id,
    reason: "follow-up remains open",
  });

  assert.equal(result.status, "accepted");
  assert.equal(result.completionAction.carryForwardRetained, true);
});

test("sandbox closeout completion actions do not confirm closeout completion while follow-up stays open", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-actions-blocked-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-actions-blocked",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Block unsafe closeout completion confirmation",
    objective: "closeout completion actions",
    subtasks: ["sandbox-closeout-completion-actions"],
    successCriteria: ["unsafe completion confirmation stays blocked"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "request_followup",
    actorSource: "test-sandbox-closeout-completion-actions",
  });

  const result = await runSandboxCloseoutCompletionAction({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-completion-actions",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  assert.notEqual(result.status, "accepted");
  assert.equal(result.failureReason, "sandbox_closeout_complete_not_ready");
  assert.equal(result.completionAction.closeoutCompleteConfirmed, false);
});
