import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { listSandboxRestorePoints } from "../../src/sandbox-restore-points";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-restore-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-restore-v1",
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
    id: "sandbox-restore-point",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Create restore points before sandbox apply",
    objective: "persist restore points for sandbox config changes",
    subtasks: ["sandbox-restore-point"],
    successCriteria: ["restore point exists before apply"],
  });
}

test("sandbox apply creates restore point before persisting a real change", async () => {
  const { configPath } = await createSandboxConfig();
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
    actorSource: "test-restore-point",
    applySource: "apply",
  });

  assert.equal(applied.status, "ready");
  assert.ok(applied.restorePointId);

  const restorePoints = await listSandboxRestorePoints({ configPath, limit: 5 });
  assert.equal(restorePoints.records.length, 1);
  assert.equal(restorePoints.records[0]?.id, applied.restorePointId);
  assert.equal(restorePoints.records[0]?.previousProfileSummaries[0]?.targetNumber, 101);
});

test("sandbox apply does not create restore point for no-op change sets", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });

  const applied = await applySandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry,
    proposedRegistry: loadedRegistry.registry,
    actorSource: "test-restore-noop",
    applySource: "apply",
  });

  assert.equal(applied.status, "ready");
  assert.equal(applied.restorePointId, null);

  const restorePoints = await listSandboxRestorePoints({ configPath, limit: 5 });
  assert.equal(restorePoints.records.length, 0);
});
