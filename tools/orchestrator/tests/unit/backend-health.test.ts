import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { acquireNextQueueRun, enqueueStateRun, listQueueRuns } from "../../src/queue";
import { inspectBackendHealth, repairBackendHealth } from "../../src/health";

test("backend health reports stale leases, orphan runs, and pending approval", async () => {
  const scheduledAt = "2026-03-13T23:59:00.000Z";
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-health-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot: root,
    backendRoot: path.join(root, "backend"),
    backendType: "sqlite",
  });
  const staleState = createInitialState({
    id: "backend-health-stale",
    repoPath,
    repoName: "bige",
    userGoal: "Inspect backend health",
    objective: "Detect stale and pending backend issues",
    subtasks: ["health", "stale", "approval"],
    successCriteria: ["health summary is readable"],
    backendType: "sqlite",
  });
  const approvalState = createInitialState({
    id: "backend-health-approval",
    repoPath,
    repoName: "bige",
    userGoal: "Inspect backend health",
    objective: "Track pending approval state",
    subtasks: ["health", "approval"],
    successCriteria: ["approval shows in health summary"],
    backendType: "sqlite",
    approvalMode: "human_approval",
  });
  await dependencies.storage.saveState(staleState);
  await dependencies.storage.saveState({
    ...approvalState,
    pendingHumanApproval: true,
    status: "waiting_approval",
  });
  await enqueueStateRun({ backend: dependencies.backend, state: staleState, priority: 4, scheduledAt });
  const claimed = await acquireNextQueueRun({
    backend: dependencies.backend,
    workerId: "health-worker",
    leaseMs: 1,
    now: new Date("2026-03-14T00:00:00.000Z"),
  });
  await dependencies.backend.mutateQueue((queue) => {
    const orphan = {
      ...queue.items[0],
      id: "orphan-run",
      stateId: "missing-state",
      taskId: "missing-state",
      status: "queued" as const,
      workerId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    };
    return {
      queue: {
        ...queue,
        items: [...queue.items, orphan],
        updatedAt: new Date("2026-03-14T00:00:00.000Z").toISOString(),
      },
      result: null,
    };
  });

  assert.ok(claimed);
  const health = await inspectBackendHealth({
    dependencies,
    now: new Date("2026-03-14T00:10:00.000Z"),
  });

  assert.equal(health.status, "degraded");
  assert.equal(health.staleLeaseCount, 1);
  assert.equal(health.orphanRunCount, 1);
  assert.equal(health.pendingApprovalCount, 1);
});

test("backend repair safely requeues stale runs and blocks orphan queue items", async () => {
  const scheduledAt = "2026-03-13T23:59:00.000Z";
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-repair-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot: root,
    backendRoot: path.join(root, "backend"),
    backendType: "sqlite",
  });
  const state = createInitialState({
    id: "backend-repair-state",
    repoPath,
    repoName: "bige",
    userGoal: "Repair backend anomalies",
    objective: "Normalize stale and orphan queue items",
    subtasks: ["repair", "stale", "orphan"],
    successCriteria: ["repair acts safely"],
    backendType: "sqlite",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({ backend: dependencies.backend, state, priority: 1, scheduledAt });
  await acquireNextQueueRun({
    backend: dependencies.backend,
    workerId: "repair-worker",
    leaseMs: 1,
    now: new Date("2026-03-14T00:00:00.000Z"),
  });
  await dependencies.backend.mutateQueue((queue) => {
    const orphan = {
      ...queue.items[0],
      id: "repair-orphan-run",
      stateId: "missing-state",
      taskId: "missing-state",
      status: "queued" as const,
      workerId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    };
    return {
      queue: {
        ...queue,
        items: [...queue.items, orphan],
        updatedAt: new Date("2026-03-14T00:00:00.000Z").toISOString(),
      },
      result: null,
    };
  });

  const result = await repairBackendHealth({
    dependencies,
    now: new Date("2026-03-14T00:10:00.000Z"),
  });
  const queue = await listQueueRuns(dependencies.backend);

  assert.equal(result.status, "repaired");
  assert.equal(result.staleRequeuedCount, 1);
  assert.equal(result.orphanBlockedCount, 1);
  assert.equal(queue.find((item) => item.id === "repair-orphan-run")?.status, "blocked");
});
