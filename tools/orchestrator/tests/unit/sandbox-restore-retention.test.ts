import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { appendSandboxAuditRecord } from "../../src/sandbox-audit";
import { loadSandboxRestorePointTrail, resolveSandboxRestorePointsPath, saveSandboxRestorePointTrail } from "../../src/sandbox-restore-points";
import { pruneSandboxRestorePoints } from "../../src/sandbox-restore-retention";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-restore-retention-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-restore-retention-v1",
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
    id: "sandbox-restore-retention",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Retain the right restore points",
    objective: "prune expired restore points without deleting referenced records",
    subtasks: ["sandbox-restore-retention"],
    successCriteria: ["expired restore points are pruned safely"],
  });
}

async function createRestorePoint(configPath: string, targetNumber: number, actorSource: string) {
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const applied = await applySandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry,
    proposedRegistry: {
      ...loadedRegistry.registry,
      profiles: {
        ...loadedRegistry.registry.profiles,
        default: {
          ...loadedRegistry.registry.profiles.default,
          targetNumber,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource,
    applySource: "apply",
  });
  assert.equal(applied.status, "ready");
}

test("sandbox restore retention keeps recent and referenced restore points while pruning expired ones", async () => {
  const { configPath } = await createSandboxConfig();
  await createRestorePoint(configPath, 201, "test-retention-1");
  await createRestorePoint(configPath, 202, "test-retention-2");
  await createRestorePoint(configPath, 203, "test-retention-3");

  const restorePath = resolveSandboxRestorePointsPath(configPath);
  const trail = await loadSandboxRestorePointTrail(restorePath);
  trail.records = trail.records.map((record, index) => ({
    ...record,
    createdAt: index < 2 ? "2000-01-01T00:00:00.000Z" : new Date().toISOString(),
    id: index < 2 ? `sandbox-restore:2000-01-01T00:00:00.000Z:${index}` : record.id,
  }));
  await saveSandboxRestorePointTrail(restorePath, trail);

  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  await appendSandboxAuditRecord({
    configPath,
    action: "rollback-preview",
    profileId: null,
    previousRegistry: loadedRegistry.registry,
    nextRegistry: loadedRegistry.registry,
    actorSource: "test-retention-audit",
    restorePointId: trail.records[0]?.id ?? null,
    rollbackMode: "preview",
    decision: "previewed",
    diffSummary: [],
  });

  const result = await pruneSandboxRestorePoints({
    configPath,
    state: createState(),
    retainRecent: 1,
    maxAgeHours: 1,
  });

  assert.equal(result.status, "pruned");
  assert.ok(result.prunedRestorePointIds.length >= 1);
  assert.ok(result.protectedRestorePointIds.includes(trail.records[0]?.id ?? ""));
});
