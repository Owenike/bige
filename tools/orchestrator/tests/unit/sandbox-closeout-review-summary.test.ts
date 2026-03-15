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
import { buildSandboxCloseoutReviewSummary } from "../../src/sandbox-closeout-review-summary";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-review-summary-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-review-summary-v1",
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
    actorSource: "test-sandbox-closeout-review-summary",
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

  await appendSandboxResolutionAuditLog({
    configPath: params.configPath,
    actorSource: "test-sandbox-closeout-review-summary",
    commandSource: `sandbox:${params.action}`,
    resolutionEvidenceSnapshot: evidence,
    resolutionReadinessSnapshot: readiness,
    closureGatingDecisionSnapshot: gating,
  });
}

test("sandbox closeout review summary highlights follow-up and repeated hotspots", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closeout-review-summary",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize closeout review follow-up",
    objective: "closeout review summary",
    subtasks: ["sandbox-closeout-review-summary"],
    successCriteria: ["review follow-up is readable"],
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
    actorSource: "test-sandbox-closeout-review-summary",
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
    action: "mark_resolved",
  });
  await appendAuditForAction({
    configPath,
    state,
    incidentId: compareIncident!.id,
    action: "mark_resolved",
  });

  const summary = await buildSandboxCloseoutReviewSummary({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });

  assert.equal(summary.latestCloseoutDecision, "resolved_not_ready");
  assert.equal(summary.reviewStatus, "escalation_pending");
  assert.equal(summary.reviewPending, true);
  assert.equal(summary.escalationPending, true);
  assert.equal(summary.evidenceFollowUpPending, true);
  assert.ok(summary.repeatedReviewHotspots.length > 0);
  assert.ok(summary.repeatedBlockedHotspots.length > 0);
  assert.ok(summary.repeatedResolvedNotReadyHotspots.length > 0);
  assert.ok(summary.recommendedNextReviewAction.length > 0);
  assert.ok(summary.reviewSummaryLine.includes("latest decision=resolved_not_ready"));
});
