import { queueRunCollectionSchema, queueRunItemSchema, type OrchestratorState, type QueueRunCollection, type QueueRunItem } from "../schemas";
import type { StorageProvider } from "../storage";
import { buildLockScopeKeys, createLeaseTimestamps, hasLockConflict } from "../locking";

function sortQueueItems(items: QueueRunItem[]) {
  return [...items].sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    if (left.scheduledAt !== right.scheduledAt) {
      return left.scheduledAt.localeCompare(right.scheduledAt);
    }
    return left.requestedAt.localeCompare(right.requestedAt);
  });
}

function isTerminalStatus(status: QueueRunItem["status"]) {
  return ["completed", "failed", "blocked", "cancelled"].includes(status);
}

function updateItem(queue: QueueRunCollection, runId: string, patch: Partial<QueueRunItem>, now: Date) {
  return queueRunCollectionSchema.parse({
    ...queue,
    updatedAt: now.toISOString(),
    items: queue.items.map((item) => (item.id === runId ? queueRunItemSchema.parse({ ...item, ...patch }) : item)),
  });
}

export function formatQueueSummary(items: QueueRunItem[]) {
  if (items.length === 0) {
    return "Queue is empty.";
  }
  return sortQueueItems(items)
    .map(
      (item) =>
        `${item.id} :: ${item.status} :: state=${item.stateId} :: priority=${item.priority} :: attempts=${item.attemptCount} :: worker=${item.workerId ?? "none"}`,
    )
    .join("\n");
}

export function applyQueueItemToState(
  state: OrchestratorState,
  item: QueueRunItem,
  now: Date,
  recoveryDecision: OrchestratorState["lastRecoveryDecision"] = state.lastRecoveryDecision,
) {
  return {
    ...state,
    queueStatus: item.status,
    workerId: item.workerId,
    leaseOwner: item.leaseOwner,
    lastHeartbeatAt: item.lastHeartbeatAt,
    lastRecoveryDecision: recoveryDecision,
    retryCount: Math.max(item.attemptCount - 1, 0),
    queuedAt: item.queuedAt,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    updatedAt: now.toISOString(),
  } satisfies Partial<OrchestratorState>;
}

export async function listQueueRuns(storage: StorageProvider) {
  return sortQueueItems((await storage.loadQueue()).items);
}

export async function enqueueStateRun(params: {
  storage: StorageProvider;
  state: OrchestratorState;
  priority?: number;
  scheduledAt?: string;
  requestedBy?: string | null;
}) {
  const now = new Date();
  const queue = await params.storage.loadQueue();
  const existing = queue.items.find(
    (item) => item.stateId === params.state.id && ["queued", "running", "paused"].includes(item.status),
  );
  if (existing) {
    return {
      queue,
      item: existing,
      deduped: true,
    };
  }

  const item = queueRunItemSchema.parse({
    id: `${params.state.id}-run-${now.getTime()}`,
    taskId: params.state.id,
    stateId: params.state.id,
    iterationNumber: params.state.nextIterationPlan?.iterationNumber ?? params.state.iterationNumber + 1,
    priority: params.priority ?? 0,
    requestedAt: now.toISOString(),
    scheduledAt: params.scheduledAt ?? now.toISOString(),
    status: "queued",
    attemptCount: 0,
    profileId: params.state.task.profileId,
    executionMode: params.state.task.executionMode,
    approvalMode: params.state.task.approvalMode,
    repoPath: params.state.task.repoPath,
    workspaceRoot: params.state.task.workspaceRoot,
    lockScopeKeys: buildLockScopeKeys({
      stateId: params.state.id,
      repoPath: params.state.task.repoPath,
      workspaceRoot: params.state.task.workspaceRoot,
    }),
    workerId: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    queuedAt: now.toISOString(),
    startedAt: null,
    finishedAt: null,
    reason: params.requestedBy ?? null,
    recoveryDecision: null,
  });
  const nextQueue = queueRunCollectionSchema.parse({
    updatedAt: now.toISOString(),
    items: [...queue.items, item],
  });
  await params.storage.saveQueue(nextQueue);
  return {
    queue: nextQueue,
    item,
    deduped: false,
  };
}

export async function acquireNextQueueRun(params: {
  storage: StorageProvider;
  workerId: string;
  leaseMs?: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const leaseMs = params.leaseMs ?? 60_000;
  const queue = await params.storage.loadQueue();
  const sorted = sortQueueItems(queue.items);
  const candidate = sorted.find((item) => {
    if (item.status !== "queued") return false;
    if (new Date(item.scheduledAt).getTime() > now.getTime()) return false;
    return !hasLockConflict({
      candidate: item,
      items: queue.items,
      now,
    });
  });
  if (!candidate) {
    return null;
  }

  const lease = createLeaseTimestamps(now, leaseMs);
  const nextQueue = updateItem(
    queue,
    candidate.id,
    {
      status: "running",
      workerId: params.workerId,
      leaseOwner: params.workerId,
      attemptCount: candidate.attemptCount + 1,
      startedAt: candidate.startedAt ?? now.toISOString(),
      finishedAt: null,
      ...lease,
      reason: null,
    },
    now,
  );
  await params.storage.saveQueue(nextQueue);
  return nextQueue.items.find((item) => item.id === candidate.id) ?? null;
}

export async function renewQueueRunLease(params: {
  storage: StorageProvider;
  runId: string;
  workerId: string;
  leaseMs?: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const leaseMs = params.leaseMs ?? 60_000;
  const queue = await params.storage.loadQueue();
  const current = queue.items.find((item) => item.id === params.runId);
  if (!current || current.leaseOwner !== params.workerId || current.status !== "running") {
    return null;
  }
  const nextQueue = updateItem(queue, params.runId, createLeaseTimestamps(now, leaseMs), now);
  await params.storage.saveQueue(nextQueue);
  return nextQueue.items.find((item) => item.id === params.runId) ?? null;
}

export async function updateQueueRunStatus(params: {
  storage: StorageProvider;
  runId: string;
  status: QueueRunItem["status"];
  reason?: string | null;
  workerId?: string | null;
  recoveryDecision?: QueueRunItem["recoveryDecision"];
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const queue = await params.storage.loadQueue();
  const current = queue.items.find((item) => item.id === params.runId);
  if (!current) {
    throw new Error(`Queue run ${params.runId} was not found.`);
  }
  const nextQueue = updateItem(
    queue,
    params.runId,
    {
      status: params.status,
      reason: params.reason ?? current.reason,
      workerId: params.status === "running" ? (params.workerId ?? current.workerId) : null,
      leaseOwner: params.status === "running" ? (params.workerId ?? current.leaseOwner) : null,
      leaseExpiresAt: params.status === "running" ? current.leaseExpiresAt : null,
      lastHeartbeatAt: params.status === "running" ? current.lastHeartbeatAt : current.lastHeartbeatAt,
      finishedAt: isTerminalStatus(params.status) ? now.toISOString() : current.finishedAt,
      recoveryDecision: params.recoveryDecision ?? current.recoveryDecision,
    },
    now,
  );
  await params.storage.saveQueue(nextQueue);
  return nextQueue.items.find((item) => item.id === params.runId) ?? null;
}

export async function cancelQueueRun(storage: StorageProvider, runId: string, reason?: string) {
  const current = (await storage.loadQueue()).items.find((item) => item.id === runId);
  if (current?.status === "running") {
    throw new Error("Cannot cancel a running run without cooperative cancellation.");
  }
  return updateQueueRunStatus({ storage, runId, status: "cancelled", reason: reason ?? "Run was cancelled by the operator." });
}

export async function pauseQueueRun(storage: StorageProvider, runId: string, reason?: string) {
  const current = (await storage.loadQueue()).items.find((item) => item.id === runId);
  if (current?.status === "running") {
    throw new Error("Cannot pause a running run without cooperative cancellation.");
  }
  return updateQueueRunStatus({ storage, runId, status: "paused", reason: reason ?? "Run was paused by the operator." });
}

export async function requeueRun(storage: StorageProvider, runId: string, reason?: string) {
  const now = new Date();
  const queue = await storage.loadQueue();
  const current = queue.items.find((item) => item.id === runId);
  if (!current) {
    throw new Error(`Queue run ${runId} was not found.`);
  }
  if (current.status === "running") {
    throw new Error("Cannot requeue a running run until its lease expires or recovery takes over.");
  }
  const nextQueue = updateItem(
    queue,
    runId,
    {
      status: "queued",
      scheduledAt: now.toISOString(),
      workerId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      finishedAt: null,
      reason: reason ?? "Run was requeued.",
    },
    now,
  );
  await storage.saveQueue(nextQueue);
  return nextQueue.items.find((item) => item.id === runId) ?? null;
}

export async function forceRequeueExpiredRun(params: {
  storage: StorageProvider;
  runId: string;
  reason?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const queue = await params.storage.loadQueue();
  const current = queue.items.find((item) => item.id === params.runId);
  if (!current) {
    throw new Error(`Queue run ${params.runId} was not found.`);
  }
  if (current.status !== "running") {
    throw new Error("Force requeue is only allowed for stale running runs.");
  }
  if (!current.leaseExpiresAt || new Date(current.leaseExpiresAt).getTime() > now.getTime()) {
    throw new Error("Cannot force requeue a run with an active lease.");
  }
  const nextQueue = updateItem(
    queue,
    params.runId,
    {
      status: "queued",
      scheduledAt: now.toISOString(),
      workerId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      finishedAt: null,
      reason: params.reason ?? "Run was requeued after lease expiry.",
    },
    now,
  );
  await params.storage.saveQueue(nextQueue);
  return nextQueue.items.find((item) => item.id === params.runId) ?? null;
}
