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
import { buildSandboxEscalationSummary } from "../../src/sandbox-escalation";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-escalation-summary-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-escalation-summary-v1",
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

test("sandbox escalation summary highlights unresolved recovery incidents and hotspots", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-escalation-summary",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize escalations",
    objective: "sandbox escalation summary",
    subtasks: ["sandbox-escalation-summary"],
    successCriteria: ["hotspots and unresolved incidents are readable"],
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
          targetNumber: 404,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-escalation-summary",
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
    actorSource: "test-sandbox-escalation-summary-preview-1",
  });
  await runSandboxRollback({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    restorePointId: trail.records[0]?.id ?? null,
    mode: "preview",
    actorSource: "test-sandbox-escalation-summary-preview-2",
  });

  const summary = await buildSandboxEscalationSummary({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });
  assert.ok(summary.unresolvedIncidentCount > 0);
  assert.ok(summary.escalationNeededCount > 0);
  assert.ok(summary.repeatedHotSpots.some((item) => item.startsWith("default:")));
  assert.ok(typeof summary.suggestedNextAction === "string");
});

