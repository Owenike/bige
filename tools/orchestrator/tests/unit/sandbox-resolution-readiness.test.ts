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
import { buildSandboxResolutionReadiness } from "../../src/sandbox-resolution-readiness";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-resolution-readiness-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-resolution-readiness-v1",
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

test("sandbox resolution readiness is closure-ready when no unresolved recovery incident remains", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-resolution-readiness-clear",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Check closure readiness",
    objective: "resolution readiness",
    subtasks: ["sandbox-resolution-readiness"],
    successCriteria: ["clear state is closure-ready"],
  });
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });

  const readiness = await buildSandboxResolutionReadiness({
    configPath,
    state: initialState,
    loadedRegistry,
    limit: 20,
  });

  assert.equal(readiness.closureAllowed, true);
  assert.equal(readiness.readinessStatus, "closure_ready");
  assert.equal(readiness.readinessConfidence, "high");
  assert.equal(readiness.unresolvedIncidentsRemain, false);
  assert.equal(readiness.escalationStillNeeded, false);
  assert.equal(readiness.manualReviewStillRequired, false);
});

test("sandbox resolution readiness stays not-closure-ready when incident was only marked resolved", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-resolution-readiness-blocked",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Check blocked closure readiness",
    objective: "resolution readiness",
    subtasks: ["sandbox-resolution-readiness"],
    successCriteria: ["resolved metadata alone is not enough"],
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
          targetNumber: 818,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-resolution-readiness",
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
    actorSource: "test-sandbox-resolution-readiness",
    commandSource: "cli",
  });

  const readiness = await buildSandboxResolutionReadiness({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });

  assert.equal(readiness.closureAllowed, false);
  assert.equal(readiness.readinessStatus, "resolved_not_ready");
  assert.equal(readiness.readinessConfidence, "low");
  assert.equal(readiness.manualReviewStillRequired, true);
  assert.ok(readiness.closureBlockedReasonCodes.includes("resolved_without_clearance"));
  assert.ok(readiness.closureBlockedReasons.length > 0);
  assert.ok(readiness.recommendedNextStepBeforeClosure.length > 0);
});
