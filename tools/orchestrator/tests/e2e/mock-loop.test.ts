import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState, createDefaultDependencies, runOrchestratorOnce } from "../../src/orchestrator";

test("mock orchestrator loop plans, executes, reviews, and advances state without touching product runtime", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-mock-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });

  const state = createInitialState({
    id: "mock-loop",
    repoPath,
    repoName: "bige",
    userGoal: "Build orchestrator MVP",
    objective: "Run a full mock loop",
    subtasks: ["schemas", "policies", "planner", "reviewer", "executor"],
    allowedFiles: ["tools/orchestrator", "docs/orchestrator-runbook.md", "package.json"],
    forbiddenFiles: ["app/api/platform/notifications", "/api/jobs/run"],
    successCriteria: ["mock executor loop works", "state machine advances"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  const updated = await runOrchestratorOnce("mock-loop", dependencies);
  assert.equal(updated.iterationNumber, 1);
  assert.equal(updated.plannerDecision?.sliceLevel, "large");
  assert.equal(updated.lastExecutionReport?.summaryOfChanges[0]?.includes("MockExecutor"), true);
  assert.equal(updated.lastReviewVerdict?.verdict, "accept");
  assert.equal(updated.status, "needs_revision");
});
