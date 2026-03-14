import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { acquireNextQueueRun, enqueueStateRun } from "../../src/queue";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { exportBackendSnapshot, importBackendSnapshot } from "../../src/transfer";
import { MemorySupabaseDocumentStore } from "./supabase.fixture";

test("backend transfer exports file state and imports into sqlite with live leases normalized", async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-transfer-src-"));
  const targetRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-transfer-target-"));
  const repoPath = process.cwd();
  const source = createDefaultDependencies({
    repoPath,
    storageRoot: sourceRoot,
    backendRoot: path.join(sourceRoot, "backend"),
    backendType: "file",
  });
  const target = createDefaultDependencies({
    repoPath,
    storageRoot: targetRoot,
    backendRoot: path.join(targetRoot, "backend"),
    backendType: "sqlite",
  });
  const state = createInitialState({
    id: "transfer-file-to-sqlite",
    repoPath,
    repoName: "bige",
    userGoal: "Move backend state",
    objective: "Transfer orchestrator snapshot between backends",
    subtasks: ["transfer", "file", "sqlite"],
    successCriteria: ["snapshot imports cleanly"],
    backendType: "file",
  });
  await source.storage.saveState(state);
  await enqueueStateRun({ backend: source.backend, state, priority: 5 });
  const claimed = await acquireNextQueueRun({
    backend: source.backend,
    workerId: "source-worker",
    leaseMs: 60_000,
  });
  assert.ok(claimed);

  const exported = await exportBackendSnapshot({
    dependencies: source,
    outputRoot: path.join(sourceRoot, "exports"),
  });
  const imported = await importBackendSnapshot({
    dependencies: target,
    snapshotPath: exported.snapshotPath!,
    targetBackendType: "sqlite",
  });
  const importedState = await target.storage.loadState(state.id);
  const importedQueue = await target.backend.loadQueue();
  const importedWorkers = await target.backend.loadWorkers();

  assert.equal(imported.status, "completed");
  assert.equal(importedState?.backendType, "sqlite");
  assert.equal(importedQueue.items[0]?.status, "queued");
  assert.equal(importedQueue.items[0]?.leaseOwner, null);
  assert.equal(importedWorkers.workers.length, 0);
});

test("backend transfer can import into supabase-backed state without moving live locks", async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-transfer-src-"));
  const repoPath = process.cwd();
  const source = createDefaultDependencies({
    repoPath,
    storageRoot: sourceRoot,
    backendRoot: path.join(sourceRoot, "backend"),
    backendType: "file",
  });
  const target = createDefaultDependencies({
    repoPath,
    storageRoot: path.join(sourceRoot, "supabase-storage"),
    backendType: "supabase",
    supabaseStore: new MemorySupabaseDocumentStore(),
  });
  const state = createInitialState({
    id: "transfer-file-to-supabase",
    repoPath,
    repoName: "bige",
    userGoal: "Move backend state",
    objective: "Import snapshot into supabase backend",
    subtasks: ["transfer", "file", "supabase"],
    successCriteria: ["supabase receives normalized snapshot"],
    backendType: "file",
  });
  await source.storage.saveState(state);
  await enqueueStateRun({ backend: source.backend, state, priority: 1 });

  const exported = await exportBackendSnapshot({
    dependencies: source,
    outputRoot: path.join(sourceRoot, "exports"),
  });
  const imported = await importBackendSnapshot({
    dependencies: target,
    snapshotPath: exported.snapshotPath!,
    targetBackendType: "supabase",
  });
  const importedState = await target.storage.loadState(state.id);

  assert.equal(imported.status, "completed");
  assert.equal(importedState?.backendType, "supabase");
  assert.match(imported.notes.join(" "), /Live leases were not migrated directly/);
});
