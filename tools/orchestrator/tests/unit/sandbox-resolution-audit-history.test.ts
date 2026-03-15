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
import { buildSandboxResolutionAuditHistory } from "../../src/sandbox-resolution-audit-history";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-resolution-history-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-resolution-history-v1",
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

async function appendAuditForAction(params: {
  configPath: string;
  incidentId: string;
  state: ReturnType<typeof orchestratorStateSchema.parse>;
  action:
    | "acknowledge"
    | "mark_resolved"
    | "escalate"
    | "request_review"
    | "rerun_preview"
    | "rerun_validate"
    | "rerun_apply";
}) {
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath: params.configPath });
  const action = await runSandboxOperatorAction({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    incidentId: params.incidentId,
    action: params.action,
    actorSource: "test-sandbox-resolution-history",
    commandSource: `sandbox:${params.action}`,
  });
  assert.equal(action.status, "accepted");

  const evidence = await buildSandboxResolutionEvidenceSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
  });
  const readiness = await buildSandboxResolutionReadiness({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
  });
  const gating = await buildSandboxClosureGatingDecision({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
  });

  return appendSandboxResolutionAuditLog({
    configPath: params.configPath,
    actorSource: "test-sandbox-resolution-history",
    commandSource: `sandbox:${params.action}`,
    resolutionEvidenceSnapshot: evidence,
    resolutionReadinessSnapshot: readiness,
    closureGatingDecisionSnapshot: gating,
  });
}

test("sandbox resolution audit history summarizes repeated closeout patterns and retained entries", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-resolution-audit-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Inspect closeout audit history",
    objective: "resolution audit history",
    subtasks: ["sandbox-resolution-audit-history"],
    successCriteria: ["resolution audit history is readable"],
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
    actorSource: "test-sandbox-resolution-history",
    applySource: "apply",
  });
  assert.equal(applied.status, "ready");

  const state = orchestratorStateSchema.parse({
    ...initialState,
    lastRestorePointId: applied.restorePointId,
    lastRestorePointSummary: applied.restorePointSummary,
  });
  const currentRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const incidents = await classifySandboxRecoveryIncidents({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });
  const compareIncident = incidents.incidents.find((incident) => incident.type === "high_risk_compare");
  assert.ok(compareIncident);

  await appendAuditForAction({
    configPath,
    state,
    incidentId: compareIncident!.id,
    action: "acknowledge",
  });
  await appendAuditForAction({
    configPath,
    state,
    incidentId: compareIncident!.id,
    action: "mark_resolved",
  });
  await appendAuditForAction({
    configPath,
    state,
    incidentId: compareIncident!.id,
    action: "mark_resolved",
  });
  await appendAuditForAction({
    configPath,
    state,
    incidentId: compareIncident!.id,
    action: "request_review",
  });

  const history = await buildSandboxResolutionAuditHistory({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });

  assert.equal(history.retainedEntryCount, 4);
  assert.equal(history.latestCloseoutDecision, "blocked");
  assert.ok(history.latestEntry);
  assert.ok(history.previousEntry);
  assert.ok(history.repeatedCloseoutDecisionPatterns.some((pattern) => pattern.decision === "resolved_not_ready"));
  assert.ok(history.repeatedCloseoutDecisionPatterns.some((pattern) => pattern.decision === "blocked"));
  assert.ok(history.repeatedBlockedReasons.length > 0);
  assert.ok(history.repeatedReviewRequiredReasons.length > 0);
  assert.ok(history.repeatedResolvedNotReadyReasons.length > 0);
  assert.ok(history.latestEvidenceSnapshotSummary);
  assert.ok(history.latestReadinessSnapshotSummary);
  assert.ok(history.latestClosureGatingSnapshotSummary);
  assert.ok(history.summaryLine.includes("retained=4"));
});
