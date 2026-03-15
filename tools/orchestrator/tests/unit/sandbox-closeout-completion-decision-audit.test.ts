import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { listSandboxCloseoutCompletionDecisionAudit } from "../../src/sandbox-closeout-completion-decision-audit";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout completion decision audit captures retained decision snapshots", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-decision-audit-retained-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-decision-audit-retained",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Capture retained completion decision snapshots",
    objective: "closeout completion decision audit",
    subtasks: ["sandbox-closeout-completion-decision-audit"],
    successCriteria: ["retained completion decisions remain traceable"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "request_followup",
    actorSource: "test-sandbox-closeout-completion-decision-audit",
  });

  const decision = await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "keep_carry_forward",
    actorSource: "test-sandbox-closeout-completion-decision-audit",
    commandSource: "sandbox:closeout:completion:keep-carry-forward",
    completionAuditId: context.completionAudit.id,
    reason: "follow-up remains open",
  });

  assert.equal(decision.result.status, "accepted");
  assert.equal(decision.completionDecisionAudit.latestCompletionAction, "keep_carry_forward");
  assert.equal(
    decision.completionDecisionAudit.dispositionSnapshot.dispositionResult,
    "carry_forward_retained",
  );
  assert.equal(
    decision.completionDecisionAudit.lifecycleSnapshot.lifecycleStatus,
    "carry_forward_retained",
  );
  assert.equal(decision.completionDecisionAudit.completionRetained, true);
  assert.equal(decision.completionDecisionAudit.completionReopened, false);
  assert.ok(decision.completionDecisionAudit.queueRetainedReasons.length > 0);
  assert.ok(decision.completionDecisionAudit.missingFollowUpSignals.length > 0);

  const trail = await listSandboxCloseoutCompletionDecisionAudit({
    configPath,
    limit: 10,
  });
  assert.equal(trail.records[0]?.latestCompletionAction, "keep_carry_forward");
});

test("sandbox closeout completion decision audit captures finalized completion snapshots", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-decision-audit-finalized-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-decision-audit-finalized",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Capture finalized completion decision snapshots",
    objective: "closeout completion decision audit",
    subtasks: ["sandbox-closeout-completion-decision-audit"],
    successCriteria: ["finalized completion decisions remain traceable"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-completion-decision-audit",
  });

  const decision = await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-completion-decision-audit",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  assert.equal(decision.result.status, "accepted");
  assert.equal(
    decision.completionDecisionAudit.latestCompletionAction,
    "confirm_closeout_complete",
  );
  assert.equal(decision.completionDecisionAudit.completionFinalized, true);
  assert.equal(
    decision.completionDecisionAudit.lifecycleSnapshot.lifecycleStatus,
    "closeout_complete_finalized",
  );
});
