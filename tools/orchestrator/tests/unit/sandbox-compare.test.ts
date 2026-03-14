import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { compareSandboxRestorePoints } from "../../src/sandbox-compare";
import { listSandboxRestorePoints } from "../../src/sandbox-restore-points";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-compare-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-compare-v1",
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
    id: "sandbox-compare",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Compare restore points safely",
    objective: "show readable sandbox diffs",
    subtasks: ["sandbox-compare"],
    successCriteria: ["restore point compare produces readable summary"],
  });
}

test("sandbox compare supports current config vs restore point and restore point vs restore point", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createState();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const appliedA = await applySandboxRegistryChange({
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
    actorSource: "test-compare-a",
    applySource: "apply",
  });
  assert.equal(appliedA.status, "ready");
  const afterA = await loadGitHubSandboxTargetRegistry({ configPath });
  const appliedB = await applySandboxRegistryChange({
    configPath,
    state,
    loadedRegistry: afterA,
    proposedRegistry: {
      ...afterA.registry,
      profiles: {
        ...afterA.registry.profiles,
        default: {
          ...afterA.registry.profiles.default,
          targetNumber: 333,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-compare-b",
    applySource: "apply",
  });
  assert.equal(appliedB.status, "ready");
  const currentRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const restorePoints = await listSandboxRestorePoints({ configPath, limit: 10 });

  const currentVsRestore = await compareSandboxRestorePoints({
    configPath,
    loadedRegistry: currentRegistry,
    restorePointId: appliedB.restorePointId ?? null,
  });
  assert.equal(currentVsRestore.status, "ready");
  assert.equal(currentVsRestore.mode, "current_vs_restore_point");
  assert.ok(currentVsRestore.impactSummary.profileCount >= 1);

  const restoreVsRestore = await compareSandboxRestorePoints({
    configPath,
    loadedRegistry: currentRegistry,
    restorePointId: restorePoints.records[1]?.id ?? null,
    compareRestorePointId: restorePoints.records[0]?.id ?? null,
  });
  assert.equal(restoreVsRestore.status, "ready");
  assert.equal(restoreVsRestore.mode, "restore_point_vs_restore_point");
  assert.ok(Array.isArray(restoreVsRestore.diffSummary));
});
