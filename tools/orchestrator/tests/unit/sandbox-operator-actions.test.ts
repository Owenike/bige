import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { orchestratorStateSchema } from "../../src/schemas";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { classifySandboxRecoveryIncidents } from "../../src/sandbox-incident-governance";
import { loadSandboxRestorePointTrail, resolveSandboxRestorePointsPath, saveSandboxRestorePointTrail } from "../../src/sandbox-restore-points";
import { listSandboxOperatorActions, runSandboxOperatorAction } from "../../src/sandbox-operator-actions";
import { runSandboxRollback } from "../../src/sandbox-rollback";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-operator-actions-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-operator-actions-v1",
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

test("sandbox operator actions support acknowledge, rejected escalation, and gated rerun preview", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-operator-actions",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Take operator actions on recovery incidents",
    objective: "sandbox operator actions",
    subtasks: ["sandbox-operator-actions"],
    successCriteria: ["action flow is recorded"],
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
          targetNumber: 303,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-operator-actions",
    applySource: "apply",
  });
  assert.equal(applied.status, "ready");

  const currentRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const state = orchestratorStateSchema.parse({
    ...initialState,
    lastRestorePointId: applied.restorePointId,
    lastRestorePointSummary: applied.restorePointSummary,
  });
  const incidents = await classifySandboxRecoveryIncidents({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });
  const compareIncident = incidents.incidents.find((incident) => incident.type === "high_risk_compare");
  assert.ok(compareIncident);

  const acknowledged = await runSandboxOperatorAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    incidentId: compareIncident!.id,
    action: "acknowledge",
    actorSource: "test-acknowledge",
    commandSource: "cli",
  });
  assert.equal(acknowledged.status, "accepted");

  const previewResult = await runSandboxRollback({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    restorePointId: applied.restorePointId,
    mode: "preview",
    actorSource: "test-sandbox-operator-actions-preview",
    commandSource: "cli",
  });
  assert.equal(previewResult.status, "previewed");

  const refreshedIncidents = await classifySandboxRecoveryIncidents({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });
  const infoIncident = refreshedIncidents.incidents.find((incident) => incident.type === "recovery_observed" && incident.severity === "info");
  assert.ok(infoIncident);

  const escalateInfo = await runSandboxOperatorAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    incidentId: infoIncident!.id,
    action: "escalate",
    actorSource: "test-escalate-info",
    commandSource: "cli",
  });
  assert.equal(escalateInfo.status, "rejected");

  const restorePath = resolveSandboxRestorePointsPath(configPath);
  const trail = await loadSandboxRestorePointTrail(restorePath);
  trail.records[0] = {
    ...trail.records[0],
    createdAt: "2000-01-01T00:00:00.000Z",
    id: "sandbox-restore:2000-01-01T00:00:00.000Z:apply",
  };
  await saveSandboxRestorePointTrail(restorePath, trail);

  const expiredIncidents = await classifySandboxRecoveryIncidents({
    configPath,
    state: orchestratorStateSchema.parse({
      ...state,
      lastRestorePointId: trail.records[0]?.id ?? null,
    }),
    loadedRegistry: currentRegistry,
    limit: 20,
  });
  const expiredIncident = expiredIncidents.incidents.find((incident) => incident.type === "restore_point_expired");
  assert.ok(expiredIncident);

  const rerunPreview = await runSandboxOperatorAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    incidentId: expiredIncident!.id,
    action: "rerun_preview",
    actorSource: "test-rerun-preview",
    commandSource: "cli",
  });
  assert.equal(rerunPreview.status, "manual_required");

  const actions = await listSandboxOperatorActions({
    configPath,
    limit: 10,
  });
  assert.ok(actions.records.length >= 3);
});
