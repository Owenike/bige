import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { buildSandboxClosureGatingDecision } from "../../src/sandbox-closure-gating";
import { buildSandboxCloseoutDispositionSummary } from "../../src/sandbox-closeout-disposition-summary";
import { buildSandboxCloseoutFollowupSummary } from "../../src/sandbox-closeout-followup-summary";
import { buildSandboxCloseoutReviewLifecycle } from "../../src/sandbox-closeout-review-lifecycle";
import { buildSandboxCloseoutReviewQueue } from "../../src/sandbox-closeout-review-queue";
import { buildSandboxCloseoutReviewResolutionSummary } from "../../src/sandbox-closeout-review-resolution-summary";
import { runSandboxCloseoutReviewAction } from "../../src/sandbox-closeout-review-actions";
import { buildSandboxCloseoutReviewSummary } from "../../src/sandbox-closeout-review-summary";
import { appendSandboxCloseoutReviewAuditTrail } from "../../src/sandbox-closeout-review-audit-trail";
import {
  appendSandboxCloseoutSettlementAudit,
  listSandboxCloseoutSettlementAudits,
} from "../../src/sandbox-closeout-settlement-audit";
import { appendSandboxResolutionAuditLog } from "../../src/sandbox-resolution-audit";
import { buildSandboxResolutionEvidenceSummary } from "../../src/sandbox-resolution-evidence";
import { buildSandboxResolutionReadiness } from "../../src/sandbox-resolution-readiness";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-settlement-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-settlement-v1",
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

async function appendBaseCloseoutAudit(configPath: string, state: ReturnType<typeof createInitialState>) {
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const evidence = await buildSandboxResolutionEvidenceSummary({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
  });
  const readiness = await buildSandboxResolutionReadiness({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
  });
  const gating = await buildSandboxClosureGatingDecision({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
  });
  const audit = await appendSandboxResolutionAuditLog({
    configPath,
    actorSource: "test-sandbox-closeout-settlement-audit",
    commandSource: "sandbox:resolution:audit",
    resolutionEvidenceSnapshot: evidence,
    closureGatingDecisionSnapshot: gating,
    resolutionReadinessSnapshot: readiness,
  });
  return { audit, evidence, gating, loadedRegistry, readiness };
}

async function appendReviewDecision(params: {
  configPath: string;
  state: ReturnType<typeof createInitialState>;
  loadedRegistry: Awaited<ReturnType<typeof loadGitHubSandboxTargetRegistry>>;
  auditId: string;
  action: "approve_closeout" | "request_followup";
}) {
  const reviewAction = await runSandboxCloseoutReviewAction({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    action: params.action,
    actorSource: "test-sandbox-closeout-settlement-audit",
    commandSource: `sandbox:closeout:review:${params.action}`,
    auditId: params.auditId,
  });
  assert.equal(reviewAction.status, "accepted");
  const reviewSummary = await buildSandboxCloseoutReviewSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit: 20,
  });
  const reviewQueue = await buildSandboxCloseoutReviewQueue({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit: 20,
  });
  const disposition = await buildSandboxCloseoutDispositionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit: 20,
    closeoutReviewSummary: reviewSummary,
    closeoutReviewQueue: reviewQueue,
  });
  const lifecycle = await buildSandboxCloseoutReviewLifecycle({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit: 20,
    closeoutReviewSummary: reviewSummary,
    closeoutReviewQueue: reviewQueue,
    closeoutDispositionSummary: disposition,
  });
  await appendSandboxCloseoutReviewAuditTrail({
    configPath: params.configPath,
    actorSource: "test-sandbox-closeout-settlement-audit",
    commandSource: `sandbox:closeout:review:${params.action}`,
    reviewAction: reviewAction.reviewAction,
    dispositionSummary: disposition,
    reviewLifecycle: lifecycle,
    reviewQueue,
    reviewSummary,
  });
  const resolution = await buildSandboxCloseoutReviewResolutionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit: 20,
    closeoutDispositionSummary: disposition,
    closeoutReviewLifecycle: lifecycle,
    closeoutReviewQueue: reviewQueue,
  });
  const followup = await buildSandboxCloseoutFollowupSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit: 20,
    closeoutDispositionSummary: disposition,
    closeoutReviewLifecycle: lifecycle,
    closeoutReviewQueue: reviewQueue,
    closeoutReviewResolutionSummary: resolution,
  });
  return {
    disposition,
    followup,
    lifecycle,
    resolution,
    reviewQueue,
  };
}

test("sandbox closeout settlement audit records follow-up open snapshots", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-settlement-followup",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Keep settlement blocked by follow-up",
    objective: "closeout settlement audit",
    subtasks: ["sandbox-closeout-settlement-audit"],
    successCriteria: ["follow-up remains explicit in settlement audit"],
  });
  const { audit, loadedRegistry, readiness } = await appendBaseCloseoutAudit(configPath, state);
  const { followup, resolution, reviewQueue } = await appendReviewDecision({
    configPath,
    state,
    loadedRegistry,
    auditId: audit.id,
    action: "request_followup",
  });

  const settlementAudit = await appendSandboxCloseoutSettlementAudit({
    configPath,
    actorSource: "test-sandbox-closeout-settlement-audit",
    commandSource: "sandbox:closeout:settlement:audit",
    reviewResolutionSummarySnapshot: resolution,
    reviewQueueSnapshot: reviewQueue,
    followupSummarySnapshot: followup,
    latestIncidentType: readiness.latestIncidentType,
    latestIncidentSeverity: readiness.latestIncidentSeverity,
    latestIncidentSummary: readiness.latestIncidentSummary,
  });
  const trail = await listSandboxCloseoutSettlementAudits({
    configPath,
    limit: 5,
  });

  assert.equal(settlementAudit.settlementStatus, "followup_open");
  assert.equal(settlementAudit.followUpRemainsOpen, true);
  assert.equal(settlementAudit.reviewComplete, false);
  assert.ok(settlementAudit.settlementBlockedReasons.length > 0);
  assert.equal(trail.records[0]?.id, settlementAudit.id);
});

test("sandbox closeout settlement audit marks approved closeout as complete", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-settlement-complete",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Record closeout complete settlement",
    objective: "closeout settlement audit",
    subtasks: ["sandbox-closeout-settlement-audit"],
    successCriteria: ["settlement audit captures closeout complete state"],
  });
  const { audit, loadedRegistry, readiness } = await appendBaseCloseoutAudit(configPath, state);
  const { followup, resolution, reviewQueue } = await appendReviewDecision({
    configPath,
    state,
    loadedRegistry,
    auditId: audit.id,
    action: "approve_closeout",
  });

  const settlementAudit = await appendSandboxCloseoutSettlementAudit({
    configPath,
    actorSource: "test-sandbox-closeout-settlement-audit",
    commandSource: "sandbox:closeout:settlement:audit",
    reviewResolutionSummarySnapshot: resolution,
    reviewQueueSnapshot: reviewQueue,
    followupSummarySnapshot: followup,
    latestIncidentType: readiness.latestIncidentType,
    latestIncidentSeverity: readiness.latestIncidentSeverity,
    latestIncidentSummary: readiness.latestIncidentSummary,
  });

  assert.equal(settlementAudit.settlementStatus, "closeout_complete");
  assert.equal(settlementAudit.settlementAllowed, true);
  assert.equal(settlementAudit.queueExitAllowed, true);
  assert.equal(settlementAudit.reviewComplete, true);
  assert.equal(settlementAudit.closeoutComplete, true);
});
