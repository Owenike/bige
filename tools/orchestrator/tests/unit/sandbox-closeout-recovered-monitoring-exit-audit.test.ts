import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutRecoveredMonitoringExitAudit } from "../../src/sandbox-closeout-recovered-monitoring-exit-audit";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout recovered monitoring exit audit allows clean recovered cases to leave monitoring", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-recovered-monitoring-exit-audit-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-recovered-monitoring-exit-audit",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Decide when recovered monitoring can be exited",
    objective: "closeout recovered monitoring exit audit",
    subtasks: ["sandbox-closeout-recovered-monitoring-exit-audit"],
    successCriteria: ["clean recovered cases can leave monitoring"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-recovered-monitoring-exit-audit",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-recovered-monitoring-exit-audit",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  const audit = await buildSandboxCloseoutRecoveredMonitoringExitAudit({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(audit.monitoringExitAllowed, true);
  assert.equal(audit.monitoringExitStatus, "monitoring_exit_allowed");
  assert.equal(audit.caseLeavesMonitoringQueue, true);
  assert.equal(audit.caseRecoveredAndMonitoringComplete, true);
});
