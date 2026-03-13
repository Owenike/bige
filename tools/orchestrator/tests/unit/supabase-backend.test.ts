import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseBackendProvider } from "../../src/backend";
import { acquireNextQueueRun, enqueueStateRun, listQueueRuns, renewQueueRunLease } from "../../src/queue";
import { createInitialState } from "../../src/orchestrator";
import { SupabaseStorage } from "../../src/storage";
import { MemorySupabaseDocumentStore } from "./supabase.fixture";

test("supabase backend persists queue, workers, and lease renewal", async () => {
  const store = new MemorySupabaseDocumentStore();
  const backend = new SupabaseBackendProvider({ store });
  const storage = new SupabaseStorage(store);
  const state = createInitialState({
    id: "supabase-backend",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Use remote queue backend",
    objective: "Persist orchestrator queue remotely",
    subtasks: ["supabase", "queue", "lease", "tests"],
    successCriteria: ["supabase backend supports queue and leases"],
    backendType: "supabase",
  });

  await storage.saveState(state);
  const reloaded = await storage.loadState(state.id);

  await enqueueStateRun({
    backend,
    state,
    priority: 4,
  });
  const claimed = await acquireNextQueueRun({
    backend,
    workerId: "remote-worker-a",
    leaseMs: 60_000,
  });
  const renewed = await renewQueueRunLease({
    backend,
    runId: claimed!.id,
    workerId: "remote-worker-a",
    leaseMs: 90_000,
  });
  const inspection = await backend.inspect();

  assert.equal((await listQueueRuns(backend)).length, 1);
  assert.equal(reloaded?.id, state.id);
  assert.equal(claimed?.status, "running");
  assert.equal(renewed?.leaseOwner, "remote-worker-a");
  assert.equal(inspection.backendType, "supabase");
  assert.equal(inspection.runningCount, 1);
});
