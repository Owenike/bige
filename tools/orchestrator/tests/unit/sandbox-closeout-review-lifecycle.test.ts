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
import { runSandboxCloseoutReviewAction } from "../../src/sandbox-closeout-review-actions";
import { buildSandboxCloseoutReviewLifecycle } from "../../src/sandbox-closeout-review-lifecycle";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-lifecycle-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-lifecycle-v1",
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
    actorSource: "test-sandbox-closeout-lifecycle",
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
    actorSource: "test-sandbox-closeout-lifecycle",
    commandSource: `sandbox:${params.action}`,
    resolutionEvidenceSnapshot: evidence,
    resolutionReadinessSnapshot: readiness,
    closureGatingDecisionSnapshot: gating,
  });
}

test("sandbox closeout review lifecycle keeps queue open after follow-up request", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closeout-lifecycle-followup",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track closeout review lifecycle",
    objective: "closeout review lifecycle",
    subtasks: ["sandbox-closeout-review-lifecycle"],
    successCriteria: ["follow-up keeps lifecycle open"],
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
          targetNumber: 6262,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-closeout-lifecycle",
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

  const audit = await appendAuditForAction({
    configPath,
    state,
    incidentId: compareIncident!.id,
    action: "mark_resolved",
  });
  const reviewAction = await runSandboxCloseoutReviewAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    action: "request_followup",
    actorSource: "test-sandbox-closeout-lifecycle",
    commandSource: "sandbox:closeout:review:followup",
    auditId: audit.id,
  });
  assert.equal(reviewAction.status, "accepted");

  const lifecycle = await buildSandboxCloseoutReviewLifecycle({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });

  assert.equal(lifecycle.lifecycleStatus, "followup_open");
  assert.equal(lifecycle.queueShouldRemain, true);
  assert.equal(lifecycle.queueExitAllowed, false);
  assert.equal(lifecycle.keptOpenForFollowUp, true);
  assert.equal(lifecycle.closeoutCompleted, false);
  assert.ok(lifecycle.lifecycleReasons.length > 0);
});

test("sandbox closeout review lifecycle reopens review without closing the queue", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closeout-lifecycle-reopen",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Reopen closeout review lifecycle",
    objective: "closeout review lifecycle",
    subtasks: ["sandbox-closeout-review-lifecycle"],
    successCriteria: ["reopen keeps review pending"],
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
          targetNumber: 6363,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-closeout-lifecycle",
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

  const audit = await appendAuditForAction({
    configPath,
    state,
    incidentId: compareIncident!.id,
    action: "mark_resolved",
  });
  const reviewAction = await runSandboxCloseoutReviewAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    action: "reopen_review",
    actorSource: "test-sandbox-closeout-lifecycle",
    commandSource: "sandbox:closeout:review:reopen",
    auditId: audit.id,
  });
  assert.equal(reviewAction.status, "accepted");

  const lifecycle = await buildSandboxCloseoutReviewLifecycle({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    limit: 20,
  });

  assert.equal(lifecycle.lifecycleStatus, "queue_reopened");
  assert.equal(lifecycle.reopenedForReview, true);
  assert.equal(lifecycle.queueShouldRemain, true);
  assert.equal(lifecycle.queueExitAllowed, false);
  assert.ok(lifecycle.summaryLine.includes("queue_reopened"));
});
