import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { orchestratorStateSchema } from "../../src/schemas";
import { acquireNextQueueRun, enqueueStateRun, listQueueRuns } from "../../src/queue";
import { recoverStaleQueueRuns } from "../../src/recovery";

test("recovery requeues a stale running run when it is safe to take over", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-recovery-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
  });

  const state = createInitialState({
    id: "recovery-requeue",
    repoPath,
    repoName: "bige",
    userGoal: "Recover stale run",
    objective: "Stale run recovery",
    subtasks: ["queue", "worker", "recovery", "tests"],
    successCriteria: ["stale run requeues"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({ storage: dependencies.storage, state });
  await acquireNextQueueRun({
    storage: dependencies.storage,
    workerId: "worker-a",
    now: new Date("2026-03-14T00:00:00.000Z"),
    leaseMs: 60_000,
  });

  const decisions = await recoverStaleQueueRuns({
    dependencies,
    now: new Date("2026-03-14T00:02:00.000Z"),
  });
  const queue = await listQueueRuns(dependencies.storage);
  assert.equal(decisions[0]?.decision.action, "requeued");
  assert.equal(queue[0]?.status, "queued");
});

test("recovery keeps approval-pending work paused instead of taking it over", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-recovery-approval-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
  });

  const state = orchestratorStateSchema.parse({
    ...createInitialState({
      id: "recovery-paused",
      repoPath,
      repoName: "bige",
      userGoal: "Protect approval pending state",
      objective: "Stale approval recovery",
      subtasks: ["queue", "worker", "recovery", "tests"],
      successCriteria: ["approval state is not stolen"],
      autoMode: false,
      approvalMode: "human_approval",
    }),
    status: "waiting_approval",
    pendingHumanApproval: true,
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({ storage: dependencies.storage, state });
  await acquireNextQueueRun({
    storage: dependencies.storage,
    workerId: "worker-a",
    now: new Date("2026-03-14T00:00:00.000Z"),
    leaseMs: 60_000,
  });

  const decisions = await recoverStaleQueueRuns({
    dependencies,
    now: new Date("2026-03-14T00:02:00.000Z"),
  });
  const queue = await listQueueRuns(dependencies.storage);
  const updated = await dependencies.storage.loadState("recovery-paused");
  assert.equal(decisions[0]?.decision.action, "paused");
  assert.equal(queue[0]?.status, "paused");
  assert.equal(updated?.lastRecoveryDecision?.action, "paused");
});
