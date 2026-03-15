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
import { runSandboxCloseoutReviewAction } from "../../src/sandbox-closeout-review-actions";
import { buildSandboxCloseoutReviewSummary } from "../../src/sandbox-closeout-review-summary";
import { appendSandboxCloseoutReviewAuditTrail } from "../../src/sandbox-closeout-review-audit-trail";
import { appendSandboxResolutionAuditLog } from "../../src/sandbox-resolution-audit";
import { buildSandboxResolutionEvidenceSummary } from "../../src/sandbox-resolution-evidence";
import { buildSandboxResolutionReadiness } from "../../src/sandbox-resolution-readiness";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-review-history-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-review-history-v1",
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
    actorSource: "test-sandbox-closeout-review-history",
    commandSource: "sandbox:resolution:audit",
    resolutionEvidenceSnapshot: evidence,
    resolutionReadinessSnapshot: readiness,
    closureGatingDecisionSnapshot: gating,
  });
  return { audit, loadedRegistry };
}

async function runReviewDecision(params: {
  configPath: string;
  state: ReturnType<typeof createInitialState>;
  loadedRegistry: Awaited<ReturnType<typeof loadGitHubSandboxTargetRegistry>>;
  auditId: string;
  action:
    | "approve_closeout"
    | "reject_closeout"
    | "request_followup"
    | "defer_review"
    | "reopen_review";
}) {
  const reviewAction = await runSandboxCloseoutReviewAction({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    action: params.action,
    actorSource: "test-sandbox-closeout-review-history",
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
    actorSource: "test-sandbox-closeout-review-history",
    commandSource: `sandbox:closeout:review:${params.action}`,
    reviewAction: reviewAction.reviewAction,
    dispositionSummary: disposition,
    reviewLifecycle: lifecycle,
    reviewQueue,
    reviewSummary,
  });
}

test("sandbox closeout review history summarizes repeated review patterns", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-review-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track repeated closeout review patterns",
    objective: "closeout review history",
    subtasks: ["sandbox-closeout-review-history"],
    successCriteria: ["repeated review patterns remain visible"],
  });
  const { audit, loadedRegistry } = await appendBaseCloseoutAudit(configPath, state);

  await runReviewDecision({ configPath, state, loadedRegistry, auditId: audit.id, action: "request_followup" });
  await runReviewDecision({ configPath, state, loadedRegistry, auditId: audit.id, action: "request_followup" });
  await runReviewDecision({ configPath, state, loadedRegistry, auditId: audit.id, action: "reject_closeout" });
  await runReviewDecision({ configPath, state, loadedRegistry, auditId: audit.id, action: "reopen_review" });
  await runReviewDecision({ configPath, state, loadedRegistry, auditId: audit.id, action: "reject_closeout" });
  await runReviewDecision({ configPath, state, loadedRegistry, auditId: audit.id, action: "reopen_review" });
  await runReviewDecision({ configPath, state, loadedRegistry, auditId: audit.id, action: "defer_review" });
  await runReviewDecision({ configPath, state, loadedRegistry, auditId: audit.id, action: "defer_review" });

  const history = await buildSandboxCloseoutReviewHistory({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
  });

  assert.ok(history.retainedEntryCount >= 8);
  assert.ok(history.repeatedFollowupPatterns.length > 0);
  assert.ok(history.repeatedRejectPatterns.length > 0);
  assert.ok(history.repeatedDeferPatterns.length > 0);
  assert.ok(history.repeatedReopenPatterns.length > 0);
  assert.ok(history.repeatedQueueRetainedPatterns.length > 0);
});
