import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { listSandboxRestorePoints, loadSandboxRestorePointTrail, resolveSandboxRestorePointsPath, saveSandboxRestorePointTrail } from "../../src/sandbox-restore-points";
import { runSandboxBatchRecovery } from "../../src/sandbox-batch-recovery";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-batch-recovery-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-batch-recovery-v1",
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
          review: {
            repository: "example/bige",
            targetType: "issue",
            targetNumber: 202,
            actionPolicy: "create_only",
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
    id: "sandbox-batch-recovery",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Recover multiple sandbox profiles safely",
    objective: "preview validate and apply sandbox batch recovery",
    subtasks: ["sandbox-batch-recovery"],
    successCriteria: ["batch recovery restores the expected targets"],
  });
}

async function seedRestorePoints(configPath: string) {
  const first = await loadGitHubSandboxTargetRegistry({ configPath });
  const appliedDefault = await applySandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry: first,
    proposedRegistry: {
      ...first.registry,
      profiles: {
        ...first.registry.profiles,
        default: {
          ...first.registry.profiles.default,
          targetNumber: 303,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-batch-recovery-default",
    applySource: "apply",
  });
  assert.equal(appliedDefault.status, "ready");
  const second = await loadGitHubSandboxTargetRegistry({ configPath });
  const appliedReview = await applySandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry: second,
    proposedRegistry: {
      ...second.registry,
      profiles: {
        ...second.registry.profiles,
        review: {
          ...second.registry.profiles.review,
          targetNumber: 404,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-batch-recovery-review",
    applySource: "apply",
  });
  assert.equal(appliedReview.status, "ready");
  return loadGitHubSandboxTargetRegistry({ configPath });
}

test("sandbox batch recovery previews validates and applies selected profiles", async () => {
  const { configPath } = await createSandboxConfig();
  const changedRegistry = await seedRestorePoints(configPath);
  const state = createState();

  const preview = await runSandboxBatchRecovery({
    configPath,
    state,
    loadedRegistry: changedRegistry,
    profileIds: ["default", "review"],
    mode: "preview",
    actorSource: "test-batch-recovery-preview",
  });
  assert.equal(preview.status, "previewed");

  const validate = await runSandboxBatchRecovery({
    configPath,
    state,
    loadedRegistry: changedRegistry,
    profileIds: ["default", "review"],
    mode: "validate",
    actorSource: "test-batch-recovery-validate",
  });
  assert.equal(validate.status, "validated");

  const applied = await runSandboxBatchRecovery({
    configPath,
    state,
    loadedRegistry: changedRegistry,
    profileIds: ["default", "review"],
    mode: "apply",
    actorSource: "test-batch-recovery-apply",
  });
  assert.equal(applied.status, "restored");
  assert.equal(applied.appliedRegistry?.profiles.default?.targetNumber, 101);
  assert.equal(applied.appliedRegistry?.profiles.review?.targetNumber, 202);
});

test("sandbox batch recovery returns partial restore when a selected restore point is stale and allowPartial is enabled", async () => {
  const { configPath } = await createSandboxConfig();
  const changedRegistry = await seedRestorePoints(configPath);
  const restorePath = resolveSandboxRestorePointsPath(configPath);
  const trail = await loadSandboxRestorePointTrail(restorePath);
  trail.records[0] = {
    ...trail.records[0],
    createdAt: "2000-01-01T00:00:00.000Z",
    id: "sandbox-restore:2000-01-01T00:00:00.000Z:apply",
  };
  await saveSandboxRestorePointTrail(restorePath, trail);

  const result = await runSandboxBatchRecovery({
    configPath,
    state: createState(),
    loadedRegistry: changedRegistry,
    restorePointIds: trail.records.map((record) => record.id),
    mode: "apply",
    allowPartial: true,
    actorSource: "test-batch-recovery-partial",
  });

  assert.equal(result.status, "partially_restored");
  assert.ok(result.manualRequiredProfileIds.length > 0);
});
