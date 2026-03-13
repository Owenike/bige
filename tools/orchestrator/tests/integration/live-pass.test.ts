import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState, runLivePass } from "../../src/orchestrator";

test("live pass persists skipped status clearly when OPENAI_API_KEY is missing", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-pass-repo-"));
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-pass-storage-"));
  const workspaceRoot = path.join(repoRoot, ".workspaces");
  const dependencies = createDefaultDependencies({
    repoPath: repoRoot,
    storageRoot,
    workspaceRoot,
    openaiClient: null,
  });
  const state = createInitialState({
    id: "live-pass-state",
    repoPath: repoRoot,
    repoName: "repo",
    userGoal: "Exercise live pass gating",
    objective: "Verify live pass state persistence",
    subtasks: ["live", "pass", "gating", "storage"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["skip is explicit"],
    autoMode: false,
    approvalMode: "human_approval",
    workspaceRoot,
  });
  await dependencies.storage.saveState(state);

  const result = await runLivePass({
    stateId: "live-pass-state",
    dependencies,
    repoPath: repoRoot,
    workspaceRoot,
    enabled: true,
    openaiClient: null,
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason.includes("OPENAI_API_KEY"), true);
  assert.equal(result.provider, "openai_responses");
  const updated = await dependencies.storage.loadState("live-pass-state");
  assert.equal(updated?.livePassStatus, "skipped");
  assert.equal(updated?.lastLiveAcceptanceResult?.status, "skipped");
});

test(
  "live pass can run a real provider path when OPENAI_API_KEY is present",
  { skip: !process.env.OPENAI_API_KEY },
  async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-pass-real-"));
    const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-pass-real-storage-"));
    const workspaceRoot = path.join(repoRoot, ".workspaces");
    const dependencies = createDefaultDependencies({
      repoPath: repoRoot,
      storageRoot,
      workspaceRoot,
    });
    const state = createInitialState({
      id: "live-pass-real-state",
      repoPath: repoRoot,
      repoName: "repo",
      userGoal: "Exercise real live pass",
      objective: "Verify live pass can run with a real key",
      subtasks: ["live", "pass", "executor", "artifacts"],
      allowedFiles: ["tools/orchestrator"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["live pass runs"],
      autoMode: false,
      approvalMode: "human_approval",
      workspaceRoot,
    });
    await dependencies.storage.saveState(state);

    const result = await runLivePass({
      stateId: "live-pass-real-state",
      dependencies,
      repoPath: repoRoot,
      workspaceRoot,
      enabled: true,
    });

    assert.equal(["passed", "blocked", "failed"].includes(result.status), true);
    assert.equal(result.provider, "openai_responses");
    assert.equal(Boolean(result.reportPath), true);
    assert.equal(Boolean(result.transcriptSummaryPath), true);
    const updated = await dependencies.storage.loadState("live-pass-real-state");
    assert.equal(updated?.livePassStatus, result.status);
  },
);
