import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutCompletionFinalizationSummary } from "../../src/sandbox-closeout-completion-finalization-summary";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout completion finalization summary marks fully converged threads as final-complete", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-finalization-complete-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-finalization-complete",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Confirm closeout finalization",
    objective: "closeout completion finalization summary",
    subtasks: ["sandbox-closeout-completion-finalization-summary"],
    successCriteria: ["final-complete remains explicit"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-completion-finalization",
  });
  const decision = await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-completion-finalization",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  const finalization = await buildSandboxCloseoutCompletionFinalizationSummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
    closeoutCompletionDecisionAudit: decision.completionDecisionAudit,
    closeoutCompletionDecisionHistory: decision.completionDecisionHistory,
    closeoutCompletionDispositionSummary: decision.completionDispositionSummary,
    closeoutCompletionLifecycle: decision.completionLifecycle,
    closeoutCompletionCarryForwardQueue: decision.completionCarryForwardQueue,
    closeoutCompletionResolutionSummary: decision.completionResolution,
  });

  assert.equal(finalization.finalizationStatus, "final_complete");
  assert.equal(finalization.completionThreadFinalComplete, true);
  assert.equal(finalization.caseCanBeTreatedAsFinalComplete, true);
});

test("sandbox closeout completion finalization summary keeps reopened threads away from final-complete", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-completion-finalization-reopened-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-completion-finalization-reopened",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Keep reopened completion threads out of final-complete",
    objective: "closeout completion finalization summary",
    subtasks: ["sandbox-closeout-completion-finalization-summary"],
    successCriteria: ["reopened completion threads stay visible"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-completion-finalization",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-completion-finalization",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  const reopened = await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-completion-finalization",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "new evidence re-opened the thread",
  });

  const finalization = await buildSandboxCloseoutCompletionFinalizationSummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
    closeoutCompletionDecisionAudit: reopened.completionDecisionAudit,
    closeoutCompletionDecisionHistory: reopened.completionDecisionHistory,
    closeoutCompletionDispositionSummary: reopened.completionDispositionSummary,
    closeoutCompletionLifecycle: reopened.completionLifecycle,
    closeoutCompletionCarryForwardQueue: reopened.completionCarryForwardQueue,
    closeoutCompletionResolutionSummary: reopened.completionResolution,
  });

  assert.equal(finalization.finalizationStatus, "reopened");
  assert.equal(finalization.completionThreadFinalComplete, false);
  assert.equal(finalization.completionThreadReopened, true);
  assert.equal(finalization.caseCanBeTreatedAsFinalComplete, false);
});
