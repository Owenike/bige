import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseBackendProvider } from "../../src/backend";
import { acquireNextQueueRun, enqueueStateRun, forceRequeueExpiredRun } from "../../src/queue";
import { createInitialState } from "../../src/orchestrator";
import { MemorySupabaseDocumentStore } from "./supabase.fixture";

test("remote backend prevents a second worker from claiming the same run", async () => {
  const backend = new SupabaseBackendProvider({
    store: new MemorySupabaseDocumentStore(),
  });
  const state = createInitialState({
    id: "remote-locking",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Protect remote run ownership",
    objective: "Do not double-claim queue runs",
    subtasks: ["supabase", "locking", "workers", "tests"],
    successCriteria: ["second worker cannot claim the same run"],
    backendType: "supabase",
  });

  await enqueueStateRun({ backend, state });
  const first = await acquireNextQueueRun({
    backend,
    workerId: "worker-a",
    leaseMs: 60_000,
    now: new Date("2026-03-14T00:00:00.000Z"),
  });
  const second = await acquireNextQueueRun({
    backend,
    workerId: "worker-b",
    leaseMs: 60_000,
    now: new Date("2026-03-14T00:00:10.000Z"),
  });

  assert.equal(first?.workerId, "worker-a");
  assert.equal(second, null);
});

test("remote backend allows stale lease takeover after expiry", async () => {
  const backend = new SupabaseBackendProvider({
    store: new MemorySupabaseDocumentStore(),
  });
  const state = createInitialState({
    id: "remote-stale-takeover",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Recover stale remote lease",
    objective: "Allow recovery after expiry",
    subtasks: ["supabase", "recovery", "lease", "tests"],
    successCriteria: ["stale run can be requeued and reclaimed"],
    backendType: "supabase",
  });

  await enqueueStateRun({ backend, state });
  const claimed = await acquireNextQueueRun({
    backend,
    workerId: "worker-a",
    leaseMs: 1_000,
    now: new Date("2026-03-14T00:00:00.000Z"),
  });
  await forceRequeueExpiredRun({
    backend,
    runId: claimed!.id,
    now: new Date("2026-03-14T00:00:05.000Z"),
  });
  const takeover = await acquireNextQueueRun({
    backend,
    workerId: "worker-b",
    leaseMs: 60_000,
    now: new Date("2026-03-14T00:00:06.000Z"),
  });

  assert.equal(takeover?.workerId, "worker-b");
});
