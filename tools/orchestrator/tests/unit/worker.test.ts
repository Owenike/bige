import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { MockExecutor } from "../../src/executor-adapters";
import { enqueueStateRun, listQueueRuns } from "../../src/queue";
import { runQueueWorker, runQueueWorkerOnce } from "../../src/worker";

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

function createMockReport(iterationNumber: number, shouldCloseSlice = true) {
  return {
    iterationNumber,
    changedFiles: ["tools/orchestrator/src/orchestrator.ts"],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: [`Iteration ${iterationNumber} executed.`],
    whyThisWasDone: ["Exercise worker transitions."],
    howBehaviorWasKeptStable: ["Only orchestrator files changed."],
    localValidation: acceptanceValidation,
    ciValidation: null,
    blockers: [],
    risks: [],
    recommendedNextStep: "Close the slice.",
    shouldCloseSlice,
    artifacts: [],
  };
}

test("worker once processes a queued run to completion", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-worker-once-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  dependencies.executorProviders.mock = new MockExecutor([createMockReport(1)]);

  const state = createInitialState({
    id: "worker-once",
    repoPath,
    repoName: "bige",
    userGoal: "Process one queued run",
    objective: "Worker one-shot",
    subtasks: ["queue", "worker", "one-shot", "tests"],
    successCriteria: ["worker completes one run"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({ backend: dependencies.backend, state });

  const result = await runQueueWorkerOnce({
    workerId: "worker-once",
    dependencies,
  });
  const updated = await dependencies.storage.loadState("worker-once");
  assert.equal(result.status, "completed");
  assert.equal(updated?.status, "completed");
  assert.equal(updated?.queueStatus, "completed");
});

test("worker respects approval mode and pauses the queue item", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-worker-approval-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });

  const state = createInitialState({
    id: "worker-approval",
    repoPath,
    repoName: "bige",
    userGoal: "Pause for approval",
    objective: "Worker approval handling",
    subtasks: ["queue", "worker", "approval", "tests"],
    successCriteria: ["worker pauses for approval"],
    autoMode: false,
    approvalMode: "human_approval",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({ backend: dependencies.backend, state });

  const result = await runQueueWorkerOnce({
    workerId: "worker-approval",
    dependencies,
  });
  const updated = await dependencies.storage.loadState("worker-approval");
  assert.equal(result.status, "paused");
  assert.equal(updated?.status, "waiting_approval");
  assert.equal(updated?.queueStatus, "paused");
});

test("continuous worker can process more than one queued run", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-worker-loop-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  dependencies.executorProviders.mock = new MockExecutor([createMockReport(1), createMockReport(1)]);

  for (const id of ["worker-loop-a", "worker-loop-b"]) {
    const state = createInitialState({
      id,
      repoPath,
      repoName: "bige",
      userGoal: `Process ${id}`,
      objective: "Worker continuous polling",
      subtasks: ["queue", "worker", "loop", "tests"],
      successCriteria: ["worker drains the queue"],
      autoMode: true,
      approvalMode: "auto",
    });
    await dependencies.storage.saveState(state);
    await enqueueStateRun({ backend: dependencies.backend, state });
  }

  const summary = await runQueueWorker({
    workerId: "worker-loop",
    dependencies,
    continuous: true,
    pollIntervalMs: 10,
    maxPolls: 3,
  });
  const queue = await listQueueRuns(dependencies.backend);
  assert.equal(summary.processed >= 2, true);
  assert.equal(queue.every((item) => item.status === "completed"), true);
});
