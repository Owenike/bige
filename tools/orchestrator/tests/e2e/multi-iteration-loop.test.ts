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

const acceptanceValidation = [
  { command: "npm run test:orchestrator:typecheck", status: "passed" as const, output: null },
  { command: "npm run test:orchestrator:lint", status: "passed" as const, output: null },
  { command: "npm run test:orchestrator:unit", status: "passed" as const, output: null },
  { command: "npm run test:orchestrator:integration", status: "passed" as const, output: null },
  { command: "npm run test:orchestrator:schema", status: "passed" as const, output: null },
  { command: "npm run test:orchestrator:policy", status: "passed" as const, output: null },
  { command: "npm run test:orchestrator:mock-loop", status: "passed" as const, output: null },
  { command: "npm run test:orchestrator:state-machine", status: "passed" as const, output: null },
];

function createMockReport(params: {
  iterationNumber: number;
  blockers?: string[];
  changedFiles?: string[];
  shouldCloseSlice?: boolean;
  recommendedNextStep?: string;
}) {
  return {
    iterationNumber: params.iterationNumber,
    changedFiles: params.changedFiles ?? ["tools/orchestrator/src/orchestrator.ts"],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: [`Iteration ${params.iterationNumber} executed.`],
    whyThisWasDone: ["Exercise loop transitions."],
    howBehaviorWasKeptStable: ["Only orchestrator files changed."],
    localValidation: acceptanceValidation,
    ciValidation: null,
    blockers: params.blockers ?? [],
    risks: [],
    recommendedNextStep: params.recommendedNextStep ?? "Continue iterating.",
    shouldCloseSlice: params.shouldCloseSlice ?? false,
    artifacts: [],
  };
}

test("run-loop can revise then accept and complete", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-loop-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  dependencies.executorProviders.mock = new MockExecutor([
    createMockReport({
      iterationNumber: 1,
      blockers: ["Need one more iteration."],
      recommendedNextStep: "Resolve the remaining blocker and retry.",
    }),
    createMockReport({
      iterationNumber: 2,
      shouldCloseSlice: true,
      recommendedNextStep: "Close the slice.",
    }),
  ]);

  const state = createInitialState({
    id: "loop-revise-accept",
    repoPath,
    repoName: "bige",
    userGoal: "Run a multi-iteration loop",
    objective: "Demonstrate revise then accept",
    subtasks: ["planner", "reviewer", "executor", "storage"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["loop completes"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  const updated = await runOrchestratorLoop("loop-revise-accept", dependencies);
  assert.equal(updated.status, "completed");
  assert.equal(updated.iterationNumber, 2);
  assert.equal(updated.iterationHistory.length, 2);
});

test("run-loop stops when reviewer blocks a forbidden-file change", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-loop-blocked-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  dependencies.executorProviders.mock = new MockExecutor([
    createMockReport({
      iterationNumber: 1,
      changedFiles: ["app/api/platform/notifications/overview/route.ts"],
      recommendedNextStep: "Undo the forbidden edit.",
    }),
  ]);

  const state = createInitialState({
    id: "loop-blocked",
    repoPath,
    repoName: "bige",
    userGoal: "Stop on forbidden scope",
    objective: "Demonstrate blocked loop",
    subtasks: ["planner", "reviewer", "executor", "storage"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["blocked loop stops safely"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  const updated = await runOrchestratorLoop("loop-blocked", dependencies);
  assert.equal(updated.status, "stopped");
  assert.equal(updated.stopReason?.includes("forbidden"), true);
});

test("run-loop waits for approval and continues after approval without replanning", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-loop-approval-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });

  const state = createInitialState({
    id: "loop-approval",
    repoPath,
    repoName: "bige",
    userGoal: "Pause and resume on approval",
    objective: "Demonstrate approval mode",
    subtasks: ["planner", "reviewer", "executor", "storage"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["approval loop works"],
    autoMode: false,
    approvalMode: "human_approval",
  });
  await dependencies.storage.saveState(state);

  let updated = await runOrchestratorLoop("loop-approval", dependencies);
  assert.equal(updated.status, "waiting_approval");
  assert.equal(updated.iterationHistory.length, 1);
  const plannedIteration = updated.iterationHistory[0]?.iterationNumber;

  await approvePendingPlan("loop-approval", dependencies);
  dependencies.executorProviders.mock = new MockExecutor([
    createMockReport({
      iterationNumber: 1,
      shouldCloseSlice: true,
      recommendedNextStep: "Close the slice.",
    }),
  ]);

  updated = await runOrchestratorLoop("loop-approval", dependencies);
  assert.equal(updated.status, "completed");
  assert.equal(updated.iterationHistory.length, 1);
  assert.equal(updated.iterationHistory[0]?.iterationNumber, plannedIteration);
});
