import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { GhCliStatusReportingAdapter } from "../../src/status-reporting";
import { runLiveAuthOperatorFlow } from "../../src/live-auth-operator";
import type { LoadedGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";

function createState(profileId = "default") {
  const state = createInitialState({
    id: `live-auth-operator-${profileId}`,
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Run a safe live auth operator flow",
    objective: "Precheck, resolve, validate, and optionally execute live auth smoke",
    subtasks: ["live-auth-operator-flow"],
    successCriteria: ["operator flow produces a readable summary"],
  });
  return {
    ...state,
    task: {
      ...state.task,
      profileId,
    },
  };
}

function createRegistry(): LoadedGitHubSandboxTargetRegistry {
  return {
    registry: {
      version: "sandbox-v1",
      defaultProfileId: "default",
      bundles: {},
      governance: {
        allowedRepositories: [],
        allowedTargetTypes: ["issue", "pull_request"],
        allowedActionPolicies: ["create_or_update", "create_only", "update_only"],
        defaultAllowedActionPolicies: ["create_or_update", "create_only"],
      },
      profiles: {
        default: {
          repository: "example/bige",
          targetType: "issue",
          targetNumber: 101,
          actionPolicy: "create_or_update",
          enabled: true,
          bundleId: null,
          overrideFields: [],
          notes: null,
        },
      },
    },
    version: "sandbox-v1",
    source: "file",
    path: "sandbox-targets.json",
  };
}

test("live auth operator flow precheck resolves default sandbox target and reports readiness", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-auth-precheck-"));
  const execFileImpl = async (_file: string, args: readonly string[]) => {
    if (args[0] === "--version") {
      return { stdout: "gh version 2.0.0", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/101") {
      return { stdout: JSON.stringify({ number: 101 }), stderr: "" };
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };

  const result = await runLiveAuthOperatorFlow({
    state: createState(),
    outputRoot,
    adapter: new GhCliStatusReportingAdapter({
      enabled: true,
      token: "token",
      execFileImpl,
    }),
    enabled: true,
    token: "token",
    sandboxRegistry: createRegistry(),
    execute: false,
    execFileImpl,
  });

  assert.equal(result.readinessStatus, "ready");
  assert.equal(result.selectedSandboxProfileId, "default");
  assert.equal(result.sandboxProfileSelectionMode, "default");
  assert.match(result.summaryText, /Selected sandbox profile: default \/ mode=default/);
  assert.equal(result.state.selectedSandboxProfileId, "default");
  assert.equal(result.state.sandboxProfileSelectionMode, "default");
  assert.equal(result.state.lastLiveSmokeTarget?.targetNumber, 101);
});

test("live auth operator flow blocks early when no safe sandbox profile exists", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-auth-blocked-"));
  const result = await runLiveAuthOperatorFlow({
    state: createState("missing"),
    outputRoot,
    adapter: new GhCliStatusReportingAdapter({
      enabled: true,
      token: "token",
      execFileImpl: async () => ({ stdout: "gh version 2.0.0", stderr: "" }),
    }),
    enabled: true,
    token: "token",
    sandboxRegistry: {
      registry: {
        version: "empty-v1",
        defaultProfileId: null,
        bundles: {},
        governance: {
          allowedRepositories: [],
          allowedTargetTypes: ["issue", "pull_request"],
          allowedActionPolicies: ["create_or_update", "create_only", "update_only"],
          defaultAllowedActionPolicies: ["create_or_update", "create_only"],
        },
        profiles: {},
      },
      version: "empty-v1",
      source: "default",
      path: null,
    },
    execute: false,
  });

  assert.equal(result.readinessStatus, "manual_required");
  assert.equal(result.selectedSandboxProfileId, null);
  assert.equal(result.sandboxProfileSelectionMode, "blocked");
  assert.match(result.summaryText, /No enabled sandbox profile matched/);
  assert.equal(result.state.sandboxProfileSelectionMode, "blocked");
});
