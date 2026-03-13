import {
  orchestratorStateSchema,
  queueRunCollectionSchema,
  queueRunItemSchema,
  type OrchestratorState,
  type QueueRunCollection,
  type QueueRunItem,
} from "../schemas";
import type { BackendProvider } from "../backend";
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
        `${item.id} :: ${item.status} :: state=${item.stateId} :: priority=${item.priority} :: attempts=${item.attemptCount} :: worker=${item.workerId ?? "none"} :: cancel=${item.cancellationStatus} :: pause=${item.pauseStatus}`,
    )
    .join("\n");
}

export function applyQueueItemToState(
  state: OrchestratorState,
  item: QueueRunItem,
  now: Date,
  recoveryDecision: OrchestratorState["lastRecoveryDecision"] = state.lastRecoveryDecision,
) {
  return orchestratorStateSchema.parse({
    ...state,
    queueStatus: item.status,
    workerId: item.workerId,
    leaseOwner: item.leaseOwner,
    lastHeartbeatAt: item.lastHeartbeatAt,
    lastLeaseRenewalAt: item.lastLeaseRenewalAt,
    cancellationStatus: item.cancellationStatus,
    pauseStatus: item.pauseStatus,
    lastRecoveryDecision: recoveryDecision,
    retryCount: Math.max(item.attemptCount - 1, 0),
    queuedAt: item.queuedAt,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    updatedAt: now.toISOString(),
  });
}

export async function listQueueRuns(backend: BackendProvider) {
  return sortQueueItems((await backend.loadQueue()).items);
}

export async function getQueueRun(backend: BackendProvider, runId: string) {
  return (await backend.loadQueue()).items.find((item) => item.id === runId) ?? null;
}

export async function enqueueStateRun(params: {
  backend: BackendProvider;
  state: OrchestratorState;
  priority?: number;
  scheduledAt?: string;
  requestedBy?: string | null;
}) {
  const now = new Date();
  return params.backend.mutateQueue((queue) => {
    const existing = queue.items.find(
      (item) => item.stateId === params.state.id && ["queued", "running", "paused"].includes(item.status),
    );
    if (existing) {
      return {
        queue,
        result: {
          queue,
          item: existing,
          deduped: true,
        },
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
      lastLeaseRenewalAt: null,
      cancellationStatus: "none",
      pauseStatus: "none",
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
    return {
      queue: nextQueue,
      result: {
        queue: nextQueue,
        item,
        deduped: false,
      },
    };
  });
}

export async function acquireNextQueueRun(params: {
  backend: BackendProvider;
  workerId: string;
  leaseMs?: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const leaseMs = params.leaseMs ?? 60_000;
  return params.backend.mutateQueue((queue) => {
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
      return {
        queue,
        result: null,
      };
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
        lastLeaseRenewalAt: lease.lastHeartbeatAt,
        reason: null,
        cancellationStatus: "none",
        pauseStatus: "none",
      },
      now,
    );
    return {
      queue: nextQueue,
      result: nextQueue.items.find((item) => item.id === candidate.id) ?? null,
    };
  });
}

export async function renewQueueRunLease(params: {
  backend: BackendProvider;
  runId: string;
  workerId: string;
  leaseMs?: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const leaseMs = params.leaseMs ?? 60_000;
  return params.backend.mutateQueue((queue) => {
    const current = queue.items.find((item) => item.id === params.runId);
    if (!current || current.leaseOwner !== params.workerId || current.status !== "running") {
      return {
        queue,
        result: null,
      };
    }
    const lease = createLeaseTimestamps(now, leaseMs);
    const nextQueue = updateItem(
      queue,
      params.runId,
      {
        ...lease,
        lastLeaseRenewalAt: lease.lastHeartbeatAt,
      },
      now,
    );
    return {
      queue: nextQueue,
      result: nextQueue.items.find((item) => item.id === params.runId) ?? null,
    };
  });
}

export async function updateQueueRunStatus(params: {
  backend: BackendProvider;
  runId: string;
  status: QueueRunItem["status"];
  reason?: string | null;
  workerId?: string | null;
  recoveryDecision?: QueueRunItem["recoveryDecision"];
  cancellationStatus?: QueueRunItem["cancellationStatus"];
  pauseStatus?: QueueRunItem["pauseStatus"];
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return params.backend.mutateQueue((queue) => {
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
        lastHeartbeatAt: current.lastHeartbeatAt,
        lastLeaseRenewalAt: current.lastLeaseRenewalAt,
        cancellationStatus:
          params.cancellationStatus ?? (params.status === "cancelled" ? "cancelled" : current.cancellationStatus),
        pauseStatus: params.pauseStatus ?? (params.status === "paused" ? "paused" : current.pauseStatus),
        finishedAt: isTerminalStatus(params.status) ? now.toISOString() : current.finishedAt,
        recoveryDecision: params.recoveryDecision ?? current.recoveryDecision,
      },
      now,
    );
    return {
      queue: nextQueue,
      result: nextQueue.items.find((item) => item.id === params.runId) ?? null,
    };
  });
}

export async function requestCancelRun(backend: BackendProvider, runId: string, reason?: string) {
  const now = new Date();
  return backend.mutateQueue((queue) => {
    const current = queue.items.find((item) => item.id === runId);
    if (!current) {
      throw new Error(`Queue run ${runId} was not found.`);
    }
    if (current.status !== "running") {
      const nextQueue = updateItem(
        queue,
        runId,
        {
          status: "cancelled",
          reason: reason ?? "Run was cancelled by the operator.",
          cancellationStatus: "cancelled",
        },
        now,
      );
      return {
        queue: nextQueue,
        result: nextQueue.items.find((item) => item.id === runId) ?? null,
      };
    }
    const nextQueue = updateItem(
      queue,
      runId,
      {
        cancellationStatus: "cancel_requested",
        reason: reason ?? "Cancellation was requested by the operator.",
      },
      now,
    );
    return {
      queue: nextQueue,
      result: nextQueue.items.find((item) => item.id === runId) ?? null,
    };
  });
}

export async function requestPauseRun(backend: BackendProvider, runId: string, reason?: string) {
  const now = new Date();
  return backend.mutateQueue((queue) => {
    const current = queue.items.find((item) => item.id === runId);
    if (!current) {
      throw new Error(`Queue run ${runId} was not found.`);
    }
    if (current.status !== "running") {
      const nextQueue = updateItem(
        queue,
        runId,
        {
          status: "paused",
          reason: reason ?? "Run was paused by the operator.",
          pauseStatus: "paused",
        },
        now,
      );
      return {
        queue: nextQueue,
        result: nextQueue.items.find((item) => item.id === runId) ?? null,
      };
    }
    const nextQueue = updateItem(
      queue,
      runId,
      {
        pauseStatus: "pause_requested",
        reason: reason ?? "Pause was requested by the operator.",
      },
      now,
    );
    return {
      queue: nextQueue,
      result: nextQueue.items.find((item) => item.id === runId) ?? null,
    };
  });
}

export async function requeueRun(backend: BackendProvider, runId: string, reason?: string) {
  const now = new Date();
  return backend.mutateQueue((queue) => {
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
        lastLeaseRenewalAt: null,
        finishedAt: null,
        cancellationStatus: "none",
        pauseStatus: "none",
        reason: reason ?? "Run was requeued.",
      },
      now,
    );
    return {
      queue: nextQueue,
      result: nextQueue.items.find((item) => item.id === runId) ?? null,
    };
  });
}

export async function forceRequeueExpiredRun(params: {
  backend: BackendProvider;
  runId: string;
  reason?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return params.backend.mutateQueue((queue) => {
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
        lastLeaseRenewalAt: null,
        finishedAt: null,
        cancellationStatus: "none",
        pauseStatus: "none",
        reason: params.reason ?? "Run was requeued after lease expiry.",
      },
      now,
    );
    return {
      queue: nextQueue,
      result: nextQueue.items.find((item) => item.id === params.runId) ?? null,
    };
  });
}
