import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseBackendProvider } from "../../src/backend";
import { acquireNextQueueRun, enqueueStateRun } from "../../src/queue";
import { createInitialState } from "../../src/orchestrator";
import { MemorySupabaseDocumentStore } from "./supabase.fixture";

test("remote supabase backend prevents two workers from claiming the same run", async () => {
  const store = new MemorySupabaseDocumentStore();
  const backend = new SupabaseBackendProvider({ store, conflictRetries: 8 });
  const state = createInitialState({
    id: "multi-worker-remote",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Coordinate remote workers",
    objective: "Prevent double-claim on a shared queue",
    subtasks: ["supabase", "queue", "multi-worker"],
    successCriteria: ["only one worker claims the run"],
    backendType: "supabase",
  });

  await enqueueStateRun({ backend, state, priority: 9 });
  const [first, second] = await Promise.all([
    acquireNextQueueRun({ backend, workerId: "worker-a", leaseMs: 60_000 }),
    acquireNextQueueRun({ backend, workerId: "worker-b", leaseMs: 60_000 }),
  ]);
  const claimedRuns = [first, second].filter(Boolean);

  assert.equal(claimedRuns.length, 1);
  assert.equal(claimedRuns[0]?.status, "running");
});
