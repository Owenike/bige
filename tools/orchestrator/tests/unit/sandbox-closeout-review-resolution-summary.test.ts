import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { buildSandboxClosureGatingDecision } from "../../src/sandbox-closure-gating";
import { buildSandboxCloseoutDispositionSummary } from "../../src/sandbox-closeout-disposition-summary";
import { buildSandboxCloseoutReviewHistory } from "../../src/sandbox-closeout-review-history";
import { buildSandboxCloseoutReviewLifecycle } from "../../src/sandbox-closeout-review-lifecycle";
import { buildSandboxCloseoutReviewQueue } from "../../src/sandbox-closeout-review-queue";
import { buildSandboxCloseoutReviewResolutionSummary } from "../../src/sandbox-closeout-review-resolution-summary";
import { runSandboxCloseoutReviewAction } from "../../src/sandbox-closeout-review-actions";
import { buildSandboxCloseoutReviewSummary } from "../../src/sandbox-closeout-review-summary";
import { appendSandboxCloseoutReviewAuditTrail } from "../../src/sandbox-closeout-review-audit-trail";
import { appendSandboxResolutionAuditLog } from "../../src/sandbox-resolution-audit";
import { buildSandboxResolutionEvidenceSummary } from "../../src/sandbox-resolution-evidence";
import { buildSandboxResolutionReadiness } from "../../src/sandbox-resolution-readiness";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-review-resolution-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-review-resolution-v1",
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
    actorSource: "test-sandbox-closeout-review-resolution",
    commandSource: "sandbox:resolution:audit",
    resolutionEvidenceSnapshot: evidence,
    resolutionReadinessSnapshot: readiness,
    closureGatingDecisionSnapshot: gating,
  });
  return { audit, loadedRegistry };
}

async function appendReviewAudit(params: {
  configPath: string;
  state: ReturnType<typeof createInitialState>;
  loadedRegistry: Awaited<ReturnType<typeof loadGitHubSandboxTargetRegistry>>;
  auditId: string;
  action:
    | "approve_closeout"
    | "request_followup";
}) {
  const reviewAction = await runSandboxCloseoutReviewAction({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    action: params.action,
    actorSource: "test-sandbox-closeout-review-resolution",
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
    actorSource: "test-sandbox-closeout-review-resolution",
    commandSource: `sandbox:closeout:review:${params.action}`,
    reviewAction: reviewAction.reviewAction,
    dispositionSummary: disposition,
    reviewLifecycle: lifecycle,
    reviewQueue,
    reviewSummary,
  });
  return {
    disposition,
    lifecycle,
    reviewQueue,
  };
}

test("sandbox closeout review resolution summary marks approved closure as settled", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-review-resolution-settled",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Resolve closeout review thread",
    objective: "closeout review resolution summary",
    subtasks: ["sandbox-closeout-review-resolution-summary"],
    successCriteria: ["settled review thread remains explicit"],
  });
  const { audit, loadedRegistry } = await appendBaseCloseoutAudit(configPath, state);
  const { disposition, lifecycle, reviewQueue } = await appendReviewAudit({
    configPath,
    state,
    loadedRegistry,
    auditId: audit.id,
    action: "approve_closeout",
  });

  const history = await buildSandboxCloseoutReviewHistory({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
  });
  const resolution = await buildSandboxCloseoutReviewResolutionSummary({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
    closeoutDispositionSummary: disposition,
    closeoutReviewLifecycle: lifecycle,
    closeoutReviewQueue: reviewQueue,
    closeoutReviewHistory: history,
  });

  assert.equal(resolution.resolutionStatus, "review_settled");
  assert.equal(resolution.reviewThreadSettled, true);
  assert.equal(resolution.queueExitAllowed, true);
  assert.equal(resolution.closeoutCanBeTreatedAsFullyReviewed, true);
});

test("sandbox closeout review resolution summary keeps follow-up threads unsettled", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-review-resolution-followup",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Keep follow-up review thread open",
    objective: "closeout review resolution summary",
    subtasks: ["sandbox-closeout-review-resolution-summary"],
    successCriteria: ["follow-up never looks settled"],
  });
  const { audit, loadedRegistry } = await appendBaseCloseoutAudit(configPath, state);
  const { disposition, lifecycle, reviewQueue } = await appendReviewAudit({
    configPath,
    state,
    loadedRegistry,
    auditId: audit.id,
    action: "request_followup",
  });

  const history = await buildSandboxCloseoutReviewHistory({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
  });
  const resolution = await buildSandboxCloseoutReviewResolutionSummary({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
    closeoutDispositionSummary: disposition,
    closeoutReviewLifecycle: lifecycle,
    closeoutReviewQueue: reviewQueue,
    closeoutReviewHistory: history,
  });

  assert.equal(resolution.resolutionStatus, "followup_open");
  assert.equal(resolution.reviewThreadSettled, false);
  assert.equal(resolution.closeoutCanBeTreatedAsFullyReviewed, false);
  assert.ok(resolution.unresolvedReviewReasons.length > 0);
});
