import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveredMonitoringQueue } from "../../src/sandbox-closeout-recovered-monitoring-queue";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovered monitoring queue keeps low-confidence recovered cases under observation", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovered-monitoring-queue-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovered-monitoring-queue",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Keep recently recovered cases under monitoring when re-add risk remains high",
    objective: "closeout recovered monitoring queue",
    subtasks: ["sandbox-closeout-recovered-monitoring-queue"],
    successCriteria: ["recently recovered risky cases stay on monitoring queue"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovered-monitoring-queue",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovered-monitoring-queue",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-recovered-monitoring-queue",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "regression should keep the case observed",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovered-monitoring-queue",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  const queue = await buildSandboxCloseoutRecoveredMonitoringQueue({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.notEqual(queue.queueStatus, "empty");
  assert.equal(queue.recovered, true);
  assert.equal(queue.recoveryConfidenceLevel, "low_confidence_recovered");
  assert.equal(queue.regressionRiskFlag, true);
  assert.equal(queue.latestQueueEntry?.queueStatus, "regression_risk");
});
