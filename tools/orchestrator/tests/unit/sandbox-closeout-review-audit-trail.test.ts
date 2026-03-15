import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { buildSandboxClosureGatingDecision } from "../../src/sandbox-closure-gating";
import { buildSandboxCloseoutDispositionSummary } from "../../src/sandbox-closeout-disposition-summary";
import { buildSandboxCloseoutReviewLifecycle } from "../../src/sandbox-closeout-review-lifecycle";
import { buildSandboxCloseoutReviewQueue } from "../../src/sandbox-closeout-review-queue";
import { runSandboxCloseoutReviewAction } from "../../src/sandbox-closeout-review-actions";
import { buildSandboxCloseoutReviewSummary } from "../../src/sandbox-closeout-review-summary";
import {
  appendSandboxCloseoutReviewAuditTrail,
  listSandboxCloseoutReviewAuditTrail,
} from "../../src/sandbox-closeout-review-audit-trail";
import { appendSandboxResolutionAuditLog } from "../../src/sandbox-resolution-audit";
import { buildSandboxResolutionEvidenceSummary } from "../../src/sandbox-resolution-evidence";
import { buildSandboxResolutionReadiness } from "../../src/sandbox-resolution-readiness";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-closeout-review-audit-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-closeout-review-audit-v1",
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
    actorSource: "test-sandbox-closeout-review-audit",
    commandSource: "sandbox:resolution:audit",
    resolutionEvidenceSnapshot: evidence,
    resolutionReadinessSnapshot: readiness,
    closureGatingDecisionSnapshot: gating,
  });
  return { audit, loadedRegistry };
}

test("sandbox closeout review audit trail captures disposition/lifecycle/queue snapshots", async () => {
  const { configPath } = await createSandboxConfig();
  const state = createInitialState({
    id: "sandbox-closeout-review-audit",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Capture closeout review audit snapshots",
    objective: "closeout review audit trail",
    subtasks: ["sandbox-closeout-review-audit-trail"],
    successCriteria: ["review audit stays centralized"],
  });
  const { audit, loadedRegistry } = await appendBaseCloseoutAudit(configPath, state);
  const reviewAction = await runSandboxCloseoutReviewAction({
    configPath,
    state,
    loadedRegistry,
    action: "request_followup",
    actorSource: "test-sandbox-closeout-review-audit",
    commandSource: "sandbox:closeout:review:followup",
    auditId: audit.id,
    note: "collect follow-up validation evidence",
  });
  assert.equal(reviewAction.status, "accepted");

  const reviewSummary = await buildSandboxCloseoutReviewSummary({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
  });
  const reviewQueue = await buildSandboxCloseoutReviewQueue({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
  });
  const disposition = await buildSandboxCloseoutDispositionSummary({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
    closeoutReviewSummary: reviewSummary,
    closeoutReviewQueue: reviewQueue,
  });
  const lifecycle = await buildSandboxCloseoutReviewLifecycle({
    configPath,
    state,
    loadedRegistry,
    limit: 20,
    closeoutReviewSummary: reviewSummary,
    closeoutReviewQueue: reviewQueue,
    closeoutDispositionSummary: disposition,
  });

  const auditEntry = await appendSandboxCloseoutReviewAuditTrail({
    configPath,
    actorSource: "test-sandbox-closeout-review-audit",
    commandSource: "sandbox:closeout:review:audit",
    reviewAction: reviewAction.reviewAction,
    dispositionSummary: disposition,
    reviewLifecycle: lifecycle,
    reviewQueue,
    reviewSummary,
  });
  assert.equal(auditEntry.latestReviewAction, "request_followup");
  assert.equal(auditEntry.dispositionSnapshot.dispositionResult, "followup_required");
  assert.equal(auditEntry.lifecycleSnapshot.lifecycleStatus, "followup_open");
  assert.equal(auditEntry.reviewQueueSnapshot.queueStatus, "evidence_follow_up");
  assert.equal(auditEntry.followUpRequested, true);
  assert.equal(auditEntry.queueExitAllowed, false);
  assert.ok(auditEntry.queueRetainedReasons.length > 0);

  const trail = await listSandboxCloseoutReviewAuditTrail({
    configPath,
    limit: 10,
  });
  assert.equal(trail.records.length, 1);
  assert.equal(trail.records[0]?.latestReviewAction, "request_followup");
});
