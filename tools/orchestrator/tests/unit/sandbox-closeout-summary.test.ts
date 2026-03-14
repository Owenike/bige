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
import { appendSandboxResolutionAuditLog } from "../../src/sandbox-resolution-audit";
import { buildSandboxCloseoutSummary } from "../../src/sandbox-closeout-summary";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-summary-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-summary-v1",
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

test("sandbox closeout summary distinguishes closure-ready state from unresolved closeout", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closeout-summary-clear",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize closeout readiness",
    objective: "closeout summary",
    subtasks: ["sandbox-closeout-summary"],
    successCriteria: ["closeout summary stays centralized"],
  });
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });

  const summary = await buildSandboxCloseoutSummary({
    configPath,
    state: initialState,
    loadedRegistry,
    limit: 20,
  });

  assert.equal(summary.latestCloseoutDecision, "closure_ready");
  assert.ok(summary.handoffLine.includes("closure-ready"));
  assert.ok(summary.evidenceSufficiencySummary.includes("sufficient"));
});

test("sandbox closeout summary preserves audit-backed resolved_not_ready decisions", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closeout-summary-blocked",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize blocked closeout",
    objective: "closeout summary",
    subtasks: ["sandbox-closeout-summary"],
    successCriteria: ["resolved is not treated as closed"],
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
          targetNumber: 707,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-closeout-summary",
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
    actorSource: "test-sandbox-closeout-summary",
    commandSource: "sandbox:incident:closure-check",
  });

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
    actorSource: "test-sandbox-closeout-summary",
    commandSource: "sandbox:closeout:summary",
    resolutionEvidenceSnapshot: evidence,
    closureGatingDecisionSnapshot: gating,
    resolutionReadinessSnapshot: readiness,
  });

  const summary = await buildSandboxCloseoutSummary({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
    latestAuditLog: audit,
  });

  assert.equal(summary.latestCloseoutDecision, "resolved_not_ready");
  assert.ok(summary.evidenceSufficiencySummary.includes("Evidence gaps remain"));
  assert.ok(summary.readinessSummary.length > 0);
  assert.ok(summary.gatingSummary.length > 0);
  assert.equal(summary.latestAuditSummaryLine, audit.summaryLine);
  assert.ok(summary.handoffLine.includes("resolved_not_ready"));
});
