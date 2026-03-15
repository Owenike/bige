import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { buildSandboxClosureGatingDecision } from "../../src/sandbox-closure-gating";
import { appendSandboxCloseoutCompletionAudit } from "../../src/sandbox-closeout-completion-audit";
import { buildSandboxCloseoutCompletionQueue } from "../../src/sandbox-closeout-completion-queue";
import { buildSandboxCloseoutCompletionSummary } from "../../src/sandbox-closeout-completion-summary";
import { buildSandboxCloseoutDispositionSummary } from "../../src/sandbox-closeout-disposition-summary";
import { buildSandboxCloseoutFollowupQueue } from "../../src/sandbox-closeout-followup-queue";
import { buildSandboxCloseoutFollowupSummary } from "../../src/sandbox-closeout-followup-summary";
import { buildSandboxCloseoutReviewLifecycle } from "../../src/sandbox-closeout-review-lifecycle";
import { buildSandboxCloseoutReviewQueue } from "../../src/sandbox-closeout-review-queue";
import { buildSandboxCloseoutReviewResolutionSummary } from "../../src/sandbox-closeout-review-resolution-summary";
import { buildSandboxCloseoutReviewSummary } from "../../src/sandbox-closeout-review-summary";
import { appendSandboxCloseoutReviewAuditTrail } from "../../src/sandbox-closeout-review-audit-trail";
import { runSandboxCloseoutReviewAction } from "../../src/sandbox-closeout-review-actions";
import { appendSandboxCloseoutSettlementAudit } from "../../src/sandbox-closeout-settlement-audit";
import { appendSandboxResolutionAuditLog } from "../../src/sandbox-resolution-audit";
import { buildSandboxResolutionEvidenceSummary } from "../../src/sandbox-resolution-evidence";
import { buildSandboxResolutionReadiness } from "../../src/sandbox-resolution-readiness";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-completion-queue-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-completion-queue-v1",
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

async function prepareCompletionQueue(params: {
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
    actorSource: "test-sandbox-closeout-completion-queue",
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
    actorSource: "test-sandbox-closeout-completion-queue",
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
    actorSource: "test-sandbox-closeout-completion-queue",
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
  const followupSummary = await buildSandboxCloseoutFollowupSummary({
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
    actorSource: "test-sandbox-closeout-completion-queue",
    commandSource: "sandbox:closeout:settlement:audit",
    reviewResolutionSummarySnapshot: resolution,
    reviewQueueSnapshot: reviewQueue,
    followupSummarySnapshot: followupSummary,
    latestIncidentType: readiness.latestIncidentType,
    latestIncidentSeverity: readiness.latestIncidentSeverity,
    latestIncidentSummary: readiness.latestIncidentSummary,
  });
  const followupQueue = await buildSandboxCloseoutFollowupQueue({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
    closeoutFollowupSummary: followupSummary,
    closeoutReviewResolutionSummary: resolution,
    closeoutReviewQueue: reviewQueue,
    latestSettlementAudit: settlementAudit,
  });
  const completionAudit = await appendSandboxCloseoutCompletionAudit({
    configPath: params.configPath,
    actorSource: "test-sandbox-closeout-completion-queue",
    commandSource: "sandbox:closeout:completion:audit",
    settlementAuditSnapshot: settlementAudit,
    followupSummarySnapshot: followupSummary,
    followupQueueSnapshot: followupQueue,
    latestIncidentType: readiness.latestIncidentType,
    latestIncidentSeverity: readiness.latestIncidentSeverity,
    latestIncidentSummary: readiness.latestIncidentSummary,
  });
  const completionSummary = await buildSandboxCloseoutCompletionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
    closeoutDispositionSummary: disposition,
    closeoutReviewLifecycle: lifecycle,
    closeoutReviewResolutionSummary: resolution,
    closeoutFollowupSummary: followupSummary,
    closeoutFollowupQueue: followupQueue,
    resolutionEvidenceSummary: evidence,
    closureGatingDecision: gating,
    latestSettlementAudit: settlementAudit,
    latestCompletionAudit: completionAudit,
  });
  return buildSandboxCloseoutCompletionQueue({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit: 20,
    closeoutCompletionSummary: completionSummary,
    closeoutFollowupSummary: followupSummary,
    closeoutFollowupQueue: followupQueue,
    latestSettlementAudit: settlementAudit,
    latestCompletionAudit: completionAudit,
  });
}

test("sandbox closeout completion queue retains follow-up-open entries", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-completion-queue-open",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Keep completion queue open while follow-up remains",
    objective: "closeout completion queue",
    subtasks: ["sandbox-closeout-completion-queue"],
    successCriteria: ["follow-up-open cases remain queued for completion"],
  });

  const queue = await prepareCompletionQueue({
    configPath,
    state,
    action: "request_followup",
  });

  assert.equal(queue.queueStatus, "followup_open");
  assert.equal(queue.reviewCompleteRequired, true);
  assert.equal(queue.closeoutCompleteRequired, true);
  assert.equal(queue.followUpOpen, true);
  assert.equal(queue.entries.length, 1);
});

test("sandbox closeout completion queue clears once closeout is complete", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-completion-queue-empty",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Clear completion queue after approved closeout",
    objective: "closeout completion queue",
    subtasks: ["sandbox-closeout-completion-queue"],
    successCriteria: ["completed closeout leaves no completion queue entry"],
  });

  const queue = await prepareCompletionQueue({
    configPath,
    state,
    action: "approve_closeout",
  });

  assert.equal(queue.queueStatus, "empty");
  assert.equal(queue.reviewCompleteRequired, false);
  assert.equal(queue.closeoutCompleteRequired, false);
  assert.equal(queue.entries.length, 0);
});
