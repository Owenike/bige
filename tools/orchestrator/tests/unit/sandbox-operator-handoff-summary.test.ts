import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { orchestratorStateSchema } from "../../src/schemas";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { loadSandboxRestorePointTrail, resolveSandboxRestorePointsPath, saveSandboxRestorePointTrail } from "../../src/sandbox-restore-points";
import { runSandboxRollback } from "../../src/sandbox-rollback";
import { buildSandboxOperatorHandoffSummary } from "../../src/sandbox-operator-handoff";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-handoff-summary-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-handoff-summary-v1",
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

test("sandbox operator handoff summary highlights repeated hotspots and next step", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-operator-handoff-summary",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize recovery handoff",
    objective: "handoff summary",
    subtasks: ["sandbox-operator-handoff-summary"],
    successCriteria: ["handoff summary is readable"],
  });
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const applied = await applySandboxRegistryChange({
    configPath,
    state: initialState,
    loadedRegistry,
    proposedRegistry: {
      ...loadedRegistry.registry,
      profiles: {
        ...loadedRegistry.registry.profiles,
        default: {
          ...loadedRegistry.registry.profiles.default,
          targetNumber: 333,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-operator-handoff-summary",
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

  const currentRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const state = orchestratorStateSchema.parse({
    ...initialState,
    lastRestorePointId: trail.records[0]?.id ?? null,
    lastRestorePointSummary: trail.records[0]?.reason ?? null,
  });

  await runSandboxRollback({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    restorePointId: trail.records[0]?.id ?? null,
    mode: "preview",
    actorSource: "test-sandbox-operator-handoff-preview-1",
  });
  await runSandboxRollback({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    restorePointId: trail.records[0]?.id ?? null,
    mode: "preview",
    actorSource: "test-sandbox-operator-handoff-preview-2",
  });

  const summary = await buildSandboxOperatorHandoffSummary({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });
  assert.ok(summary.handoffLine.includes("Sandbox recovery handoff"));
  assert.ok(summary.recommendedNextStep.length > 0);
  assert.ok(summary.governanceWarnings.length > 0);
  assert.ok(summary.escalationRecommendation);
});
