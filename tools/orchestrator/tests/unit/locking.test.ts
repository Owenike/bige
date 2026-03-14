import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { acquireNextQueueRun, enqueueStateRun } from "../../src/queue";

test("locking prevents a second worker from taking a conflicting run until the lease expires", async () => {
  const scheduledAt = "2026-03-13T23:59:00.000Z";
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-locking-"));
  const repoPath = process.cwd();
  const workspaceRoot = path.join(repoPath, ".tmp", "orchestrator-workspaces");
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    workspaceRoot,
  });

  const firstState = createInitialState({
    id: "lock-first",
    repoPath,
    repoName: "bige",
    userGoal: "Lock first task",
    objective: "Lease locking",
    subtasks: ["queue", "lease", "locking", "tests"],
    successCriteria: ["second worker waits"],
    workspaceRoot,
  });
  const secondState = createInitialState({
    id: "lock-second",
    repoPath,
    repoName: "bige",
    userGoal: "Lock second task",
    objective: "Lease locking",
    subtasks: ["queue", "lease", "locking", "tests"],
    successCriteria: ["second worker waits"],
    workspaceRoot,
  });
  await dependencies.storage.saveState(firstState);
  await dependencies.storage.saveState(secondState);
  await enqueueStateRun({ backend: dependencies.backend, state: firstState, priority: 5, scheduledAt });
  await enqueueStateRun({ backend: dependencies.backend, state: secondState, priority: 4, scheduledAt });

  const claimed = await acquireNextQueueRun({
    backend: dependencies.backend,
    workerId: "worker-a",
    now: new Date("2026-03-14T00:00:00.000Z"),
    leaseMs: 60_000,
  });
  assert.equal(claimed?.stateId, "lock-first");

  const blocked = await acquireNextQueueRun({
    backend: dependencies.backend,
    workerId: "worker-b",
    now: new Date("2026-03-14T00:00:10.000Z"),
    leaseMs: 60_000,
  });
  assert.equal(blocked, null);

  const afterExpiry = await acquireNextQueueRun({
    backend: dependencies.backend,
    workerId: "worker-b",
    now: new Date("2026-03-14T00:01:10.000Z"),
    leaseMs: 60_000,
  });
  assert.equal(afterExpiry?.stateId, "lock-second");
});
