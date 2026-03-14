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
import { runSandboxOperatorAction } from "../../src/sandbox-operator-actions";
import { buildSandboxGovernanceStatus } from "../../src/sandbox-governance-status";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-governance-status-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-governance-status-v1",
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

test("sandbox governance status summarizes latest unresolved incident and operator action", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-governance-status",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize sandbox governance status",
    objective: "governance summary",
    subtasks: ["sandbox-governance-status"],
    successCriteria: ["governance summary is operator-readable"],
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
          targetNumber: 909,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-governance-status",
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

  const action = await runSandboxOperatorAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    incidentId: compareIncident!.id,
    action: "acknowledge",
    actorSource: "test-governance-status",
    commandSource: "cli",
  });
  assert.equal(action.status, "accepted");

  const governance = await buildSandboxGovernanceStatus({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });
  assert.equal(governance.latestIncidentType, "high_risk_compare");
  assert.equal(governance.latestIncidentSeverity, "critical");
  assert.equal(governance.latestOperatorAction, "acknowledge");
  assert.equal(governance.latestOperatorActionStatus, "accepted");
  assert.equal(governance.recommendedAction, "escalate");
  assert.equal(governance.applyBlocked, true);
  assert.equal(governance.operatorHandoffRecommended, true);
});
