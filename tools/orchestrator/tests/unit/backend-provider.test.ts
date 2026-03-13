import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { acquireNextQueueRun, enqueueStateRun, listQueueRuns } from "../../src/queue";

test("file backend remains usable for queue persistence", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-backend-file-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    backendType: "file",
  });

  const state = createInitialState({
    id: "backend-file",
    repoPath,
    repoName: "bige",
    userGoal: "Keep file backend working",
    objective: "Queue backend file compatibility",
    subtasks: ["backend", "queue", "tests"],
    successCriteria: ["file backend still persists queue items"],
    backendType: "file",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({
    backend: dependencies.backend,
    state,
    priority: 3,
  });

  const queue = await listQueueRuns(dependencies.backend);
  const inspection = await dependencies.backend.inspect();
  assert.equal(queue.length, 1);
  assert.equal(inspection.backendType, "file");
  assert.equal(inspection.queueDepth, 1);
});

test("sqlite backend persists queue and worker state", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-backend-sqlite-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    backendType: "sqlite",
  });

  const state = createInitialState({
    id: "backend-sqlite",
    repoPath,
    repoName: "bige",
    userGoal: "Use sqlite backend",
    objective: "Queue backend sqlite compatibility",
    subtasks: ["backend", "sqlite", "tests"],
    successCriteria: ["sqlite backend persists queue items"],
    backendType: "sqlite",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({
    backend: dependencies.backend,
    state,
    priority: 9,
  });
  const claimed = await acquireNextQueueRun({
    backend: dependencies.backend,
    workerId: "sqlite-worker",
  });
  assert.equal(claimed?.status, "running");

  const inspection = await dependencies.backend.inspect();
  const workers = await dependencies.backend.loadWorkers();
  assert.equal(inspection.backendType, "sqlite");
  assert.equal(inspection.runningCount, 1);
  assert.equal(Array.isArray(workers.workers), true);
});
