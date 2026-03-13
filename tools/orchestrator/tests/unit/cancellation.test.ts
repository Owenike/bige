import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ExecutionProvider, ExecutionProviderRun, ExecutionProviderTask } from "../../src/executor-adapters";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { enqueueStateRun, getQueueRun, requestCancelRun, requestPauseRun } from "../../src/queue";
import { runQueueWorkerOnce } from "../../src/worker";
import type { ExecutionReport } from "../../src/schemas";

class DelayedExecutor implements ExecutionProvider {
  readonly kind = "mock" as const;
  private readonly runs = new Map<string, Promise<ExecutionReport>>();

  async submitTask(task: ExecutionProviderTask): Promise<ExecutionProviderRun> {
    const runId = `delayed-${task.iterationNumber}-${Date.now()}`;
    this.runs.set(
      runId,
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            iterationNumber: task.iterationNumber,
            changedFiles: [],
            checkedButUnmodifiedFiles: task.allowedFiles,
            summaryOfChanges: ["Delayed executor finished."],
            whyThisWasDone: ["Exercise cooperative cancellation boundaries."],
            howBehaviorWasKeptStable: ["No product files changed."],
            localValidation: task.acceptanceCommands.map((command) => ({
              command,
              status: "passed" as const,
              output: null,
            })),
            ciValidation: null,
            blockers: [],
            risks: [],
            recommendedNextStep: "Continue the loop.",
            shouldCloseSlice: false,
            artifacts: [],
          });
        }, 50);
      }),
    );
    return {
      runId,
      status: "running",
    };
  }

  async pollRun(runId: string): Promise<ExecutionProviderRun> {
    return {
      runId,
      status: this.runs.has(runId) ? "running" : "failed",
    };
  }

  async cancelRun(): Promise<void> {}

  async collectResult(runId: string): Promise<ExecutionReport> {
    const result = this.runs.get(runId);
    if (!result) {
      throw new Error(`Missing delayed run ${runId}.`);
    }
    return result;
  }
}

async function waitForRunningRunId(dependencies: ReturnType<typeof createDefaultDependencies>, stateId: string) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const queue = await dependencies.backend.loadQueue();
    const running = queue.items.find((item) => item.stateId === stateId && item.status === "running");
    if (running) {
      return running.id;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for running queue item for ${stateId}.`);
}

test("running queue item can be cooperatively cancelled at the next safe boundary", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-cancel-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  dependencies.executorProviders.mock = new DelayedExecutor();

  const state = createInitialState({
    id: "cancel-safe-boundary",
    repoPath,
    repoName: "bige",
    userGoal: "Cancel a running worker safely",
    objective: "Cooperative cancellation",
    subtasks: ["queue", "worker", "cancel"],
    successCriteria: ["cancelled run does not rely on lease expiry"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({ backend: dependencies.backend, state });

  const workerPromise = runQueueWorkerOnce({
    workerId: "cancel-worker",
    dependencies,
    leaseMs: 10_000,
  });
  const runId = await waitForRunningRunId(dependencies, state.id);
  await requestCancelRun(dependencies.backend, runId, "Cancel after current safe boundary.");
  const result = await workerPromise;
  const finalRun = await getQueueRun(dependencies.backend, runId);

  assert.equal(result.status, "cancelled");
  assert.equal(finalRun?.status, "cancelled");
  assert.equal(finalRun?.cancellationStatus, "cancelled");
});

test("running queue item can be cooperatively paused at the next safe boundary", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-pause-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  dependencies.executorProviders.mock = new DelayedExecutor();

  const state = createInitialState({
    id: "pause-safe-boundary",
    repoPath,
    repoName: "bige",
    userGoal: "Pause a running worker safely",
    objective: "Cooperative pause",
    subtasks: ["queue", "worker", "pause"],
    successCriteria: ["paused run does not rely on lease expiry"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({ backend: dependencies.backend, state });

  const workerPromise = runQueueWorkerOnce({
    workerId: "pause-worker",
    dependencies,
    leaseMs: 10_000,
  });
  const runId = await waitForRunningRunId(dependencies, state.id);
  await requestPauseRun(dependencies.backend, runId, "Pause after current safe boundary.");
  const result = await workerPromise;
  const finalRun = await getQueueRun(dependencies.backend, runId);

  assert.equal(result.status, "paused");
  assert.equal(finalRun?.status, "paused");
  assert.equal(finalRun?.pauseStatus, "paused");
});
