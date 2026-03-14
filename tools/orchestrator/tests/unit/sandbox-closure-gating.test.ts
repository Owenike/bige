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
import { buildSandboxClosureGatingDecision } from "../../src/sandbox-closure-gating";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closure-gating-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closure-gating-v1",
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

test("sandbox closure gating blocks closure for critical incidents even after mark_resolved", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closure-gating",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Gate sandbox incident closure",
    objective: "closure gating",
    subtasks: ["sandbox-closure-gating"],
    successCriteria: ["critical incidents stay non-closure-ready"],
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
          targetNumber: 505,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-closure-gating",
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

  await runSandboxOperatorAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    incidentId: compareIncident!.id,
    action: "mark_resolved",
    actorSource: "test-sandbox-closure-gating",
    commandSource: "cli",
  });

  const decision = await buildSandboxClosureGatingDecision({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });

  assert.equal(decision.latestIncidentType, "high_risk_compare");
  assert.equal(decision.latestIncidentSeverity, "critical");
  assert.equal(decision.latestOperatorAction, "mark_resolved");
  assert.equal(decision.closureAllowed, false);
  assert.equal(decision.closureStatus, "resolved_not_ready");
  assert.equal(decision.requestReviewRequired, true);
  assert.equal(decision.escalateRequired, true);
  assert.equal(decision.rerunApplyRequired, false);
  assert.ok(decision.blockedReasonCodes.includes("blocked_terminal_incident"));
  assert.ok(decision.blockedReasonCodes.includes("manual_required_terminal_incident"));
  assert.ok(decision.blockedReasonCodes.includes("resolved_without_clearance"));
});
