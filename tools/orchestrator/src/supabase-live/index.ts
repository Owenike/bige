import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SupabaseBackendProvider } from "../backend";
import { createInitialState } from "../orchestrator";
import { acquireNextQueueRun, enqueueStateRun, renewQueueRunLease, updateQueueRunStatus } from "../queue";
import { backendLiveSmokeResultSchema, type BackendLiveSmokeResult } from "../schemas";
import { SupabaseStorage } from "../storage";
import { createScopedRemoteDocumentStore, createSupabaseDocumentStoreFromEnv, type RemoteDocumentStore } from "../supabase";

export async function runSupabaseBackendLiveSmoke(params: {
  repoPath: string;
  outputRoot?: string;
  enabled?: boolean;
  store?: RemoteDocumentStore | null;
  now?: Date;
}): Promise<BackendLiveSmokeResult> {
  const now = params.now ?? new Date();
  if (params.enabled === false) {
    return backendLiveSmokeResultSchema.parse({
      backendType: "supabase",
      status: "skipped",
      summary: "Supabase live backend smoke was disabled.",
      reason: "The operator disabled the Supabase live smoke path.",
      reportPath: null,
      evidencePath: null,
      ranAt: now.toISOString(),
    });
  }

  const store = params.store ?? createSupabaseDocumentStoreFromEnv();
  if (!store) {
    return backendLiveSmokeResultSchema.parse({
      backendType: "supabase",
      status: "skipped",
      summary: "Supabase live backend smoke skipped because required env is missing.",
      reason:
        "Provide ORCHESTRATOR_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY.",
      reportPath: null,
      evidencePath: null,
      ranAt: now.toISOString(),
    });
  }

  const status = await store.status();
  if (status.status !== "ready") {
    const liveStatus = status.status === "manual_required" ? "manual_required" : "blocked";
    return backendLiveSmokeResultSchema.parse({
      backendType: "supabase",
      status: liveStatus,
      summary: status.summary,
      reason: status.details.join(" | ") || status.summary,
      reportPath: status.migrationPath,
      evidencePath: null,
      ranAt: now.toISOString(),
    });
  }

  const scopePrefix = `live-smoke:${now.getTime()}:`;
  const scopedStore = createScopedRemoteDocumentStore(store, scopePrefix);
  const backend = new SupabaseBackendProvider({ store: scopedStore });
  const storage = new SupabaseStorage(scopedStore);
  const outputRoot = params.outputRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-supabase-live");
  await mkdir(outputRoot, { recursive: true });

  const state = createInitialState({
    id: `supabase-live-${now.getTime()}`,
    repoPath: params.repoPath,
    repoName: path.basename(params.repoPath),
    userGoal: "Smoke test the Supabase backend",
    objective: "Verify remote queue, lease, and heartbeat semantics",
    subtasks: ["supabase", "queue", "lease", "heartbeat", "smoke"],
    successCriteria: ["supabase backend can persist queue and remote coordination state"],
    backendType: "supabase",
  });

  await storage.saveState(state);
  await enqueueStateRun({
    backend,
    state,
    priority: 1,
    scheduledAt: new Date(now.getTime() - 1_000).toISOString(),
    requestedBy: "supabase-live-smoke",
  });
  const claimed = await acquireNextQueueRun({
    backend,
    workerId: "supabase-live-worker",
    leaseMs: 60_000,
    now,
  });
  if (!claimed) {
    throw new Error("Supabase live smoke could not claim the queued run.");
  }
  await renewQueueRunLease({
    backend,
    runId: claimed.id,
    workerId: "supabase-live-worker",
    leaseMs: 90_000,
    now: new Date(now.getTime() + 1_000),
  });
  await updateQueueRunStatus({
    backend,
    runId: claimed.id,
    status: "completed",
    workerId: "supabase-live-worker",
    reason: "Supabase live backend smoke completed.",
    now: new Date(now.getTime() + 2_000),
  });

  const inspection = await backend.inspect(new Date(now.getTime() + 2_000));
  const evidencePath = path.join(outputRoot, `supabase-live-${now.getTime()}.json`);
  const evidence = {
    status: "passed",
    backendType: "supabase",
    scopePrefix,
    inspection,
    queueDepth: inspection.queueDepth,
    workerCount: inspection.workerCount,
    ranAt: new Date(now.getTime() + 2_000).toISOString(),
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  const reportPath = path.join(outputRoot, `supabase-live-${now.getTime()}-summary.json`);
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        summary: "Supabase live backend smoke passed.",
        inspection,
        stateId: state.id,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const scopedRecords = await scopedStore.list();
  await Promise.all(scopedRecords.map((record) => scopedStore.remove(record.key)));

  return backendLiveSmokeResultSchema.parse({
    backendType: "supabase",
    status: "passed",
    summary: "Supabase live backend smoke passed.",
    reason: "Remote queue, lease, heartbeat, and completion flow succeeded.",
    reportPath,
    evidencePath,
    ranAt: new Date(now.getTime() + 2_000).toISOString(),
  });
}
