import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { acquireNextQueueRun, enqueueStateRun, listQueueRuns } from "../../src/queue";

test("queue can enqueue, dedupe the same state, and dequeue by priority", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-queue-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
  });

  const low = createInitialState({
    id: "queue-low",
    repoPath,
    repoName: "bige",
    userGoal: "Queue low priority",
    objective: "Queue ordering",
    subtasks: ["queue", "ordering", "worker", "tests"],
    successCriteria: ["higher priority dequeues first"],
  });
  const high = createInitialState({
    id: "queue-high",
    repoPath,
    repoName: "bige",
    userGoal: "Queue high priority",
    objective: "Queue ordering",
    subtasks: ["queue", "ordering", "worker", "tests"],
    successCriteria: ["higher priority dequeues first"],
  });
  await dependencies.storage.saveState(low);
  await dependencies.storage.saveState(high);

  const first = await enqueueStateRun({
    storage: dependencies.storage,
    state: low,
    priority: 1,
  });
  const duplicate = await enqueueStateRun({
    storage: dependencies.storage,
    state: low,
    priority: 5,
  });
  await enqueueStateRun({
    storage: dependencies.storage,
    state: high,
    priority: 10,
  });

  assert.equal(duplicate.deduped, true);
  assert.equal(first.item.id, duplicate.item.id);

  const queue = await listQueueRuns(dependencies.storage);
  assert.equal(queue.length, 2);

  const claimed = await acquireNextQueueRun({
    storage: dependencies.storage,
    workerId: "worker-queue",
  });
  assert.equal(claimed?.stateId, "queue-high");
  const updatedQueue = await listQueueRuns(dependencies.storage);
  assert.equal(updatedQueue.find((item) => item.stateId === "queue-low")?.status, "queued");
});
