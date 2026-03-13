import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  approvePendingPlan,
  createDefaultDependencies,
  createInitialState,
  runOrchestratorLoop,
} from "../../src/orchestrator";
import { MockExecutor } from "../../src/executor-adapters";

function createMockReport(iterationNumber: number, shouldCloseSlice: boolean) {
  return {
    iterationNumber,
    changedFiles: ["tools/orchestrator/src/cli.ts"],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: ["Stored iteration report."],
    whyThisWasDone: ["Exercise persistence and resume."],
    howBehaviorWasKeptStable: ["Only orchestrator files changed."],
    localValidation: [
      { command: "npm run test:orchestrator:typecheck", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:lint", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:unit", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:integration", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:schema", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:policy", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:mock-loop", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:state-machine", status: "passed" as const, output: null },
    ],
    ciValidation: null,
    blockers: [],
    risks: [],
    recommendedNextStep: shouldCloseSlice ? "Close the slice." : "Revise and continue.",
    shouldCloseSlice,
    artifacts: [],
  };
}

test("approval resume does not duplicate a planned iteration and persists iteration history", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-storage-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "storage-resume",
    repoPath,
    repoName: "bige",
    userGoal: "Resume planned iteration safely",
    objective: "Persist decisions and reports",
    subtasks: ["planner", "reviewer", "storage", "loop"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["resume does not duplicate execution"],
    autoMode: false,
    approvalMode: "human_approval",
  });
  await dependencies.storage.saveState(state);

  let updated = await runOrchestratorLoop("storage-resume", dependencies);
  assert.equal(updated.status, "waiting_approval");
  assert.equal(updated.pendingHumanApproval, true);
  assert.equal(updated.iterationHistory.length, 1);
  assert.equal(updated.iterationHistory[0]?.executionReport, null);

  await approvePendingPlan("storage-resume", dependencies);
  dependencies.executor = new MockExecutor([createMockReport(1, true)]);

  updated = await runOrchestratorLoop("storage-resume", dependencies);
  assert.equal(updated.status, "completed");
  assert.equal(updated.iterationNumber, 1);
  assert.equal(updated.iterationHistory.length, 1);
  assert.equal(updated.iterationHistory[0]?.executionReport?.iterationNumber, 1);
  assert.equal(updated.iterationHistory[0]?.plannerDecision?.objective, "Persist decisions and reports");
});
