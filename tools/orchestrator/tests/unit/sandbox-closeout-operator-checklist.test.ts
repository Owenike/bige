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
import { buildSandboxCloseoutOperatorChecklist } from "../../src/sandbox-closeout-checklist";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-checklist-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-checklist-v1",
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

test("sandbox closeout checklist is satisfied when closure is already safe", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closeout-checklist-clear",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Check closeout checklist",
    objective: "closeout checklist",
    subtasks: ["sandbox-closeout-operator-checklist"],
    successCriteria: ["clear state stays safe to closeout"],
  });
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });

  const checklist = await buildSandboxCloseoutOperatorChecklist({
    configPath,
    state: initialState,
    loadedRegistry,
    limit: 20,
  });

  assert.equal(checklist.safeToCloseout, true);
  assert.equal(checklist.noEvidenceGaps, true);
  assert.equal(checklist.noGovernanceWarnings, true);
  assert.equal(checklist.items.every((item) => item.satisfied), true);
});

test("sandbox closeout checklist blocks closeout when incident is only marked resolved", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closeout-checklist-blocked",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Check blocked closeout checklist",
    objective: "closeout checklist",
    subtasks: ["sandbox-closeout-operator-checklist"],
    successCriteria: ["resolved metadata is not enough for closeout"],
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
          targetNumber: 606,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-closeout-checklist",
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
    actorSource: "test-sandbox-closeout-checklist",
    commandSource: "cli",
  });

  const checklist = await buildSandboxCloseoutOperatorChecklist({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });

  assert.equal(checklist.safeToCloseout, false);
  assert.equal(checklist.noEvidenceGaps, false);
  assert.ok(checklist.blockedReasonCodes.includes("resolved_without_clearance"));
  assert.ok(checklist.evidenceGapCodes.includes("manual_review_still_required"));
  assert.ok(checklist.recommendedNextStep.length > 0);
});
