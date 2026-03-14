import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { querySandboxHistory } from "../../src/sandbox-history";
import { runSandboxRollback } from "../../src/sandbox-rollback";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-history-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-history-v1",
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
    id: "sandbox-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Inspect sandbox recovery history",
    objective: "query restore point and rollback history",
    subtasks: ["sandbox-history"],
    successCriteria: ["history is queryable"],
  });
}

test("sandbox history reports restore point and rollback entries", async () => {
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
    actorSource: "test-history-apply",
    applySource: "apply",
  });
  assert.equal(applied.status, "ready");
  const changedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  await runSandboxRollback({
    configPath,
    state,
    loadedRegistry: changedRegistry,
    restorePointId: applied.restorePointId ?? null,
    mode: "preview",
    actorSource: "test-history-rollback",
  });

  const allHistory = await querySandboxHistory({ configPath, kind: "all", limit: 10 });
  const rollbackHistory = await querySandboxHistory({ configPath, kind: "rollback", limit: 10 });
  assert.ok(allHistory.entries.some((entry) => entry.kind === "restore_point"));
  assert.ok(rollbackHistory.entries.some((entry) => entry.kind === "rollback"));
});
