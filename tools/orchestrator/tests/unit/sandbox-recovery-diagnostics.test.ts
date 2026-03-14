import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { buildSandboxRecoveryDiagnostics } from "../../src/sandbox-recovery-diagnostics";
import { loadSandboxRestorePointTrail, resolveSandboxRestorePointsPath, saveSandboxRestorePointTrail } from "../../src/sandbox-restore-points";
import { runSandboxRollback } from "../../src/sandbox-rollback";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-recovery-diagnostics-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-recovery-diagnostics-v1",
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
    id: "sandbox-recovery-diagnostics",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Understand recovery incidents",
    objective: "summarize rollback and restore point health",
    subtasks: ["sandbox-recovery-diagnostics"],
    successCriteria: ["incident summary points to blocked hotspots"],
  });
}

test("sandbox recovery diagnostics summarize incidents, expired restore points, and next action", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createState();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const applied = await applySandboxRegistryChange({
    configPath,
    state,
    loadedRegistry,
    proposedRegistry: {
      ...loadedRegistry.registry,
      profiles: {
        ...loadedRegistry.registry.profiles,
        default: {
          ...loadedRegistry.registry.profiles.default,
          targetNumber: 222,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-recovery-diagnostics-apply",
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

  const changedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  await runSandboxRollback({
    configPath,
    state,
    loadedRegistry: changedRegistry,
    restorePointId: trail.records[0]?.id ?? null,
    mode: "preview",
    actorSource: "test-recovery-diagnostics-rollback",
  });

  const diagnostics = await buildSandboxRecoveryDiagnostics({
    configPath,
    state,
    limit: 10,
  });
  assert.ok(diagnostics.validRestorePointCount <= diagnostics.totalRestorePointCount);
  assert.ok(diagnostics.expiredRestorePointIds.includes(trail.records[0]?.id ?? ""));
  assert.ok(Array.isArray(diagnostics.recentIncidentSummaries));
  assert.ok(typeof diagnostics.suggestedNextAction === "string");
});
