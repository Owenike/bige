import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutStabilityDrift } from "../../src/sandbox-closeout-stability-drift";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout stability drift detects reopen-driven degradation", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-stability-drift-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-stability-drift",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Detect stability drift after finalization",
    objective: "closeout stability drift",
    subtasks: ["sandbox-closeout-stability-drift"],
    successCriteria: ["reopen-driven drift stays explicit"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-stability-drift",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-stability-drift",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-stability-drift",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "new evidence reopened the finalized thread",
  });

  const drift = await buildSandboxCloseoutStabilityDrift({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(drift.driftDetected, true);
  assert.equal(drift.driftSource, "reopen");
  assert.equal(drift.driftCameFromReopen, true);
  assert.equal(drift.caseDegradedToNonStable, true);
  assert.equal(drift.caseRemainsStableFinalComplete, false);
});
