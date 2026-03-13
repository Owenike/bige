import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { MockExecutor } from "../../src/executor-adapters";
import { enqueueStateRun } from "../../src/queue";
import { getWorkerStatus, runQueueWorker } from "../../src/worker";

function createMockReport(iterationNumber: number, shouldCloseSlice = true) {
  return {
    iterationNumber,
    changedFiles: [],
    checkedButUnmodifiedFiles: ["tools/orchestrator"],
    summaryOfChanges: ["Daemon cycle completed."],
    whyThisWasDone: ["Exercise daemon supervision path."],
    howBehaviorWasKeptStable: ["Only orchestrator logic was touched."],
    localValidation: [],
    ciValidation: null,
    blockers: [],
    risks: [],
    recommendedNextStep: "Stop the loop.",
    shouldCloseSlice,
    artifacts: [],
  };
}

test("daemon-style worker reports backend, supervision status, and drains the queue", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-daemon-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  dependencies.executorProviders.mock = new MockExecutor([createMockReport(1)]);

  const state = createInitialState({
    id: "daemon-state",
    repoPath,
    repoName: "bige",
    userGoal: "Run daemon style worker",
    objective: "Worker daemon status",
    subtasks: ["worker", "daemon", "tests"],
    successCriteria: ["daemon reports healthy supervision"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({ backend: dependencies.backend, state });

  const summary = await runQueueWorker({
    workerId: "daemon-worker",
    dependencies,
    continuous: true,
    daemon: true,
    pollIntervalMs: 10,
    maxPolls: 2,
    maxIdleCycles: 1,
  });

  const worker = await getWorkerStatus(dependencies, "daemon-worker");
  assert.equal(summary.processed >= 1, true);
  assert.equal(summary.backendType, "file");
  assert.equal(summary.supervisionStatus, "stopped");
  assert.equal((worker as { workerId: string }).workerId, "daemon-worker");
});
