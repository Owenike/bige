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
import { buildSandboxResolutionEvidenceSummary } from "../../src/sandbox-resolution-evidence";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-resolution-evidence-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-resolution-evidence-v1",
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

test("sandbox resolution evidence summary centralizes closure gaps for unresolved critical incidents", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-resolution-evidence",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize resolution evidence",
    objective: "resolution evidence summary",
    subtasks: ["sandbox-resolution-evidence-summary"],
    successCriteria: ["closure evidence is centralized"],
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
    actorSource: "test-sandbox-resolution-evidence",
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
    action: "mark_resolved",
    actorSource: "test-sandbox-resolution-evidence",
    commandSource: "cli",
  });
  assert.equal(action.status, "accepted");

  const summary = await buildSandboxResolutionEvidenceSummary({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });

  assert.equal(summary.latestIncidentType, "high_risk_compare");
  assert.equal(summary.latestIncidentSeverity, "critical");
  assert.equal(summary.latestOperatorAction, "mark_resolved");
  assert.equal(summary.latestOperatorActionStatus, "accepted");
  assert.ok(summary.latestOperatorActionTrailSummary?.includes("mark_resolved"));
  assert.equal(summary.rerunEvidenceExists, false);
  assert.equal(summary.validationEvidenceExists, false);
  assert.equal(summary.applyEvidenceExists, false);
  assert.ok(summary.evidenceGapCodes.includes("manual_review_still_required"));
  assert.ok(summary.evidenceGapCodes.includes("escalate_missing"));
  assert.ok(summary.evidenceGapCodes.includes("mark_resolved_without_clearance"));
  assert.equal(summary.closureConfidence, "low");
  assert.ok(summary.recommendedEvidenceToCollectNext.includes("escalate"));
  assert.ok(summary.recommendedEvidenceToCollectNext.includes("closure_check"));
});
