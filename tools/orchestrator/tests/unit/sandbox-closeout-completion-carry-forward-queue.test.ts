import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { buildSandboxClosureGatingDecision } from "../../src/sandbox-closure-gating";
import { appendSandboxCloseoutCompletionAudit } from "../../src/sandbox-closeout-completion-audit";
import { buildSandboxCloseoutCompletionCarryForwardQueue } from "../../src/sandbox-closeout-completion-carry-forward-queue";
import { buildSandboxCloseoutCompletionHistory } from "../../src/sandbox-closeout-completion-history";
import { buildSandboxCloseoutCompletionQueue } from "../../src/sandbox-closeout-completion-queue";
import { buildSandboxCloseoutCompletionResolutionSummary } from "../../src/sandbox-closeout-completion-resolution-summary";
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
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-completion-carry-forward-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-completion-carry-forward-v1",
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

async function buildCarryForwardQueue(params: {
  configPath: string;
  state: ReturnType<typeof createInitialState>;
  actions: Array<"approve_closeout" | "request_followup">;
}) {
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath: params.configPath });
  for (const action of params.actions) {
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
      actorSource: "test-sandbox-closeout-completion-carry-forward",
      commandSource: "sandbox:resolution:audit",
      resolutionEvidenceSnapshot: evidence,
      closureGatingDecisionSnapshot: gating,
      resolutionReadinessSnapshot: readiness,
    });
    const reviewAction = await runSandboxCloseoutReviewAction({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry,
      action,
      actorSource: "test-sandbox-closeout-completion-carry-forward",
      commandSource: `sandbox:closeout:review:${action}`,
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
      actorSource: "test-sandbox-closeout-completion-carry-forward",
      commandSource: `sandbox:closeout:review:${action}`,
      reviewAction: reviewAction.reviewAction,
      dispositionSummary: disposition,
      reviewLifecycle: lifecycle,
      reviewQueue,
      reviewSummary,
    });
    const reviewResolution = await buildSandboxCloseoutReviewResolutionSummary({
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
      closeoutReviewResolutionSummary: reviewResolution,
      resolutionEvidenceSummary: evidence,
      closureGatingDecision: gating,
    });
    const settlementAudit = await appendSandboxCloseoutSettlementAudit({
      configPath: params.configPath,
      actorSource: "test-sandbox-closeout-completion-carry-forward",
      commandSource: "sandbox:closeout:settlement:audit",
      reviewResolutionSummarySnapshot: reviewResolution,
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
      closeoutReviewResolutionSummary: reviewResolution,
      closeoutReviewQueue: reviewQueue,
      latestSettlementAudit: settlementAudit,
    });
    const completionAudit = await appendSandboxCloseoutCompletionAudit({
      configPath: params.configPath,
      actorSource: "test-sandbox-closeout-completion-carry-forward",
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
      closeoutReviewResolutionSummary: reviewResolution,
      closeoutFollowupSummary: followupSummary,
      closeoutFollowupQueue: followupQueue,
      resolutionEvidenceSummary: evidence,
      closureGatingDecision: gating,
      latestSettlementAudit: settlementAudit,
      latestCompletionAudit: completionAudit,
    });
    const completionQueue = await buildSandboxCloseoutCompletionQueue({
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
    const completionHistory = await buildSandboxCloseoutCompletionHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry,
      limit: 20,
    });
    const completionResolution = await buildSandboxCloseoutCompletionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry,
      limit: 20,
      closeoutCompletionHistory: completionHistory,
      closeoutCompletionSummary: completionSummary,
      closeoutCompletionQueue: completionQueue,
      closeoutFollowupSummary: followupSummary,
      closeoutFollowupQueue: followupQueue,
      latestSettlementAudit: settlementAudit,
      latestCompletionAudit: completionAudit,
    });
    if (action === params.actions[params.actions.length - 1]) {
      return buildSandboxCloseoutCompletionCarryForwardQueue({
        configPath: params.configPath,
        state: params.state,
        loadedRegistry,
        limit: 20,
        closeoutCompletionHistory: completionHistory,
        closeoutCompletionResolutionSummary: completionResolution,
        closeoutCompletionQueue: completionQueue,
        closeoutFollowupSummary: followupSummary,
        closeoutFollowupQueue: followupQueue,
      });
    }
  }
  throw new Error("No completion cycle executed.");
}

test("sandbox closeout completion carry-forward queue keeps reverted cases in governance", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-completion-carry-forward-reverted",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Carry forward reverted completion",
    objective: "closeout completion carry forward",
    subtasks: ["sandbox-closeout-completion-carry-forward"],
    successCriteria: ["reverted completion remains in carry-forward queue"],
  });

  const queue = await buildCarryForwardQueue({
    configPath,
    state,
    actions: ["approve_closeout", "request_followup"],
  });

  assert.equal(queue.queueStatus, "completion_reverted");
  assert.equal(queue.completionReverted, true);
  assert.equal(queue.entries.length, 1);
  assert.ok(queue.carryForwardReasons.length > 0);
});

test("sandbox closeout completion carry-forward queue clears once fully complete", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-completion-carry-forward-complete",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Clear carry-forward queue after completion",
    objective: "closeout completion carry forward",
    subtasks: ["sandbox-closeout-completion-carry-forward"],
    successCriteria: ["completed closeout leaves no carry-forward queue entry"],
  });

  const queue = await buildCarryForwardQueue({
    configPath,
    state,
    actions: ["approve_closeout"],
  });

  assert.equal(queue.queueStatus, "empty");
  assert.equal(queue.entries.length, 0);
});
