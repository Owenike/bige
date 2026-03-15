import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { OrchestratorState } from "../../../src/schemas";
import { loadGitHubSandboxTargetRegistry } from "../../../src/github-sandbox-targets";
import { buildSandboxClosureGatingDecision } from "../../../src/sandbox-closure-gating";
import { appendSandboxCloseoutCompletionAudit } from "../../../src/sandbox-closeout-completion-audit";
import { runSandboxCloseoutCompletionAction } from "../../../src/sandbox-closeout-completion-actions";
import { buildSandboxCloseoutCompletionCarryForwardQueue } from "../../../src/sandbox-closeout-completion-carry-forward-queue";
import { appendSandboxCloseoutCompletionDecisionAudit } from "../../../src/sandbox-closeout-completion-decision-audit";
import { buildSandboxCloseoutCompletionDecisionHistory } from "../../../src/sandbox-closeout-completion-decision-history";
import { buildSandboxCloseoutCompletionDispositionSummary } from "../../../src/sandbox-closeout-completion-disposition-summary";
import { buildSandboxCloseoutCompletionHistory } from "../../../src/sandbox-closeout-completion-history";
import { buildSandboxCloseoutCompletionFinalizationSummary } from "../../../src/sandbox-closeout-completion-finalization-summary";
import { buildSandboxCloseoutCompletionLifecycle } from "../../../src/sandbox-closeout-completion-lifecycle";
import { buildSandboxCloseoutCompletionResolutionSummary } from "../../../src/sandbox-closeout-completion-resolution-summary";
import { buildSandboxCloseoutCompletionSummary } from "../../../src/sandbox-closeout-completion-summary";
import { buildSandboxCloseoutCompletionQueue } from "../../../src/sandbox-closeout-completion-queue";
import { buildSandboxCloseoutDispositionSummary } from "../../../src/sandbox-closeout-disposition-summary";
import { buildSandboxCloseoutFollowupQueue } from "../../../src/sandbox-closeout-followup-queue";
import { buildSandboxCloseoutFollowupSummary } from "../../../src/sandbox-closeout-followup-summary";
import { buildSandboxCloseoutReviewLifecycle } from "../../../src/sandbox-closeout-review-lifecycle";
import { buildSandboxCloseoutReviewQueue } from "../../../src/sandbox-closeout-review-queue";
import { buildSandboxCloseoutReviewResolutionSummary } from "../../../src/sandbox-closeout-review-resolution-summary";
import { buildSandboxCloseoutReviewSummary } from "../../../src/sandbox-closeout-review-summary";
import { appendSandboxCloseoutReviewAuditTrail } from "../../../src/sandbox-closeout-review-audit-trail";
import { runSandboxCloseoutReviewAction } from "../../../src/sandbox-closeout-review-actions";
import { appendSandboxCloseoutSettlementAudit } from "../../../src/sandbox-closeout-settlement-audit";
import { appendSandboxResolutionAuditLog } from "../../../src/sandbox-resolution-audit";
import { buildSandboxResolutionEvidenceSummary } from "../../../src/sandbox-resolution-evidence";
import { buildSandboxResolutionReadiness } from "../../../src/sandbox-resolution-readiness";

export async function createCloseoutCompletionSandboxConfig(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: `${prefix}-v1`,
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

export async function prepareCloseoutCompletionContext(params: {
  configPath: string;
  state: OrchestratorState;
  reviewAction: "approve_closeout" | "request_followup";
  actorSource: string;
  limit?: number;
}) {
  const limit = Math.max(5, params.limit ?? 20);
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath: params.configPath });
  const evidence = await buildSandboxResolutionEvidenceSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit,
  });
  const readiness = await buildSandboxResolutionReadiness({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit,
  });
  const gating = await buildSandboxClosureGatingDecision({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit,
  });
  const audit = await appendSandboxResolutionAuditLog({
    configPath: params.configPath,
    actorSource: params.actorSource,
    commandSource: "sandbox:resolution:audit",
    resolutionEvidenceSnapshot: evidence,
    closureGatingDecisionSnapshot: gating,
    resolutionReadinessSnapshot: readiness,
  });
  const reviewAction = await runSandboxCloseoutReviewAction({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    action: params.reviewAction,
    actorSource: params.actorSource,
    commandSource: `sandbox:closeout:review:${params.reviewAction}`,
    auditId: audit.id,
  });
  assert.equal(reviewAction.status, "accepted");
  const reviewSummary = await buildSandboxCloseoutReviewSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit,
  });
  const reviewQueue = await buildSandboxCloseoutReviewQueue({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit,
  });
  const disposition = await buildSandboxCloseoutDispositionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit,
    closeoutReviewSummary: reviewSummary,
    closeoutReviewQueue: reviewQueue,
  });
  const lifecycle = await buildSandboxCloseoutReviewLifecycle({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit,
    closeoutReviewSummary: reviewSummary,
    closeoutReviewQueue: reviewQueue,
    closeoutDispositionSummary: disposition,
  });
  await appendSandboxCloseoutReviewAuditTrail({
    configPath: params.configPath,
    actorSource: params.actorSource,
    commandSource: `sandbox:closeout:review:${params.reviewAction}`,
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
    limit,
    closeoutDispositionSummary: disposition,
    closeoutReviewLifecycle: lifecycle,
    closeoutReviewQueue: reviewQueue,
  });
  const followupSummary = await buildSandboxCloseoutFollowupSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit,
    closeoutDispositionSummary: disposition,
    closeoutReviewLifecycle: lifecycle,
    closeoutReviewQueue: reviewQueue,
    closeoutReviewResolutionSummary: reviewResolution,
    resolutionEvidenceSummary: evidence,
    closureGatingDecision: gating,
  });
  const settlementAudit = await appendSandboxCloseoutSettlementAudit({
    configPath: params.configPath,
    actorSource: params.actorSource,
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
    limit,
    closeoutFollowupSummary: followupSummary,
    closeoutReviewResolutionSummary: reviewResolution,
    closeoutReviewQueue: reviewQueue,
    latestSettlementAudit: settlementAudit,
  });
  const completionAudit = await appendSandboxCloseoutCompletionAudit({
    configPath: params.configPath,
    actorSource: params.actorSource,
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
    limit,
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
    limit,
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
    limit,
  });
  const completionResolution = await buildSandboxCloseoutCompletionResolutionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry,
    limit,
    closeoutCompletionHistory: completionHistory,
    closeoutCompletionSummary: completionSummary,
    closeoutCompletionQueue: completionQueue,
    closeoutFollowupSummary: followupSummary,
    closeoutFollowupQueue: followupQueue,
    latestSettlementAudit: settlementAudit,
    latestCompletionAudit: completionAudit,
  });
  const completionCarryForwardQueue =
    await buildSandboxCloseoutCompletionCarryForwardQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry,
      limit,
      closeoutCompletionHistory: completionHistory,
      closeoutCompletionResolutionSummary: completionResolution,
      closeoutCompletionQueue: completionQueue,
      closeoutFollowupSummary: followupSummary,
      closeoutFollowupQueue: followupQueue,
    });

  return {
    loadedRegistry,
    evidence,
    readiness,
    gating,
    audit,
    reviewAction,
    reviewSummary,
    reviewQueue,
    disposition,
    lifecycle,
    reviewResolution,
    followupSummary,
    settlementAudit,
    followupQueue,
    completionAudit,
    completionSummary,
    completionQueue,
    completionHistory,
    completionResolution,
    completionCarryForwardQueue,
  };
}

export async function runCloseoutCompletionDecision(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry: Awaited<ReturnType<typeof loadGitHubSandboxTargetRegistry>>;
  action:
    | "confirm_review_complete"
    | "confirm_closeout_complete"
    | "keep_carry_forward"
    | "reopen_completion";
  actorSource: string;
  commandSource: string;
  completionAuditId: string | null;
  reason?: string | null;
  note?: string | null;
  limit?: number;
}) {
  const limit = Math.max(5, params.limit ?? 20);
  const result = await runSandboxCloseoutCompletionAction({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    action: params.action,
    actorSource: params.actorSource,
    commandSource: params.commandSource,
    completionAuditId: params.completionAuditId,
    reason: params.reason ?? null,
    note: params.note ?? null,
    limit,
  });
  const completionHistory = await buildSandboxCloseoutCompletionHistory({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const completionResolution = await buildSandboxCloseoutCompletionResolutionSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutCompletionHistory: completionHistory,
  });
  const completionCarryForwardQueue =
    await buildSandboxCloseoutCompletionCarryForwardQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionHistory: completionHistory,
      closeoutCompletionResolutionSummary: completionResolution,
    });
  const completionDispositionSummary =
    await buildSandboxCloseoutCompletionDispositionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionHistory: completionHistory,
      closeoutCompletionResolutionSummary: completionResolution,
      closeoutCompletionCarryForwardQueue: completionCarryForwardQueue,
      latestCompletionAction: result.completionAction,
    });
  const completionLifecycle = await buildSandboxCloseoutCompletionLifecycle({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
    closeoutCompletionHistory: completionHistory,
    closeoutCompletionResolutionSummary: completionResolution,
    closeoutCompletionCarryForwardQueue: completionCarryForwardQueue,
    closeoutCompletionDispositionSummary: completionDispositionSummary,
    latestCompletionAction: result.completionAction,
  });
  const finalizedCompletionCarryForwardQueue =
    await buildSandboxCloseoutCompletionCarryForwardQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionHistory: completionHistory,
      closeoutCompletionResolutionSummary: completionResolution,
      closeoutCompletionDispositionSummary: completionDispositionSummary,
      closeoutCompletionLifecycle: completionLifecycle,
    });
  const completionDecisionAudit =
    await appendSandboxCloseoutCompletionDecisionAudit({
      configPath: params.configPath,
      actorSource: params.actorSource,
      commandSource: params.commandSource,
      completionAction: result.completionAction,
      dispositionSummary: completionDispositionSummary,
      completionLifecycle,
      completionCarryForwardQueue: finalizedCompletionCarryForwardQueue,
      completionResolutionSummary: completionResolution,
      latestIncidentType: params.state.lastIncidentType ?? "none",
      latestIncidentSeverity: params.state.lastIncidentSeverity ?? null,
      latestIncidentSummary: params.state.lastIncidentSummary ?? null,
    });
  const completionDecisionHistory =
    await buildSandboxCloseoutCompletionDecisionHistory({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
    });
  const completionFinalizationSummary =
    await buildSandboxCloseoutCompletionFinalizationSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionDecisionAudit: completionDecisionAudit,
      closeoutCompletionDecisionHistory: completionDecisionHistory,
      closeoutCompletionDispositionSummary: completionDispositionSummary,
      closeoutCompletionLifecycle: completionLifecycle,
      closeoutCompletionCarryForwardQueue: finalizedCompletionCarryForwardQueue,
      closeoutCompletionResolutionSummary: completionResolution,
    });

  return {
    result,
    completionHistory,
    completionResolution,
    completionCarryForwardQueue: finalizedCompletionCarryForwardQueue,
    completionDispositionSummary,
    completionLifecycle,
    completionDecisionAudit,
    completionDecisionHistory,
    completionFinalizationSummary,
  };
}
