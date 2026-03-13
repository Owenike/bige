import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState, runOrchestratorOnce } from "../../src/orchestrator";
import { OpenAIResponsesExecutorProvider } from "../../src/executor-adapters";
import { FileSystemWorkspaceManager } from "../../src/workspace";
import type { OpenAIResponsesClient, StructuredOutputRequest } from "../../src/openai";

class SequencedResponsesClient implements OpenAIResponsesClient {
  private index = 0;

  constructor(private readonly responses: unknown[]) {}

  async createStructuredOutput<T>(_request: StructuredOutputRequest): Promise<T> {
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) {
      throw new Error("No more mocked Responses turns were configured.");
    }
    return response as T;
  }
}

async function createTempRepo() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-executor-"));
  await mkdir(path.join(repoRoot, "allowed"), { recursive: true });
  await writeFile(path.join(repoRoot, "allowed", "file.txt"), "before\n", "utf8");
  return repoRoot;
}

test("OpenAIResponsesExecutorProvider can produce a diff artifact in dry-run mode", async () => {
  const repoRoot = await createTempRepo();
  const workspaceRoot = path.join(repoRoot, ".workspaces");
  const executor = new OpenAIResponsesExecutorProvider({
    client: new SequencedResponsesClient([
      { kind: "read_file", reasoning: "Inspect the file first.", relativePath: "allowed/file.txt" },
      { kind: "write_file", reasoning: "Update the content.", relativePath: "allowed/file.txt", content: "after\n" },
      {
        kind: "complete",
        reasoning: "Done.",
        summaryOfChanges: ["Updated allowed/file.txt inside the isolated workspace."],
        whyThisWasDone: ["Exercise dry-run patch flow."],
        howBehaviorWasKeptStable: ["Main repo remains untouched in dry-run mode."],
        risks: [],
        recommendedNextStep: "Review the diff artifact.",
        shouldCloseSlice: false,
      },
    ]),
    workspaceManager: new FileSystemWorkspaceManager(workspaceRoot),
  });

  const run = await executor.submitTask({
    iterationNumber: 1,
    prompt: "Change the file in the isolated workspace.",
    allowedFiles: ["allowed"],
    forbiddenFiles: ["app/api/platform/notifications"],
    acceptanceCommands: [],
    repoPath: repoRoot,
    metadata: {
      taskId: "dry-run",
      executionMode: "dry_run",
      applyAllowed: false,
    },
  });
  const report = await executor.collectResult(run.runId);

  assert.deepEqual(report.changedFiles, ["allowed/file.txt"]);
  assert.equal(report.artifacts.some((artifact) => artifact.kind === "diff"), true);
  assert.equal(await readFile(path.join(repoRoot, "allowed", "file.txt"), "utf8"), "before\n");
});

test("orchestrator stops clearly when openai_responses executor is requested without a client and fallback is blocked", async () => {
  const repoPath = process.cwd();
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-executor-fallback-"));
  const state = createInitialState({
    id: "executor-blocked",
    repoPath,
    repoName: "bige",
    userGoal: "Use openai executor",
    objective: "Exercise blocked fallback",
    subtasks: ["executor", "workspace", "artifacts", "policy"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["blocked is explicit"],
    autoMode: true,
    approvalMode: "auto",
    executorMode: "openai_responses",
    executionMode: "dry_run",
    executorFallbackMode: "blocked",
  });
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "openai_responses",
    openaiClient: null,
  });
  await dependencies.storage.saveState(state);

  const updated = await runOrchestratorOnce("executor-blocked", dependencies);
  assert.equal(updated.status, "stopped");
  assert.equal(updated.stopReason?.includes("openai_responses executor provider is not configured"), true);
});

test("orchestrator can fall back from openai_responses executor to mock when configured", async () => {
  const repoPath = process.cwd();
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-executor-fallback-mock-"));
  const state = createInitialState({
    id: "executor-fallback-mock",
    repoPath,
    repoName: "bige",
    userGoal: "Fallback executor safely",
    objective: "Use fallback executor",
    subtasks: ["executor", "workspace", "artifacts", "policy"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["fallback uses mock executor"],
    autoMode: true,
    approvalMode: "auto",
    executorMode: "openai_responses",
    executionMode: "dry_run",
    executorFallbackMode: "mock",
  });
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "openai_responses",
    openaiClient: null,
  });
  await dependencies.storage.saveState(state);

  const updated = await runOrchestratorOnce("executor-fallback-mock", dependencies);
  assert.equal(updated.status, "needs_revision");
  assert.equal((updated.lastExecutionReport?.rawExecutorOutput as { provider?: string } | undefined)?.provider, "mock");
});
