import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry, resolveGitHubSandboxTarget } from "../../src/github-sandbox-targets";

function createState(profileId = "default") {
  const state = createInitialState({
    id: `github-sandbox-targets-${profileId}`,
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Resolve a safe GitHub sandbox target",
    objective: "Use only configured live auth smoke targets",
    subtasks: ["github-sandbox-targets"],
    successCriteria: ["safe sandbox target resolution is explicit"],
  });
  return {
    ...state,
    task: {
      ...state.task,
      profileId,
    },
  };
}

async function createRegistry() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-github-sandbox-targets-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-v1",
        defaultProfileId: "default",
        profiles: {
          default: {
            repository: "example/bige",
            targetType: "issue",
            targetNumber: 101,
            actionPolicy: "create_or_update",
            enabled: true,
            notes: null,
          },
          release: {
            repository: "example/bige",
            targetType: "pull_request",
            targetNumber: 202,
            actionPolicy: "update_only",
            enabled: true,
            notes: null,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return loadGitHubSandboxTargetRegistry({ configPath });
}

test("github sandbox target registry resolves the default target", async () => {
  const registry = await createRegistry();
  const resolved = resolveGitHubSandboxTarget({
    state: createState(),
    loadedRegistry: registry,
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.profileId, "default");
  assert.equal(resolved.requestedTarget?.repository, "example/bige");
  assert.equal(resolved.requestedTarget?.targetNumber, 101);
});

test("github sandbox target registry resolves a profile-specific target", async () => {
  const registry = await createRegistry();
  const resolved = resolveGitHubSandboxTarget({
    state: createState("release"),
    loadedRegistry: registry,
    requestedProfileId: "release",
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.profileId, "release");
  assert.equal(resolved.requestedTarget?.targetType, "pull_request");
  assert.equal(resolved.actionPolicy, "update_only");
});

test("github sandbox target registry allows an explicit override", async () => {
  const registry = await createRegistry();
  const resolved = resolveGitHubSandboxTarget({
    state: createState(),
    loadedRegistry: registry,
    requestedTarget: {
      repository: "example/bige",
      targetType: "issue",
      targetNumber: 303,
      allowCorrelatedReuse: false,
    },
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.configSource, "explicit_override");
  assert.equal(resolved.requestedTarget?.targetNumber, 303);
});

test("github sandbox target registry returns manual_required when no safe target exists", () => {
  const resolved = resolveGitHubSandboxTarget({
    state: createState("missing-profile"),
    loadedRegistry: {
      registry: {
        version: "empty-v1",
        defaultProfileId: null,
        profiles: {},
      },
      version: "empty-v1",
      source: "default",
      path: null,
    },
  });

  assert.equal(resolved.status, "manual_required");
  assert.equal(resolved.failureReason, "github_auth_smoke_missing_sandbox_target_profile");
});
