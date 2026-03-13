import path from "node:path";
import type { OrchestratorDependencies } from "../orchestrator";
import {
  blockedReasonSchema,
  orchestratorStateSchema,
  queueWorkerCollectionSchema,
  queueWorkerRecordSchema,
  type QueueRunItem,
  type QueueWorkerCollection,
  type QueueWorkerRecord,
} from "../schemas";
import {
  acquireNextQueueRun,
  applyQueueItemToState,
  getQueueRun,
  listQueueRuns,
  renewQueueRunLease,
  updateQueueRunStatus,
} from "../queue";
import { recoverStaleQueueRuns } from "../recovery";
import { getPreflightTarget, runOrchestratorPreflight } from "../preflight";
import { runOrchestratorOnce } from "../orchestrator";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEmptyWorkers() {
  return queueWorkerCollectionSchema.parse({
    updatedAt: new Date(0).toISOString(),
    workers: [],
  });
}

async function loadWorkers(dependencies: OrchestratorDependencies) {
  return dependencies.backend.loadWorkers();
}

async function saveWorkerRecord(
  dependencies: OrchestratorDependencies,
  workerId: string,
  patch: Partial<QueueWorkerRecord>,
  now = new Date(),
) {
  const workers = await loadWorkers(dependencies);
  const existing = workers.workers.find((worker) => worker.workerId === workerId);
  const nextRecord = queueWorkerRecordSchema.parse({
    status: "idle",
    supervisionStatus: "inactive",
    currentRunId: null,
    leaseOwner: null,
    lastHeartbeatAt: null,
    daemonHeartbeatAt: null,
    lastError: null,
    consecutiveErrors: 0,
    idleCycles: 0,
    pollCount: 0,
    startedAt: existing?.startedAt ?? now.toISOString(),
    ...existing,
    ...patch,
    workerId,
    backendType: dependencies.backend.backendType,
    updatedAt: now.toISOString(),
  });
  const nextWorkers = queueWorkerCollectionSchema.parse({
    updatedAt: now.toISOString(),
    workers: [
      ...workers.workers.filter((worker) => worker.workerId !== workerId),
      nextRecord,
    ],
  });
  await dependencies.backend.saveWorkers(nextWorkers);
  return nextRecord;
}

export async function getWorkerStatus(dependencies: OrchestratorDependencies, workerId?: string | null) {
  const workers = await loadWorkers(dependencies);
  if (!workerId) {
    return {
      updatedAt: workers.updatedAt,
      workers: workers.workers,
    };
  }
  return workers.workers.find((worker) => worker.workerId === workerId) ?? null;
}

function resolveExecutionBlockedReason(params: {
  run: QueueRunItem;
  stateExecutorMode: "mock" | "local_repo" | "openai_responses";
  preflight: Awaited<ReturnType<typeof runOrchestratorPreflight>>;
}) {
  const openAiUnavailable =
    params.stateExecutorMode === "openai_responses" &&
    params.preflight.unavailableProviders.some((provider) => provider.name === "executor:openai_responses");
  if (openAiUnavailable) {
    return blockedReasonSchema.parse({
      code: "executor_provider_unavailable",
      summary: "Requested executor provider is unavailable for this run.",
      missingPrerequisites: params.preflight.missingEnv,
      recoverable: true,
      suggestedNextAction: "Provide the missing provider prerequisites or switch execution mode.",
    });
  }

  if (!params.preflight.allowedExecutionModes.includes(params.run.executionMode)) {
    return blockedReasonSchema.parse({
      code: "execution_mode_not_allowed",
      summary: `Execution mode ${params.run.executionMode} is not allowed by preflight.`,
      missingPrerequisites: [...params.preflight.missingEnv, ...params.preflight.missingTools],
      recoverable: true,
      suggestedNextAction: "Resolve the missing prerequisites or choose an allowed execution mode.",
    });
  }

  const promotionTarget = getPreflightTarget(params.preflight, "promotion");
  if (params.run.executionMode === "apply" && promotionTarget?.status === "blocked") {
    return promotionTarget.blockedReasons[0] ?? null;
  }

  return null;
}

function mapFinalStateToQueueStatus(state: Awaited<ReturnType<typeof runOrchestratorOnce>>) {
  if (state.status === "completed") return "completed" as const;
  if (state.status === "waiting_approval") return "paused" as const;
  if (state.status === "blocked" || state.status === "stopped") return "blocked" as const;
  if (state.status === "needs_revision") return "queued" as const;
  return "completed" as const;
}

async function syncStateFromQueueItem(
  dependencies: OrchestratorDependencies,
  stateId: string,
  item: QueueRunItem,
  now: Date,
) {
  const state = await dependencies.storage.loadState(stateId);
  if (!state) {
    return null;
  }
  const updatedState = applyQueueItemToState(state, item, now);
  await dependencies.storage.saveState(updatedState);
  return updatedState;
}

async function requestAwareFinalize(params: {
  dependencies: OrchestratorDependencies;
  run: QueueRunItem;
  now: Date;
}) {
  const latestRun = await getQueueRun(params.dependencies.backend, params.run.id);
  if (!latestRun) {
    return {
      status: "blocked" as const,
      queueRun: null,
      reason: "Queue run disappeared before finalization.",
    };
  }
  if (latestRun.cancellationStatus === "cancel_requested") {
    const cancelled = await updateQueueRunStatus({
      backend: params.dependencies.backend,
      runId: latestRun.id,
      status: "cancelled",
      reason: latestRun.reason ?? "Run was cooperatively cancelled at a safe boundary.",
      cancellationStatus: "cancelled",
      now: params.now,
    });
    return {
      status: "cancelled" as const,
      queueRun: cancelled,
      reason: cancelled?.reason ?? null,
    };
  }
  if (latestRun.pauseStatus === "pause_requested") {
    const paused = await updateQueueRunStatus({
      backend: params.dependencies.backend,
      runId: latestRun.id,
      status: "paused",
      reason: latestRun.reason ?? "Run was cooperatively paused at a safe boundary.",
      pauseStatus: "paused",
      now: params.now,
    });
    return {
      status: "paused" as const,
      queueRun: paused,
      reason: paused?.reason ?? null,
    };
  }
  return {
    status: "continue" as const,
    queueRun: latestRun,
    reason: null,
  };
}

export async function runQueueWorkerOnce(params: {
  workerId: string;
  dependencies: OrchestratorDependencies;
  leaseMs?: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const recovered = await recoverStaleQueueRuns({
    dependencies: params.dependencies,
    now,
  });
  await saveWorkerRecord(params.dependencies, params.workerId, {
    status: "polling",
    supervisionStatus: "healthy",
    daemonHeartbeatAt: now.toISOString(),
    pollCount: ((await getWorkerStatus(params.dependencies, params.workerId)) as QueueWorkerRecord | null)?.pollCount ?? 0,
  }, now);

  const run = await acquireNextQueueRun({
    backend: params.dependencies.backend,
    workerId: params.workerId,
    leaseMs: params.leaseMs,
    now,
  });

  if (!run) {
    const existing = (await getWorkerStatus(params.dependencies, params.workerId)) as QueueWorkerRecord | null;
    await saveWorkerRecord(params.dependencies, params.workerId, {
      status: "idle",
      supervisionStatus: "healthy",
      daemonHeartbeatAt: now.toISOString(),
      idleCycles: (existing?.idleCycles ?? 0) + 1,
      pollCount: (existing?.pollCount ?? 0) + 1,
      currentRunId: null,
      leaseOwner: null,
      lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
    }, now);
    return {
      status: "idle" as const,
      recoveredCount: recovered.length,
      run: null,
      finalState: null,
    };
  }

  await saveWorkerRecord(params.dependencies, params.workerId, {
    status: "running",
    supervisionStatus: "healthy",
    currentRunId: run.id,
    leaseOwner: params.workerId,
    lastHeartbeatAt: now.toISOString(),
    daemonHeartbeatAt: now.toISOString(),
    idleCycles: 0,
    pollCount: (((await getWorkerStatus(params.dependencies, params.workerId)) as QueueWorkerRecord | null)?.pollCount ?? 0) + 1,
  }, now);

  const state = await params.dependencies.storage.loadState(run.stateId);
  if (!state) {
    const blockedRun = await updateQueueRunStatus({
      backend: params.dependencies.backend,
      runId: run.id,
      status: "blocked",
      reason: "State for queued run was not found.",
      now,
    });
    return {
      status: "blocked" as const,
      recoveredCount: recovered.length,
      run: blockedRun,
      finalState: null,
    };
  }

  let currentRun = run;
  let currentState = orchestratorStateSchema.parse({
    ...applyQueueItemToState(state, currentRun, now),
    workerStatus: "running",
    supervisionStatus: "healthy",
    daemonHeartbeatAt: now.toISOString(),
    backendType: params.dependencies.backend.backendType,
  });
  await params.dependencies.storage.saveState(currentState);

  const heartbeat = setInterval(() => {
    void (async () => {
      const renewed = await renewQueueRunLease({
        backend: params.dependencies.backend,
        runId: currentRun.id,
        workerId: params.workerId,
        leaseMs: params.leaseMs,
      });
      if (renewed) {
        currentRun = renewed;
        await saveWorkerRecord(params.dependencies, params.workerId, {
          status: "running",
          supervisionStatus: "healthy",
          currentRunId: renewed.id,
          leaseOwner: params.workerId,
          lastHeartbeatAt: renewed.lastHeartbeatAt,
          daemonHeartbeatAt: new Date().toISOString(),
        });
        await syncStateFromQueueItem(params.dependencies, currentRun.stateId, renewed, new Date());
      }
    })();
  }, Math.max(Math.floor((params.leaseMs ?? 60_000) / 2), 1_000));

  try {
    for (;;) {
      const preflight = await runOrchestratorPreflight({
        repoPath: currentState.task.repoPath,
        workspaceRoot: currentState.task.workspaceRoot ?? path.join(currentState.task.repoPath, ".tmp", "orchestrator-workspaces"),
        state: currentState,
      });
      currentState = orchestratorStateSchema.parse({
        ...currentState,
        lastPreflightResult: preflight,
        lastBlockedReasons: preflight.blockedReasons,
        updatedAt: new Date().toISOString(),
      });
      await params.dependencies.storage.saveState(currentState);

      const executionBlocked = resolveExecutionBlockedReason({
        run: currentRun,
        stateExecutorMode: currentState.task.executorMode,
        preflight,
      });
      if (executionBlocked) {
        const blockedRun = await updateQueueRunStatus({
          backend: params.dependencies.backend,
          runId: currentRun.id,
          status: "blocked",
          reason: executionBlocked.summary,
          now: new Date(),
        });
        currentState = orchestratorStateSchema.parse({
          ...applyQueueItemToState(
            {
              ...currentState,
              stopReason: executionBlocked.summary,
              lastBlockedReasons: [executionBlocked],
            },
            blockedRun ?? currentRun,
            new Date(),
          ),
          workerStatus: "idle",
          supervisionStatus: "healthy",
          backendType: params.dependencies.backend.backendType,
        });
        await params.dependencies.storage.saveState(currentState);
        await saveWorkerRecord(params.dependencies, params.workerId, {
          status: "idle",
          supervisionStatus: "healthy",
          currentRunId: null,
          leaseOwner: null,
          lastHeartbeatAt: blockedRun?.lastHeartbeatAt ?? null,
          daemonHeartbeatAt: new Date().toISOString(),
          consecutiveErrors: 0,
        });
        return {
          status: "blocked" as const,
          recoveredCount: recovered.length,
          run: blockedRun,
          finalState: currentState,
        };
      }

      const decision = await requestAwareFinalize({
        dependencies: params.dependencies,
        run: currentRun,
        now: new Date(),
      });
      if (decision.status === "cancelled" || decision.status === "paused") {
        currentState = orchestratorStateSchema.parse({
          ...applyQueueItemToState(currentState, decision.queueRun ?? currentRun, new Date()),
          workerStatus: "idle",
          supervisionStatus: "healthy",
          backendType: params.dependencies.backend.backendType,
        });
        await params.dependencies.storage.saveState(currentState);
        await saveWorkerRecord(params.dependencies, params.workerId, {
          status: "idle",
          supervisionStatus: "healthy",
          currentRunId: null,
          leaseOwner: null,
          lastHeartbeatAt: decision.queueRun?.lastHeartbeatAt ?? null,
          daemonHeartbeatAt: new Date().toISOString(),
          consecutiveErrors: 0,
        });
        return {
          status: decision.status,
          recoveredCount: recovered.length,
          run: decision.queueRun,
          finalState: currentState,
        };
      }

      currentState = await runOrchestratorOnce(currentRun.stateId, params.dependencies);
      const postExecutionDecision = await requestAwareFinalize({
        dependencies: params.dependencies,
        run: currentRun,
        now: new Date(),
      });
      if (postExecutionDecision.status === "cancelled" || postExecutionDecision.status === "paused") {
        currentState = orchestratorStateSchema.parse({
          ...applyQueueItemToState(currentState, postExecutionDecision.queueRun ?? currentRun, new Date()),
          workerStatus: "idle",
          supervisionStatus: "healthy",
          backendType: params.dependencies.backend.backendType,
        });
        await params.dependencies.storage.saveState(currentState);
        await saveWorkerRecord(params.dependencies, params.workerId, {
          status: "idle",
          supervisionStatus: "healthy",
          currentRunId: null,
          leaseOwner: null,
          lastHeartbeatAt: postExecutionDecision.queueRun?.lastHeartbeatAt ?? null,
          daemonHeartbeatAt: new Date().toISOString(),
          consecutiveErrors: 0,
        });
        return {
          status: postExecutionDecision.status,
          recoveredCount: recovered.length,
          run: postExecutionDecision.queueRun,
          finalState: currentState,
        };
      }
      const finalStatus = mapFinalStateToQueueStatus(currentState);

      if (finalStatus !== "queued") {
        const finishedRun = await updateQueueRunStatus({
          backend: params.dependencies.backend,
          runId: currentRun.id,
          status: finalStatus,
          reason: currentState.stopReason,
          cancellationStatus: currentRun.cancellationStatus,
          pauseStatus: finalStatus === "paused" ? "paused" : currentRun.pauseStatus,
          now: new Date(),
        });
        currentState = orchestratorStateSchema.parse({
          ...applyQueueItemToState(currentState, finishedRun ?? currentRun, new Date()),
          workerStatus: "idle",
          supervisionStatus: "healthy",
          backendType: params.dependencies.backend.backendType,
        });
        await params.dependencies.storage.saveState(currentState);
        await saveWorkerRecord(params.dependencies, params.workerId, {
          status: "idle",
          supervisionStatus: "healthy",
          currentRunId: null,
          leaseOwner: null,
          lastHeartbeatAt: finishedRun?.lastHeartbeatAt ?? null,
          daemonHeartbeatAt: new Date().toISOString(),
          consecutiveErrors: 0,
        });
        return {
          status: finalStatus,
          recoveredCount: recovered.length,
          run: finishedRun,
          finalState: currentState,
        };
      }

      const requeued = await updateQueueRunStatus({
        backend: params.dependencies.backend,
        runId: currentRun.id,
        status: "queued",
        reason: currentState.stopReason ?? "Run requires another queued iteration.",
        cancellationStatus: "none",
        pauseStatus: "none",
        now: new Date(),
      });
      currentRun = (await acquireNextQueueRun({
        backend: params.dependencies.backend,
        workerId: params.workerId,
        leaseMs: params.leaseMs,
        now: new Date(),
      })) ?? requeued ?? currentRun;
      currentState = orchestratorStateSchema.parse({
        ...applyQueueItemToState(currentState, currentRun, new Date()),
        workerStatus: "running",
        supervisionStatus: "healthy",
        backendType: params.dependencies.backend.backendType,
      });
      await params.dependencies.storage.saveState(currentState);
      await saveWorkerRecord(params.dependencies, params.workerId, {
        status: "running",
        supervisionStatus: "healthy",
        currentRunId: currentRun.id,
        leaseOwner: params.workerId,
        lastHeartbeatAt: currentRun.lastHeartbeatAt,
        daemonHeartbeatAt: new Date().toISOString(),
        consecutiveErrors: 0,
      });
    }
  } catch (error) {
    const existing = (await getWorkerStatus(params.dependencies, params.workerId)) as QueueWorkerRecord | null;
    await saveWorkerRecord(params.dependencies, params.workerId, {
      status: "backing_off",
      supervisionStatus: "backing_off",
      currentRunId: currentRun.id,
      leaseOwner: params.workerId,
      lastError: error instanceof Error ? error.message : String(error),
      consecutiveErrors: (existing?.consecutiveErrors ?? 0) + 1,
      daemonHeartbeatAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runQueueWorker(params: {
  workerId: string;
  dependencies: OrchestratorDependencies;
  continuous?: boolean;
  daemon?: boolean;
  pollIntervalMs?: number;
  maxPolls?: number;
  maxIdleCycles?: number;
  maxBackoffMs?: number;
  leaseMs?: number;
}) {
  const continuous = params.continuous ?? false;
  const daemon = params.daemon ?? continuous;
  const pollIntervalMs = params.pollIntervalMs ?? 5_000;
  const maxPolls = params.maxPolls ?? (continuous ? 10 : 1);
  const maxIdleCycles = params.maxIdleCycles ?? 3;
  const maxBackoffMs = params.maxBackoffMs ?? 15_000;
  const results: Array<Awaited<ReturnType<typeof runQueueWorkerOnce>>> = [];
  let idleCycles = 0;
  let backoffMs = pollIntervalMs;

  await saveWorkerRecord(params.dependencies, params.workerId, {
    status: "idle",
    supervisionStatus: daemon ? "healthy" : "inactive",
    currentRunId: null,
    daemonHeartbeatAt: new Date().toISOString(),
    pollCount: 0,
  });

  for (let pollCount = 0; maxPolls <= 0 || pollCount < maxPolls; pollCount += 1) {
    try {
      const result = await runQueueWorkerOnce({
        workerId: params.workerId,
        dependencies: params.dependencies,
        leaseMs: params.leaseMs,
      });
      results.push(result);
      if (!continuous) {
        break;
      }
      if (result.status === "idle") {
        idleCycles += 1;
        if (idleCycles >= maxIdleCycles) {
          break;
        }
        await delay(pollIntervalMs);
      } else {
        idleCycles = 0;
      }
      backoffMs = pollIntervalMs;
    } catch (error) {
      const existing = (await getWorkerStatus(params.dependencies, params.workerId)) as QueueWorkerRecord | null;
      await saveWorkerRecord(params.dependencies, params.workerId, {
        status: "backing_off",
        supervisionStatus: "backing_off",
        currentRunId: existing?.currentRunId ?? null,
        leaseOwner: existing?.leaseOwner ?? null,
        lastError: error instanceof Error ? error.message : String(error),
        consecutiveErrors: (existing?.consecutiveErrors ?? 0) + 1,
        daemonHeartbeatAt: new Date().toISOString(),
      });
      if (!continuous) {
        throw error;
      }
      await delay(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }

  await saveWorkerRecord(params.dependencies, params.workerId, {
    status: "stopped",
    supervisionStatus: daemon ? "stopped" : "inactive",
    currentRunId: null,
    leaseOwner: null,
    daemonHeartbeatAt: new Date().toISOString(),
  });

  const queueSize = (await listQueueRuns(params.dependencies.backend)).length;
  const workerRecord = (await getWorkerStatus(params.dependencies, params.workerId)) as QueueWorkerRecord | null;
  return {
    workerId: params.workerId,
    polls: results.length,
    processed: results.filter((result) => result.run).length,
    recovered: results.reduce((sum, result) => sum + result.recoveredCount, 0),
    finalStatuses: results.map((result) => result.status),
    queueSize,
    backendType: params.dependencies.backend.backendType,
    daemon,
    workerStatus: workerRecord?.status ?? "stopped",
    supervisionStatus: workerRecord?.supervisionStatus ?? "inactive",
    lastError: workerRecord?.lastError ?? null,
    heartbeatStatus: workerRecord?.daemonHeartbeatAt ?? null,
  };
}
