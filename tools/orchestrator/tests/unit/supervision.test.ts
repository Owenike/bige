import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ExecutionProvider, ExecutionProviderRun, ExecutionProviderTask } from "../../src/executor-adapters";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { enqueueStateRun } from "../../src/queue";
import { getWorkerStatus, runQueueWorker } from "../../src/worker";

class FailingExecutor implements ExecutionProvider {
  readonly kind = "mock" as const;

  async submitTask(task: ExecutionProviderTask): Promise<ExecutionProviderRun> {
    return {
      runId: `failing-${task.iterationNumber}`,
      status: "failed",
    };
  }

  async pollRun(runId: string): Promise<ExecutionProviderRun> {
    return {
      runId,
      status: "failed",
    };
  }

  async cancelRun(): Promise<void> {}

  async collectResult(): Promise<never> {
    throw new Error("Executor failed during supervision test.");
  }
}

test("worker supervision records backoff after repeated execution errors", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-supervision-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  dependencies.executorProviders.mock = new FailingExecutor();

  const state = createInitialState({
    id: "supervision-state",
    repoPath,
    repoName: "bige",
    userGoal: "Back off after repeated worker failures",
    objective: "Worker supervision backoff",
    subtasks: ["worker", "supervision", "backoff"],
    successCriteria: ["worker records backoff status"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);
  await enqueueStateRun({ backend: dependencies.backend, state });

  const summary = await runQueueWorker({
    workerId: "supervision-worker",
    dependencies,
    continuous: true,
    daemon: true,
    pollIntervalMs: 10,
    maxPolls: 1,
    maxBackoffMs: 20,
  });

  const worker = await getWorkerStatus(dependencies, "supervision-worker");
  assert.equal(summary.supervisionStatus, "stopped");
  assert.equal(summary.lastError?.includes("Executor failed"), true);
  assert.equal((worker as { supervisionStatus: string }).supervisionStatus, "stopped");
  assert.equal((worker as { lastError: string | null }).lastError?.includes("Executor failed"), true);
});
