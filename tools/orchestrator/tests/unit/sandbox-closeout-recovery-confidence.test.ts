import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveryConfidence } from "../../src/sandbox-closeout-recovery-confidence";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovery confidence marks clean recovery as high confidence", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovery-confidence-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovery-confidence",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Judge whether recovery is high confidence",
    objective: "closeout recovery confidence",
    subtasks: ["sandbox-closeout-recovery-confidence"],
    successCriteria: ["clean recovery is high confidence"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovery-confidence",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovery-confidence",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  const confidence = await buildSandboxCloseoutRecoveryConfidence({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(confidence.recoveryConfidenceLevel, "high_confidence_recovered");
  assert.equal(confidence.recoveryHighConfidence, true);
  assert.equal(confidence.watchlistRemainsOpen, false);
  assert.equal(confidence.caseRemainsReopenable, false);
});
