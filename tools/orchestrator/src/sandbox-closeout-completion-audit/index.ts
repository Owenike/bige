import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SandboxCloseoutFollowupQueue } from "../sandbox-closeout-followup-queue";
import type { SandboxCloseoutFollowupSummary } from "../sandbox-closeout-followup-summary";
import type { SandboxCloseoutSettlementAudit } from "../sandbox-closeout-settlement-audit";

const sandboxCloseoutCompletionAuditSchema = z.object({
  id: z.string(),
  auditedAt: z.string(),
  latestReviewAction: z.enum([
    "none",
    "approve_closeout",
    "reject_closeout",
    "request_followup",
    "defer_review",
    "reopen_review",
  ]),
  latestDispositionResult: z.enum([
    "none",
    "closeout_approved",
    "closeout_rejected",
    "followup_required",
    "review_deferred",
    "reopened_for_review",
  ]),
  latestLifecycleStatus: z.enum([
    "closeout_complete",
    "followup_open",
    "review_pending",
    "queue_reopened",
    "blocked",
  ]),
  settlementAuditSnapshot: z.unknown(),
  followupSummarySnapshot: z.unknown(),
  followupQueueSnapshot: z.unknown(),
  latestIncidentType: z.string(),
  latestIncidentSeverity: z.string().nullable().default(null),
  latestIncidentSummary: z.string().nullable().default(null),
  completionStatus: z.enum([
    "review_complete_allowed",
    "closeout_complete_allowed",
    "completion_blocked",
    "followup_open",
    "queue_retained",
  ]),
  reviewCompleteAllowed: z.boolean().default(false),
  closeoutCompleteAllowed: z.boolean().default(false),
  completionBlockedReasons: z.array(z.string()).default([]),
  completionSupportingReasons: z.array(z.string()).default([]),
  followUpRemainsOpen: z.boolean().default(false),
  queueExitAllowed: z.boolean().default(false),
  fullyReviewed: z.boolean().default(false),
  fullyCompleted: z.boolean().default(false),
  queueRetainedReasons: z.array(z.string()).default([]),
  missingEvidenceSummary: z.array(z.string()).default([]),
  missingFollowUpSignals: z.array(z.string()).default([]),
  actorSource: z.string(),
  commandSource: z.string().nullable().default(null),
  summaryLine: z.string(),
});

const sandboxCloseoutCompletionAuditTrailSchema = z.object({
  updatedAt: z.string(),
  records: z.array(sandboxCloseoutCompletionAuditSchema).default([]),
});

export type SandboxCloseoutCompletionAudit = {
  id: string;
  auditedAt: string;
  latestReviewAction: SandboxCloseoutSettlementAudit["latestReviewAction"];
  latestDispositionResult: SandboxCloseoutSettlementAudit["latestDispositionResult"];
  latestLifecycleStatus: SandboxCloseoutSettlementAudit["latestLifecycleStatus"];
  settlementAuditSnapshot: SandboxCloseoutSettlementAudit;
  followupSummarySnapshot: SandboxCloseoutFollowupSummary;
  followupQueueSnapshot: SandboxCloseoutFollowupQueue;
  latestIncidentType: string;
  latestIncidentSeverity: string | null;
  latestIncidentSummary: string | null;
  completionStatus:
    | "review_complete_allowed"
    | "closeout_complete_allowed"
    | "completion_blocked"
    | "followup_open"
    | "queue_retained";
  reviewCompleteAllowed: boolean;
  closeoutCompleteAllowed: boolean;
  completionBlockedReasons: string[];
  completionSupportingReasons: string[];
  followUpRemainsOpen: boolean;
  queueExitAllowed: boolean;
  fullyReviewed: boolean;
  fullyCompleted: boolean;
  queueRetainedReasons: string[];
  missingEvidenceSummary: string[];
  missingFollowUpSignals: string[];
  actorSource: string;
  commandSource: string | null;
  summaryLine: string;
};

function buildCompletionAuditId(auditedAt: string, status: string, action: string) {
  return `sandbox-closeout-completion:${auditedAt}:${status}:${action}`;
}

function resolveTrailPath(configPath: string) {
  return `${path.resolve(configPath)}.closeout-completion-audit.json`;
}

async function loadCompletionAuditTrail(configPath: string) {
  const trailPath = resolveTrailPath(configPath);
  try {
    const raw = await readFile(trailPath, "utf8");
    return {
      trailPath,
      trail: sandboxCloseoutCompletionAuditTrailSchema.parse(JSON.parse(raw)),
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return {
        trailPath,
        trail: sandboxCloseoutCompletionAuditTrailSchema.parse({
          updatedAt: new Date(0).toISOString(),
          records: [],
        }),
      };
    }
    throw error;
  }
}

async function saveCompletionAuditTrail(
  configPath: string,
  trail: z.infer<typeof sandboxCloseoutCompletionAuditTrailSchema>,
) {
  const trailPath = resolveTrailPath(configPath);
  await mkdir(path.dirname(trailPath), { recursive: true });
  await writeFile(trailPath, `${JSON.stringify(trail, null, 2)}\n`, "utf8");
  return trailPath;
}

export async function appendSandboxCloseoutCompletionAudit(params: {
  configPath: string;
  actorSource: string;
  commandSource?: string | null;
  settlementAuditSnapshot: SandboxCloseoutSettlementAudit;
  followupSummarySnapshot: SandboxCloseoutFollowupSummary;
  followupQueueSnapshot: SandboxCloseoutFollowupQueue;
  latestIncidentType: string;
  latestIncidentSeverity: string | null;
  latestIncidentSummary: string | null;
}) {
  const auditedAt = new Date().toISOString();
  const { trail } = await loadCompletionAuditTrail(params.configPath);
  const fullyReviewed =
    params.settlementAuditSnapshot.reviewComplete &&
    params.followupSummarySnapshot.reviewCanBeTreatedAsComplete &&
    !params.followupSummarySnapshot.followUpOpen;
  const fullyCompleted =
    params.settlementAuditSnapshot.closeoutComplete &&
    params.followupSummarySnapshot.closeoutCanBeTreatedAsComplete &&
    params.followupQueueSnapshot.queueStatus === "empty";
  const reviewCompleteAllowed = fullyReviewed;
  const closeoutCompleteAllowed = fullyCompleted;
  const followUpRemainsOpen =
    params.settlementAuditSnapshot.followUpRemainsOpen || params.followupSummarySnapshot.followUpOpen;
  const queueExitAllowed =
    params.settlementAuditSnapshot.queueExitAllowed && params.followupQueueSnapshot.queueStatus === "empty";
  const completionBlockedReasons = Array.from(
    new Set(
      [
        ...params.settlementAuditSnapshot.settlementBlockedReasons,
        ...params.followupSummarySnapshot.followUpReasons,
        ...params.followupQueueSnapshot.blockedReasonsSummary,
        ...(queueExitAllowed ? [] : params.settlementAuditSnapshot.queueRetainedReasons),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const completionSupportingReasons = Array.from(
    new Set(
      [
        params.settlementAuditSnapshot.summaryLine,
        params.followupSummarySnapshot.summaryLine,
        params.followupQueueSnapshot.summaryLine,
        reviewCompleteAllowed ? "review_complete_allowed" : null,
        closeoutCompleteAllowed ? "closeout_complete_allowed" : null,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const missingEvidenceSummary = Array.from(
    new Set(
      [
        ...params.settlementAuditSnapshot.missingEvidenceSummary,
        ...params.followupSummarySnapshot.followUpEvidenceGaps,
        ...params.followupQueueSnapshot.missingEvidenceSummary,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const missingFollowUpSignals = Array.from(
    new Set(
      [
        ...params.settlementAuditSnapshot.missingFollowUpSignals,
        ...params.followupSummarySnapshot.followUpReasons,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const queueRetainedReasons = Array.from(
    new Set(
      [
        ...params.settlementAuditSnapshot.queueRetainedReasons,
        ...(params.followupQueueSnapshot.queueStatus === "empty"
          ? []
          : [
              `completion_queue_retained:${params.followupQueueSnapshot.queueStatus}`,
              ...params.followupQueueSnapshot.blockedReasonsSummary,
            ]),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const completionStatus: SandboxCloseoutCompletionAudit["completionStatus"] = fullyCompleted
    ? "closeout_complete_allowed"
    : reviewCompleteAllowed
      ? "review_complete_allowed"
      : followUpRemainsOpen
        ? "followup_open"
        : queueRetainedReasons.length > 0
          ? "queue_retained"
          : "completion_blocked";
  const summaryLine =
    completionStatus === "closeout_complete_allowed"
      ? "Sandbox closeout completion audit: review and closeout are complete."
      : completionStatus === "review_complete_allowed"
        ? "Sandbox closeout completion audit: review is complete, but closeout completion still has open governance work."
        : completionStatus === "followup_open"
          ? "Sandbox closeout completion audit: follow-up remains open before completion."
          : completionStatus === "queue_retained"
            ? `Sandbox closeout completion audit: queue retained; next=${params.followupQueueSnapshot.recommendedNextOperatorStep}.`
            : `Sandbox closeout completion audit: completion blocked; next=${params.followupSummarySnapshot.recommendedNextOperatorStep}.`;

  const record = sandboxCloseoutCompletionAuditSchema.parse({
    id: buildCompletionAuditId(
      auditedAt,
      completionStatus,
      params.settlementAuditSnapshot.latestReviewAction,
    ),
    auditedAt,
    latestReviewAction: params.settlementAuditSnapshot.latestReviewAction,
    latestDispositionResult: params.settlementAuditSnapshot.latestDispositionResult,
    latestLifecycleStatus: params.settlementAuditSnapshot.latestLifecycleStatus,
    settlementAuditSnapshot: params.settlementAuditSnapshot,
    followupSummarySnapshot: params.followupSummarySnapshot,
    followupQueueSnapshot: params.followupQueueSnapshot,
    latestIncidentType: params.latestIncidentType,
    latestIncidentSeverity: params.latestIncidentSeverity,
    latestIncidentSummary: params.latestIncidentSummary,
    completionStatus,
    reviewCompleteAllowed,
    closeoutCompleteAllowed,
    completionBlockedReasons,
    completionSupportingReasons,
    followUpRemainsOpen,
    queueExitAllowed,
    fullyReviewed,
    fullyCompleted,
    queueRetainedReasons,
    missingEvidenceSummary,
    missingFollowUpSignals,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    summaryLine,
  });
  const nextTrail = sandboxCloseoutCompletionAuditTrailSchema.parse({
    updatedAt: auditedAt,
    records: [...trail.records, record].slice(-100),
  });
  await saveCompletionAuditTrail(params.configPath, nextTrail);
  return record as SandboxCloseoutCompletionAudit;
}

export async function listSandboxCloseoutCompletionAudits(params: {
  configPath: string;
  limit?: number;
}) {
  const { trailPath, trail } = await loadCompletionAuditTrail(params.configPath);
  const limit = Math.max(1, params.limit ?? 20);
  return {
    trailPath,
    records: trail.records.slice(-limit).reverse() as SandboxCloseoutCompletionAudit[],
  };
}

export function formatSandboxCloseoutCompletionAudits(params: {
  records: SandboxCloseoutCompletionAudit[];
}) {
  return [
    "Sandbox closeout completion audit",
    ...(params.records.length === 0
      ? ["No closeout completion audits have been captured yet."]
      : params.records.map(
          (record) =>
            `- ${record.auditedAt} ${record.completionStatus} action=${record.latestReviewAction} disposition=${record.latestDispositionResult} lifecycle=${record.latestLifecycleStatus} followUp=${record.followUpRemainsOpen} queueExit=${record.queueExitAllowed} fullyReviewed=${record.fullyReviewed} fullyCompleted=${record.fullyCompleted} :: ${record.summaryLine}`,
        )),
  ].join("\n");
}
