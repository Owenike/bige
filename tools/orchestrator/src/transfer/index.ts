import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { OrchestratorDependencies } from "../orchestrator";
import {
  backendTransferSummarySchema,
  orchestratorStateSchema,
  queueRunCollectionSchema,
  queueWorkerCollectionSchema,
  type BackendTransferSummary,
  type BackendType,
  type OrchestratorState,
  type QueueRunCollection,
  type QueueWorkerCollection,
} from "../schemas";

const backendSnapshotSchema = z.object({
  sourceBackend: z.enum(["file", "sqlite", "supabase"]),
  exportedAt: z.string(),
  stateIds: z.array(z.string()).default([]),
  states: z.array(orchestratorStateSchema).default([]),
  queue: queueRunCollectionSchema,
  workers: queueWorkerCollectionSchema,
  diagnosticsSummary: z.array(z.string()).default([]),
});

type BackendSnapshot = z.infer<typeof backendSnapshotSchema>;

function normalizeImportedState(state: OrchestratorState, targetBackend: BackendType): OrchestratorState {
  const nonTerminalQueueStatus =
    state.queueStatus === "running" || state.queueStatus === "paused" ? "queued" : state.queueStatus;
  return orchestratorStateSchema.parse({
    ...state,
    backendType: targetBackend,
    queueStatus: nonTerminalQueueStatus === "cancelled" ? "cancelled" : nonTerminalQueueStatus,
    workerStatus: "idle",
    cancellationStatus: state.cancellationStatus === "cancelled" ? "cancelled" : "none",
    pauseStatus: "none",
    workerId: null,
    leaseOwner: null,
    lastHeartbeatAt: null,
    lastLeaseRenewalAt: null,
    daemonHeartbeatAt: null,
    supervisionStatus: "inactive",
    updatedAt: new Date().toISOString(),
  });
}

function normalizeImportedQueue(queue: QueueRunCollection, now: Date) {
  return queueRunCollectionSchema.parse({
    ...queue,
    updatedAt: now.toISOString(),
    items: queue.items.map((item) => ({
      ...item,
      status: item.status === "running" ? "queued" : item.status,
      workerId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastLeaseRenewalAt: null,
      cancellationStatus: item.cancellationStatus === "cancelled" ? "cancelled" : "none",
      pauseStatus: "none",
      reason: item.status === "running" ? "Run was re-queued during backend transfer." : item.reason,
      recoveryDecision: null,
    })),
  });
}

function normalizeImportedWorkers(now: Date) {
  return queueWorkerCollectionSchema.parse({
    updatedAt: now.toISOString(),
    workers: [],
  });
}

export async function exportBackendSnapshot(params: {
  dependencies: OrchestratorDependencies;
  outputRoot?: string;
  now?: Date;
}): Promise<BackendTransferSummary> {
  const now = params.now ?? new Date();
  const stateIds = await params.dependencies.storage.listStateIds();
  const states = await Promise.all(stateIds.map((stateId) => params.dependencies.storage.loadState(stateId)));
  const snapshot: BackendSnapshot = backendSnapshotSchema.parse({
    sourceBackend: params.dependencies.backend.backendType,
    exportedAt: now.toISOString(),
    stateIds,
    states: states.filter(Boolean),
    queue: await params.dependencies.backend.loadQueue(),
    workers: await params.dependencies.backend.loadWorkers(),
    diagnosticsSummary: [
      `backend=${params.dependencies.backend.backendType}`,
      `stateCount=${stateIds.length}`,
    ],
  });

  const outputRoot = params.outputRoot ?? path.join(process.cwd(), ".tmp", "orchestrator-backend-transfer");
  await mkdir(outputRoot, { recursive: true });
  const snapshotPath = path.join(outputRoot, `backend-export-${params.dependencies.backend.backendType}-${now.getTime()}.json`);
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  return backendTransferSummarySchema.parse({
    status: "exported",
    sourceBackend: params.dependencies.backend.backendType,
    targetBackend: params.dependencies.backend.backendType,
    exportedStateCount: snapshot.states.length,
    importedStateCount: 0,
    queueItemCount: snapshot.queue.items.length,
    workerCount: snapshot.workers.workers.length,
    skippedItems: [],
    conflicts: [],
    notes: ["Live leases are exported for review only and will be cleared on import."],
    snapshotPath,
    createdAt: now.toISOString(),
  });
}

export async function importBackendSnapshot(params: {
  dependencies: OrchestratorDependencies;
  snapshotPath: string;
  targetBackendType: BackendType;
  now?: Date;
}): Promise<BackendTransferSummary> {
  const now = params.now ?? new Date();
  const raw = JSON.parse(await readFile(params.snapshotPath, "utf8"));
  const snapshot = backendSnapshotSchema.parse(raw);

  const importedStates: OrchestratorState[] = [];
  for (const state of snapshot.states) {
    const normalized = normalizeImportedState(state, params.targetBackendType);
    await params.dependencies.storage.saveState(normalized);
    importedStates.push(normalized);
  }

  await params.dependencies.backend.saveQueue(normalizeImportedQueue(snapshot.queue, now));
  await params.dependencies.backend.saveWorkers(normalizeImportedWorkers(now));

  return backendTransferSummarySchema.parse({
    status: "completed",
    sourceBackend: snapshot.sourceBackend,
    targetBackend: params.targetBackendType,
    exportedStateCount: snapshot.states.length,
    importedStateCount: importedStates.length,
    queueItemCount: snapshot.queue.items.length,
    workerCount: snapshot.workers.workers.length,
    skippedItems: [],
    conflicts: [],
    notes: [
      "Live leases were not migrated directly.",
      "Worker records were cleared and must be rebuilt by the target backend.",
    ],
    snapshotPath: params.snapshotPath,
    createdAt: now.toISOString(),
  });
}
