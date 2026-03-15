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
import { listSandboxCloseoutReviewActions, runSandboxCloseoutReviewAction } from "../../src/sandbox-closeout-review-actions";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-review-actions-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-review-actions-v1",
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
    actorSource: "test-sandbox-closeout-review-actions",
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
    actorSource: "test-sandbox-closeout-review-actions",
    commandSource: `sandbox:${params.action}`,
    resolutionEvidenceSnapshot: evidence,
    resolutionReadinessSnapshot: readiness,
    closureGatingDecisionSnapshot: gating,
  });
}

test("sandbox closeout review actions record accepted follow-up and reopen decisions", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closeout-review-actions",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Record closeout review actions",
    objective: "closeout review actions",
    subtasks: ["sandbox-closeout-review-actions"],
    successCriteria: ["review decisions stay centralized"],
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
          targetNumber: 4242,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-closeout-review-actions",
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

  const followup = await runSandboxCloseoutReviewAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    action: "request_followup",
    actorSource: "test-sandbox-closeout-review-actions",
    commandSource: "sandbox:closeout:review:followup",
    auditId: audit.id,
    note: "collect more validation evidence",
  });
  assert.equal(followup.status, "accepted");
  assert.equal(followup.reviewAction.followUpRequested, true);

  const reopen = await runSandboxCloseoutReviewAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    action: "reopen_review",
    actorSource: "test-sandbox-closeout-review-actions",
    commandSource: "sandbox:closeout:review:reopen",
    auditId: audit.id,
    reason: "new blocked pattern observed",
  });
  assert.equal(reopen.status, "accepted");
  assert.equal(reopen.reviewAction.reviewQueueReopened, true);

  const trail = await listSandboxCloseoutReviewActions({
    configPath,
    limit: 10,
  });
  assert.equal(trail.records.length, 2);
  assert.equal(trail.records[0]?.latestReviewAction, "reopen_review");
  assert.equal(trail.records[1]?.latestReviewAction, "request_followup");
});

test("sandbox closeout review actions block unsafe approve_closeout decisions", async () => {
  const { configPath } = await createSandboxConfig();
  const initialState = createInitialState({
    id: "sandbox-closeout-review-actions-approve",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Block unsafe closeout approval",
    objective: "closeout review actions",
    subtasks: ["sandbox-closeout-review-actions"],
    successCriteria: ["unsafe approvals stay blocked"],
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
          targetNumber: 4343,
          overrideFields: ["targetNumber"],
        },
      },
    },
    actorSource: "test-sandbox-closeout-review-actions",
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

  const result = await runSandboxCloseoutReviewAction({
    configPath,
    state,
    loadedRegistry: currentRegistry,
    action: "approve_closeout",
    actorSource: "test-sandbox-closeout-review-actions",
    commandSource: "sandbox:closeout:review:approve",
    auditId: audit.id,
    reason: "attempt closure",
  });

  assert.notEqual(result.status, "accepted");
  assert.equal(result.failureReason, "sandbox_closeout_not_ready");
  assert.equal(result.reviewAction.closeoutApproved, false);
});
