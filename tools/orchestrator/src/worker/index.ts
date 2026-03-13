import path from "node:path";
import type { OrchestratorDependencies } from "../orchestrator";
import { blockedReasonSchema, orchestratorStateSchema, type QueueRunItem } from "../schemas";
import { acquireNextQueueRun, applyQueueItemToState, listQueueRuns, renewQueueRunLease, updateQueueRunStatus } from "../queue";
import { recoverStaleQueueRuns } from "../recovery";
import { getPreflightTarget, runOrchestratorPreflight } from "../preflight";
import { runOrchestratorLoop } from "../orchestrator";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveExecutionBlockedReason(params: {
  run: QueueRunItem;
  stateExecutorMode: "mock" | "local_repo" | "openai_responses";
  preflight: Awaited<ReturnType<typeof runOrchestratorPreflight>>;
}) {
  const openAiUnavailable =
    params.stateExecutorMode === "openai_responses" &&
    params.preflight.unavailableProviders.some((provider) => provider.name === "executor:openai_responses") &&
    true;
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

function mapFinalStateToQueueStatus(state: Awaited<ReturnType<typeof runOrchestratorLoop>>) {
  if (state.status === "completed") return "completed" as const;
  if (state.status === "waiting_approval") return "paused" as const;
  if (state.status === "blocked" || state.status === "stopped") return "blocked" as const;
  return "completed" as const;
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
  const run = await acquireNextQueueRun({
    storage: params.dependencies.storage,
    workerId: params.workerId,
    leaseMs: params.leaseMs,
    now,
  });

  if (!run) {
    return {
      status: "idle" as const,
      recoveredCount: recovered.length,
      run: null,
      finalState: null,
    };
  }

  const state = await params.dependencies.storage.loadState(run.stateId);
  if (!state) {
    const blockedRun = await updateQueueRunStatus({
      storage: params.dependencies.storage,
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

  const preflight = await runOrchestratorPreflight({
    repoPath: state.task.repoPath,
    workspaceRoot: state.task.workspaceRoot ?? path.join(state.task.repoPath, ".tmp", "orchestrator-workspaces"),
    state,
  });
  let preflightState = orchestratorStateSchema.parse({
    ...applyQueueItemToState(
      {
        ...state,
        lastPreflightResult: preflight,
        lastBlockedReasons: preflight.blockedReasons,
      },
      run,
      now,
    ),
  });
  await params.dependencies.storage.saveState(preflightState);

  const executionBlocked = resolveExecutionBlockedReason({
    run,
    stateExecutorMode: state.task.executorMode,
    preflight,
  });
  if (executionBlocked) {
    const blockedRun = await updateQueueRunStatus({
      storage: params.dependencies.storage,
      runId: run.id,
      status: "blocked",
      reason: executionBlocked.summary,
      now,
    });
    preflightState = orchestratorStateSchema.parse({
      ...applyQueueItemToState(
        {
          ...preflightState,
          stopReason: executionBlocked.summary,
          lastBlockedReasons: [executionBlocked],
        },
        blockedRun ?? run,
        now,
      ),
    });
    await params.dependencies.storage.saveState(preflightState);
    return {
      status: "blocked" as const,
      recoveredCount: recovered.length,
      run: blockedRun,
      finalState: preflightState,
    };
  }

  const heartbeat = setInterval(() => {
    void renewQueueRunLease({
      storage: params.dependencies.storage,
      runId: run.id,
      workerId: params.workerId,
      leaseMs: params.leaseMs,
    });
  }, Math.max(Math.floor((params.leaseMs ?? 60_000) / 2), 1_000));

  try {
    const finalState = await runOrchestratorLoop(run.stateId, params.dependencies);
    const finalStatus = mapFinalStateToQueueStatus(finalState);
    const finishedRun = await updateQueueRunStatus({
      storage: params.dependencies.storage,
      runId: run.id,
      status: finalStatus,
      reason: finalState.stopReason,
      now: new Date(),
    });
    const updatedState = orchestratorStateSchema.parse(
      applyQueueItemToState(finalState, finishedRun ?? run, new Date()),
    );
    await params.dependencies.storage.saveState(updatedState);
    return {
      status: finalStatus,
      recoveredCount: recovered.length,
      run: finishedRun,
      finalState: updatedState,
    };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runQueueWorker(params: {
  workerId: string;
  dependencies: OrchestratorDependencies;
  continuous?: boolean;
  pollIntervalMs?: number;
  maxPolls?: number;
  leaseMs?: number;
}) {
  const continuous = params.continuous ?? false;
  const pollIntervalMs = params.pollIntervalMs ?? 5_000;
  const maxPolls = params.maxPolls ?? (continuous ? 10 : 1);
  const results: Array<Awaited<ReturnType<typeof runQueueWorkerOnce>>> = [];

  for (let pollCount = 0; maxPolls <= 0 || pollCount < maxPolls; pollCount += 1) {
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
      await delay(pollIntervalMs);
    }
  }

  return {
    workerId: params.workerId,
    polls: results.length,
    processed: results.filter((result) => result.run).length,
    recovered: results.reduce((sum, result) => sum + result.recoveredCount, 0),
    finalStatuses: results.map((result) => result.status),
    queueSize: (await listQueueRuns(params.dependencies.storage)).length,
  };
}
