import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { runSandboxRollback } from "../../src/sandbox-rollback";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-rollback-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-rollback-v1",
        defaultProfileId: "default",
        bundles: {},
        governance: {
          allowedRepositories: ["example/bige"],
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
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { configPath };
}

function createState() {
  return createInitialState({
    id: "sandbox-rollback",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Rollback sandbox changes safely",
    objective: "preview validate and apply sandbox rollback",
    subtasks: ["sandbox-rollback"],
    successCriteria: ["rollback restores previous target safely"],
  });
}

async function createAppliedRegistry(configPath: string) {
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const proposedRegistry = {
    ...loadedRegistry.registry,
    profiles: {
      ...loadedRegistry.registry.profiles,
      default: {
        ...loadedRegistry.registry.profiles.default,
        targetNumber: 303,
        overrideFields: ["targetNumber"],
      },
    },
  };
  const applied = await applySandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry,
    proposedRegistry,
    actorSource: "test-rollback-setup",
    applySource: "apply",
  });
  assert.equal(applied.status, "ready");
  assert.ok(applied.restorePointId);
  const changedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  return {
    restorePointId: applied.restorePointId,
    loadedRegistry: changedRegistry,
  };
}

test("sandbox rollback preview validate and apply restore the previous profile state", async () => {
  const { configPath } = await createSandboxConfig();
  const { restorePointId, loadedRegistry } = await createAppliedRegistry(configPath);
  const state = createState();

  const preview = await runSandboxRollback({
    configPath,
    state,
    loadedRegistry,
    restorePointId,
    mode: "preview",
    actorSource: "test-rollback-preview",
  });
  assert.equal(preview.status, "previewed");
  assert.match(preview.summary, /rollback preview/i);

  const validate = await runSandboxRollback({
    configPath,
    state,
    loadedRegistry,
    restorePointId,
    mode: "validate",
    actorSource: "test-rollback-validate",
  });
  assert.equal(validate.status, "validated");

  const applied = await runSandboxRollback({
    configPath,
    state,
    loadedRegistry,
    restorePointId,
    mode: "apply",
    actorSource: "test-rollback-apply",
  });
  assert.equal(applied.status, "restored");
  assert.equal(applied.appliedRegistry?.profiles.default?.targetNumber, 101);
});

test("sandbox rollback blocks when no restore point exists", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const result = await runSandboxRollback({
    configPath,
    state: createState(),
    loadedRegistry,
    mode: "preview",
    actorSource: "test-rollback-missing",
  });

  assert.equal(result.status, "manual_required");
  assert.equal(result.failureReason, "sandbox_restore_point_missing");
});

test("sandbox rollback returns no_op when current registry already matches the restore point", async () => {
  const { configPath } = await createSandboxConfig();
  const { restorePointId, loadedRegistry } = await createAppliedRegistry(configPath);
  const restored = await runSandboxRollback({
    configPath,
    state: createState(),
    loadedRegistry,
    restorePointId,
    mode: "apply",
    actorSource: "test-rollback-apply-first",
  });
  assert.equal(restored.status, "restored");

  const reloadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const result = await runSandboxRollback({
    configPath,
    state: createState(),
    loadedRegistry: reloadedRegistry,
    restorePointId,
    mode: "apply",
    actorSource: "test-rollback-noop",
  });

  assert.equal(result.status, "no_op");
});
