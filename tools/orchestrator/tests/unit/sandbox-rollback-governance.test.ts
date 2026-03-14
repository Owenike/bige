import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { evaluateSandboxRollbackGovernance } from "../../src/sandbox-rollback-governance";
import { loadSandboxRestorePointTrail, resolveSandboxRestorePointsPath, saveSandboxRestorePointTrail } from "../../src/sandbox-restore-points";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-rollback-gov-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-rollback-gov-v1",
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
    id: "sandbox-rollback-governance",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Govern rollback safely",
    objective: "validate sandbox restore points before rollback",
    subtasks: ["sandbox-rollback-governance"],
    successCriteria: ["unsafe restore points are blocked"],
  });
}

test("sandbox rollback governance requires an existing restore point", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const decision = await evaluateSandboxRollbackGovernance({
    configPath,
    state: createState(),
    loadedRegistry,
    restorePoint: null,
    actorSource: "test-rollback-governance-missing",
  });
  assert.equal(decision.status, "manual_required");
  assert.equal(decision.reason?.code, "sandbox_restore_point_missing");
});

test("sandbox rollback governance blocks stale restore points", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const proposedRegistry = {
    ...loadedRegistry.registry,
    profiles: {
      ...loadedRegistry.registry.profiles,
      default: {
        ...loadedRegistry.registry.profiles.default,
        targetNumber: 202,
        overrideFields: ["targetNumber"],
      },
    },
  };
  const applied = await applySandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry,
    proposedRegistry,
    actorSource: "test-rollback-governance-stale",
    applySource: "apply",
  });
  assert.equal(applied.status, "ready");
  const restorePath = resolveSandboxRestorePointsPath(configPath);
  const trail = await loadSandboxRestorePointTrail(restorePath);
  trail.records[0] = {
    ...trail.records[0],
    createdAt: "2000-01-01T00:00:00.000Z",
    id: "sandbox-restore:2000-01-01T00:00:00.000Z:apply",
  };
  await saveSandboxRestorePointTrail(restorePath, trail);
  const reloadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const decision = await evaluateSandboxRollbackGovernance({
    configPath,
    state: createState(),
    loadedRegistry: reloadedRegistry,
    restorePoint: trail.records[0],
    actorSource: "test-rollback-governance-stale",
    maxAgeHours: 1,
  });
  assert.equal(decision.status, "manual_required");
  assert.equal(decision.reason?.code, "sandbox_restore_point_expired");
});

test("sandbox rollback governance blocks restore points that would make default profile unsafe", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const decision = await evaluateSandboxRollbackGovernance({
    configPath,
    state: createState(),
    loadedRegistry,
    restorePoint: {
      id: "sandbox-restore:unsafe:apply",
      createdAt: new Date().toISOString(),
      source: "apply",
      reason: "test",
      affectedProfileIds: ["default"],
      previousDefaultProfileId: "default",
      previousProfileSummaries: [],
      previousRegistry: {
        ...loadedRegistry.registry,
        governance: {
          ...loadedRegistry.registry.governance,
          defaultAllowedActionPolicies: ["create_only"],
        },
        profiles: {
          ...loadedRegistry.registry.profiles,
          default: {
            ...loadedRegistry.registry.profiles.default,
            actionPolicy: "update_only",
          },
        },
      },
      diffSummary: ["Switch default sandbox profile action policy back to update_only."],
    },
    actorSource: "test-rollback-governance-unsafe-default",
  });
  assert.equal(decision.status, "manual_required");
  assert.equal(decision.reason?.code, "sandbox_default_profile_not_safe");
});
