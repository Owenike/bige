import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState, runLiveAcceptance } from "../../src/orchestrator";

test("live acceptance persists skipped status clearly when OPENAI_API_KEY is missing", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-acceptance-repo-"));
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-acceptance-storage-"));
  const workspaceRoot = path.join(repoRoot, ".workspaces");
  const dependencies = createDefaultDependencies({
    repoPath: repoRoot,
    storageRoot,
    workspaceRoot,
    openaiClient: null,
  });
  const state = createInitialState({
    id: "live-acceptance-state",
    repoPath: repoRoot,
    repoName: "repo",
    userGoal: "Exercise live acceptance gating",
    objective: "Verify live acceptance state persistence",
    subtasks: ["live", "acceptance", "gating", "storage"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["skip is explicit"],
    autoMode: false,
    approvalMode: "human_approval",
    workspaceRoot,
  });
  await dependencies.storage.saveState(state);

  const result = await runLiveAcceptance({
    stateId: "live-acceptance-state",
    dependencies,
    repoPath: repoRoot,
    workspaceRoot,
    enabled: true,
    openaiClient: null,
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason.includes("OPENAI_API_KEY"), true);
  const updated = await dependencies.storage.loadState("live-acceptance-state");
  assert.equal(updated?.liveAcceptanceStatus, "skipped");
  assert.equal(updated?.lastLiveSmokeResult?.status, "skipped");
});

test(
  "live acceptance can run a real provider path when OPENAI_API_KEY is present",
  { skip: !process.env.OPENAI_API_KEY },
  async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-acceptance-real-"));
    const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-acceptance-real-storage-"));
    const workspaceRoot = path.join(repoRoot, ".workspaces");
    const dependencies = createDefaultDependencies({
      repoPath: repoRoot,
      storageRoot,
      workspaceRoot,
    });
    const state = createInitialState({
      id: "live-acceptance-real-state",
      repoPath: repoRoot,
      repoName: "repo",
      userGoal: "Exercise real live acceptance",
      objective: "Verify live acceptance can run with a real key",
      subtasks: ["live", "acceptance", "executor", "artifacts"],
      allowedFiles: ["tools/orchestrator"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["live acceptance runs"],
      autoMode: false,
      approvalMode: "human_approval",
      workspaceRoot,
    });
    await dependencies.storage.saveState(state);

    const result = await runLiveAcceptance({
      stateId: "live-acceptance-real-state",
      dependencies,
      repoPath: repoRoot,
      workspaceRoot,
      enabled: true,
    });

    assert.equal(["passed", "blocked", "failed"].includes(result.status), true);
    assert.equal(Boolean(result.reportPath), true);
    assert.equal(Boolean(result.transcriptSummaryPath), true);
    assert.equal(Boolean(result.toolLogPath), true);
  },
);
