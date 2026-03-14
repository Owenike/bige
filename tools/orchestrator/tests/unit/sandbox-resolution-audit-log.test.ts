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
import { buildSandboxResolutionReadiness } from "../../src/sandbox-resolution-readiness";
import { buildSandboxClosureGatingDecision } from "../../src/sandbox-closure-gating";
import { appendSandboxResolutionAuditLog, listSandboxResolutionAuditLogs } from "../../src/sandbox-resolution-audit";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-resolution-audit-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-resolution-audit-v1",
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

test("sandbox resolution audit log stores evidence, readiness, and gating snapshots for closeout checks", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-resolution-audit-log",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Record closeout audit evidence",
    objective: "resolution audit log",
    subtasks: ["sandbox-resolution-audit-log"],
    successCriteria: ["closeout audit captures centralized snapshots"],
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
          targetNumber: 808,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-resolution-audit",
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
    actorSource: "test-sandbox-resolution-audit",
    commandSource: "sandbox:incident:closure-check",
  });
  assert.equal(action.status, "accepted");

  const evidence = await buildSandboxResolutionEvidenceSummary({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });
  const readiness = await buildSandboxResolutionReadiness({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });
  const gating = await buildSandboxClosureGatingDecision({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });

  const audit = await appendSandboxResolutionAuditLog({
    configPath,
    actorSource: "test-sandbox-resolution-audit",
    commandSource: "sandbox:incident:closure-check",
    resolutionEvidenceSnapshot: evidence,
    closureGatingDecisionSnapshot: gating,
    resolutionReadinessSnapshot: readiness,
  });
  const trail = await listSandboxResolutionAuditLogs({
    configPath,
    limit: 5,
  });

  assert.equal(audit.closeoutDecision, gating.closureStatus);
  assert.equal(audit.latestIncidentType, readiness.latestIncidentType);
  assert.equal(audit.latestOperatorAction, readiness.latestOperatorAction);
  assert.equal(audit.resolutionEvidenceSnapshot.summary, evidence.summary);
  assert.equal(audit.closureGatingDecisionSnapshot.summary, gating.summary);
  assert.equal(audit.resolutionReadinessSnapshot.summary, readiness.summary);
  assert.ok(audit.closeoutBlockedReasons.length > 0);
  assert.equal(audit.reviewRequired, true);
  assert.ok(trail.trailPath.endsWith(".resolution-audit.json"));
  assert.equal(trail.records[0]?.id, audit.id);
});
