import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { buildSandboxCloseoutDispositionSummary } from "../../src/sandbox-closeout-disposition-summary";
import { buildSandboxCloseoutFollowupQueue } from "../../src/sandbox-closeout-followup-queue";
import { buildSandboxCloseoutFollowupSummary } from "../../src/sandbox-closeout-followup-summary";
import { buildSandboxCloseoutReviewLifecycle } from "../../src/sandbox-closeout-review-lifecycle";
import { buildSandboxCloseoutReviewQueue } from "../../src/sandbox-closeout-review-queue";
import { buildSandboxCloseoutReviewResolutionSummary } from "../../src/sandbox-closeout-review-resolution-summary";
import { runSandboxCloseoutReviewAction } from "../../src/sandbox-closeout-review-actions";
import { buildSandboxCloseoutReviewSummary } from "../../src/sandbox-closeout-review-summary";
import { appendSandboxCloseoutReviewAuditTrail } from "../../src/sandbox-closeout-review-audit-trail";
import { appendSandboxCloseoutSettlementAudit } from "../../src/sandbox-closeout-settlement-audit";
import { appendSandboxResolutionAuditLog } from "../../src/sandbox-resolution-audit";
import { buildSandboxResolutionEvidenceSummary } from "../../src/sandbox-resolution-evidence";
import { buildSandboxResolutionReadiness } from "../../src/sandbox-resolution-readiness";
import { buildSandboxClosureGatingDecision } from "../../src/sandbox-closure-gating";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-followup-queue-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-followup-queue-v1",
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

async function prepareFollowupQueue(params: {
  configPath: string;
  state: ReturnType<typeof createInitialState>;
  action: "approve_closeout" | "request_followup";
}) {
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath: params.configPath });
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
  const audit = await appendSandboxResolutionAuditLog({
    configPath: params.configPath,
    actorSource: "test-sandbox-closeout-followup-queue",
    commandSource: "sandbox:resolution:audit",
    resolutionEvidenceSnapshot: evidence,
    closureGatingDecisionSnapshot: gating,
    resolutionReadinessSnapshot: readiness,
  });
  const reviewAction = await runSandboxCloseoutReviewAction({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    action: params.action,
    actorSource: "test-sandbox-closeout-followup-queue",
    commandSource: `sandbox:closeout:review:${params.action}`,
    auditId: audit.id,
  });
  assert.equal(reviewAction.status, "accepted");
  const reviewSummary = await buildSandboxCloseoutReviewSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
  });
  const reviewQueue = await buildSandboxCloseoutReviewQueue({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
  });
  const disposition = await buildSandboxCloseoutDispositionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
    closeoutReviewSummary: reviewSummary,
    closeoutReviewQueue: reviewQueue,
  });
  const lifecycle = await buildSandboxCloseoutReviewLifecycle({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
    closeoutReviewSummary: reviewSummary,
    closeoutReviewQueue: reviewQueue,
    closeoutDispositionSummary: disposition,
  });
  await appendSandboxCloseoutReviewAuditTrail({
    configPath: params.configPath,
    actorSource: "test-sandbox-closeout-followup-queue",
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
    loadedRegistry,
    limit: 20,
    closeoutDispositionSummary: disposition,
    closeoutReviewLifecycle: lifecycle,
    closeoutReviewQueue: reviewQueue,
  });
  const followup = await buildSandboxCloseoutFollowupSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
    closeoutDispositionSummary: disposition,
    closeoutReviewLifecycle: lifecycle,
    closeoutReviewQueue: reviewQueue,
    closeoutReviewResolutionSummary: resolution,
    resolutionEvidenceSummary: evidence,
    closureGatingDecision: gating,
  });
  const settlementAudit = await appendSandboxCloseoutSettlementAudit({
    configPath: params.configPath,
    actorSource: "test-sandbox-closeout-followup-queue",
    commandSource: "sandbox:closeout:settlement:audit",
    reviewResolutionSummarySnapshot: resolution,
    reviewQueueSnapshot: reviewQueue,
    followupSummarySnapshot: followup,
    latestIncidentType: readiness.latestIncidentType,
    latestIncidentSeverity: readiness.latestIncidentSeverity,
    latestIncidentSummary: readiness.latestIncidentSummary,
  });
  return buildSandboxCloseoutFollowupQueue({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
    closeoutFollowupSummary: followup,
    closeoutReviewResolutionSummary: resolution,
    closeoutReviewQueue: reviewQueue,
    latestSettlementAudit: settlementAudit,
  });
}

test("sandbox closeout follow-up queue retains settlement-blocked entries", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-followup-queue-blocked",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Keep follow-up queue open",
    objective: "closeout follow-up queue",
    subtasks: ["sandbox-closeout-followup-queue"],
    successCriteria: ["follow-up blocking settlement remains queued"],
  });

  const queue = await prepareFollowupQueue({
    configPath,
    state,
    action: "request_followup",
  });

  assert.equal(queue.queueStatus, "settlement_blocked");
  assert.equal(queue.followUpRequired, true);
  assert.equal(queue.settlementBlocked, true);
  assert.equal(queue.entries.length, 1);
  assert.ok(queue.blockedReasonsSummary.length > 0);
});

test("sandbox closeout follow-up queue clears once closeout is complete", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-followup-queue-empty",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Clear follow-up queue",
    objective: "closeout follow-up queue",
    subtasks: ["sandbox-closeout-followup-queue"],
    successCriteria: ["approved closeout removes follow-up queue"],
  });

  const queue = await prepareFollowupQueue({
    configPath,
    state,
    action: "approve_closeout",
  });

  assert.equal(queue.queueStatus, "empty");
  assert.equal(queue.followUpRequired, false);
  assert.equal(queue.closeoutComplete, true);
  assert.equal(queue.entries.length, 0);
});
