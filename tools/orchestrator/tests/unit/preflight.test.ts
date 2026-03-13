import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createInitialState } from "../../src/orchestrator";
import { runOrchestratorPreflight } from "../../src/preflight";

test("preflight reports missing live and handoff prerequisites with a consistent blocked shape", async () => {
  const state = createInitialState({
    id: "preflight-missing",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Preflight gating",
    objective: "Check missing prerequisites",
    subtasks: ["preflight", "profiles", "diagnostics", "tests"],
    successCriteria: ["preflight blocks unsafe paths"],
    handoffConfig: {
      githubHandoffEnabled: true,
      publishBranch: false,
      createBranch: true,
    },
  });

  const result = await runOrchestratorPreflight({
    repoPath: state.task.repoPath,
    workspaceRoot: path.join(process.cwd(), ".tmp", "preflight-workspace"),
    state,
    env: {},
    toolChecker: async (tool) => tool === "git",
    writableChecker: async () => true,
  });

  assert.equal(result.targets.find((target) => target.target === "live_smoke")?.status, "skipped");
  assert.equal(result.targets.find((target) => target.target === "live_smoke")?.blockedReasons[0]?.code, "missing_openai_api_key");
  assert.equal(result.targets.find((target) => target.target === "github_handoff")?.status, "blocked");
  assert.equal(result.blockedReasons.every((reason) => typeof reason.code === "string" && typeof reason.suggestedNextAction === "string"), true);
  assert.equal(result.missingEnv.includes("OPENAI_API_KEY"), true);
  assert.equal(result.missingEnv.includes("GITHUB_TOKEN/GH_TOKEN"), true);
  assert.equal(result.missingTools.includes("gh"), true);
});

test("preflight can skip live paths when explicitly disabled", async () => {
  const state = createInitialState({
    id: "preflight-disabled",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Preflight skip semantics",
    objective: "Disable live path safely",
    subtasks: ["preflight", "live", "skip", "tests"],
    successCriteria: ["disabled live path skips explicitly"],
  });

  const result = await runOrchestratorPreflight({
    repoPath: state.task.repoPath,
    workspaceRoot: path.join(process.cwd(), ".tmp", "preflight-disabled"),
    state,
    env: { OPENAI_API_KEY: "test-key" },
    toolChecker: async () => true,
    writableChecker: async () => true,
    enabled: false,
  });

  const liveAcceptance = result.targets.find((target) => target.target === "live_acceptance");
  assert.equal(liveAcceptance?.status, "skipped");
  assert.equal(liveAcceptance?.blockedReasons[0]?.code, "disabled_by_configuration");
});
