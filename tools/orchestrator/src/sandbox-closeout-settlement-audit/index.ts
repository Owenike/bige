import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SandboxCloseoutFollowupSummary } from "../sandbox-closeout-followup-summary";
import type { SandboxCloseoutReviewQueue } from "../sandbox-closeout-review-queue";
import type { SandboxCloseoutReviewResolutionSummary } from "../sandbox-closeout-review-resolution-summary";

const sandboxCloseoutSettlementAuditSchema = z.object({
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
  reviewResolutionSummarySnapshot: z.unknown(),
  reviewQueueSnapshot: z.unknown(),
  followupSummarySnapshot: z.unknown(),
  latestIncidentType: z.string(),
  latestIncidentSeverity: z.string().nullable().default(null),
  latestIncidentSummary: z.string().nullable().default(null),
  settlementStatus: z.enum([
    "settlement_allowed",
    "settlement_blocked",
    "followup_open",
    "review_complete",
    "closeout_complete",
  ]),
  settlementAllowed: z.boolean().default(false),
  settlementBlockedReasons: z.array(z.string()).default([]),
  settlementSupportingReasons: z.array(z.string()).default([]),
  followUpRemainsOpen: z.boolean().default(false),
  queueExitAllowed: z.boolean().default(false),
  reviewComplete: z.boolean().default(false),
  closeoutComplete: z.boolean().default(false),
  queueRetainedReasons: z.array(z.string()).default([]),
  missingEvidenceSummary: z.array(z.string()).default([]),
  missingFollowUpSignals: z.array(z.string()).default([]),
  actorSource: z.string(),
  commandSource: z.string().nullable().default(null),
  summaryLine: z.string(),
});

const sandboxCloseoutSettlementAuditTrailSchema = z.object({
  updatedAt: z.string(),
  records: z.array(sandboxCloseoutSettlementAuditSchema).default([]),
});

export type SandboxCloseoutSettlementAudit = {
  id: string;
  auditedAt: string;
  latestReviewAction: SandboxCloseoutReviewResolutionSummary["latestReviewAction"];
  latestDispositionResult: SandboxCloseoutReviewResolutionSummary["latestDispositionResult"];
  latestLifecycleStatus: SandboxCloseoutReviewResolutionSummary["latestLifecycleStatus"];
  reviewResolutionSummarySnapshot: SandboxCloseoutReviewResolutionSummary;
  reviewQueueSnapshot: SandboxCloseoutReviewQueue;
  followupSummarySnapshot: SandboxCloseoutFollowupSummary;
  latestIncidentType: string;
  latestIncidentSeverity: string | null;
  latestIncidentSummary: string | null;
  settlementStatus:
    | "settlement_allowed"
    | "settlement_blocked"
    | "followup_open"
    | "review_complete"
    | "closeout_complete";
  settlementAllowed: boolean;
  settlementBlockedReasons: string[];
  settlementSupportingReasons: string[];
  followUpRemainsOpen: boolean;
  queueExitAllowed: boolean;
  reviewComplete: boolean;
  closeoutComplete: boolean;
  queueRetainedReasons: string[];
  missingEvidenceSummary: string[];
  missingFollowUpSignals: string[];
  actorSource: string;
  commandSource: string | null;
  summaryLine: string;
};

function buildSettlementAuditId(auditedAt: string, status: string, action: string) {
  return `sandbox-closeout-settlement:${auditedAt}:${status}:${action}`;
}

function resolveTrailPath(configPath: string) {
  return `${path.resolve(configPath)}.closeout-settlement-audit.json`;
}

async function loadSettlementAuditTrail(configPath: string) {
  const trailPath = resolveTrailPath(configPath);
  try {
    const raw = await readFile(trailPath, "utf8");
    return {
      trailPath,
      trail: sandboxCloseoutSettlementAuditTrailSchema.parse(JSON.parse(raw)),
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return {
        trailPath,
        trail: sandboxCloseoutSettlementAuditTrailSchema.parse({
          updatedAt: new Date(0).toISOString(),
          records: [],
        }),
      };
    }
    throw error;
  }
}

async function saveSettlementAuditTrail(
  configPath: string,
  trail: z.infer<typeof sandboxCloseoutSettlementAuditTrailSchema>,
) {
  const trailPath = resolveTrailPath(configPath);
  await mkdir(path.dirname(trailPath), { recursive: true });
  await writeFile(trailPath, `${JSON.stringify(trail, null, 2)}\n`, "utf8");
  return trailPath;
}

export async function appendSandboxCloseoutSettlementAudit(params: {
  configPath: string;
  actorSource: string;
  commandSource?: string | null;
  reviewResolutionSummarySnapshot: SandboxCloseoutReviewResolutionSummary;
  reviewQueueSnapshot: SandboxCloseoutReviewQueue;
  followupSummarySnapshot: SandboxCloseoutFollowupSummary;
  latestIncidentType: string;
  latestIncidentSeverity: string | null;
  latestIncidentSummary: string | null;
}) {
  const auditedAt = new Date().toISOString();
  const { trail } = await loadSettlementAuditTrail(params.configPath);
  const settlementAllowed =
    params.followupSummarySnapshot.reviewCanBeTreatedAsComplete &&
    params.reviewResolutionSummarySnapshot.reviewThreadSettled &&
    !params.followupSummarySnapshot.followUpBlockingSettlement;
  const reviewComplete = params.followupSummarySnapshot.reviewCanBeTreatedAsComplete;
  const closeoutComplete = params.followupSummarySnapshot.closeoutCanBeTreatedAsComplete;
  const followUpRemainsOpen = params.followupSummarySnapshot.followUpOpen;
  const queueExitAllowed = params.reviewResolutionSummarySnapshot.queueExitAllowed;
  const settlementBlockedReasons = Array.from(
    new Set(
      [
        ...params.followupSummarySnapshot.followUpReasons,
        ...params.reviewResolutionSummarySnapshot.unresolvedReviewReasons,
        ...params.reviewQueueSnapshot.blockedReasonsSummary,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const settlementSupportingReasons = Array.from(
    new Set(
      [
        params.reviewResolutionSummarySnapshot.summaryLine,
        params.followupSummarySnapshot.summaryLine,
        queueExitAllowed ? "queue_exit_allowed" : null,
        reviewComplete ? "review_complete" : null,
        closeoutComplete ? "closeout_complete" : null,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const missingEvidenceSummary = Array.from(new Set(params.followupSummarySnapshot.followUpEvidenceGaps));
  const missingFollowUpSignals = Array.from(new Set(params.followupSummarySnapshot.followUpReasons));
  const queueRetainedReasons = Array.from(
    new Set(
      [
        ...params.reviewResolutionSummarySnapshot.unresolvedReviewReasons,
        ...params.reviewQueueSnapshot.blockedReasonsSummary,
        ...(queueExitAllowed ? [] : ["review_queue_retained"]),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const settlementStatus: SandboxCloseoutSettlementAudit["settlementStatus"] = closeoutComplete
    ? "closeout_complete"
    : reviewComplete
      ? "review_complete"
      : followUpRemainsOpen
        ? "followup_open"
        : settlementAllowed
          ? "settlement_allowed"
          : "settlement_blocked";
  const summaryLine =
    settlementStatus === "closeout_complete"
      ? "Sandbox closeout settlement audit: review and closeout are complete."
      : settlementStatus === "review_complete"
        ? "Sandbox closeout settlement audit: review is complete, but closeout still has pending obligations."
        : settlementStatus === "followup_open"
          ? "Sandbox closeout settlement audit: follow-up remains open before settlement."
          : settlementStatus === "settlement_allowed"
            ? "Sandbox closeout settlement audit: settlement is allowed."
            : `Sandbox closeout settlement audit: settlement blocked; next=${params.followupSummarySnapshot.recommendedNextOperatorStep}.`;

  const record = sandboxCloseoutSettlementAuditSchema.parse({
    id: buildSettlementAuditId(auditedAt, settlementStatus, params.reviewResolutionSummarySnapshot.latestReviewAction),
    auditedAt,
    latestReviewAction: params.reviewResolutionSummarySnapshot.latestReviewAction,
    latestDispositionResult: params.reviewResolutionSummarySnapshot.latestDispositionResult,
    latestLifecycleStatus: params.reviewResolutionSummarySnapshot.latestLifecycleStatus,
    reviewResolutionSummarySnapshot: params.reviewResolutionSummarySnapshot,
    reviewQueueSnapshot: params.reviewQueueSnapshot,
    followupSummarySnapshot: params.followupSummarySnapshot,
    latestIncidentType: params.latestIncidentType,
    latestIncidentSeverity: params.latestIncidentSeverity,
    latestIncidentSummary: params.latestIncidentSummary,
    settlementStatus,
    settlementAllowed,
    settlementBlockedReasons,
    settlementSupportingReasons,
    followUpRemainsOpen,
    queueExitAllowed,
    reviewComplete,
    closeoutComplete,
    queueRetainedReasons,
    missingEvidenceSummary,
    missingFollowUpSignals,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    summaryLine,
  });
  const nextTrail = sandboxCloseoutSettlementAuditTrailSchema.parse({
    updatedAt: auditedAt,
    records: [...trail.records, record].slice(-100),
  });
  await saveSettlementAuditTrail(params.configPath, nextTrail);
  return record as SandboxCloseoutSettlementAudit;
}

export async function listSandboxCloseoutSettlementAudits(params: {
  configPath: string;
  limit?: number;
}) {
  const { trailPath, trail } = await loadSettlementAuditTrail(params.configPath);
  const limit = Math.max(1, params.limit ?? 20);
  return {
    trailPath,
    records: trail.records.slice(-limit).reverse() as SandboxCloseoutSettlementAudit[],
  };
}

export function formatSandboxCloseoutSettlementAudits(params: {
  records: SandboxCloseoutSettlementAudit[];
}) {
  return [
    "Sandbox closeout settlement audit",
    ...(params.records.length === 0
      ? ["No closeout settlement audits have been captured yet."]
      : params.records.map(
          (record) =>
            `- ${record.auditedAt} ${record.settlementStatus} action=${record.latestReviewAction} disposition=${record.latestDispositionResult} lifecycle=${record.latestLifecycleStatus} followup=${record.followUpRemainsOpen} queueExit=${record.queueExitAllowed} reviewComplete=${record.reviewComplete} closeoutComplete=${record.closeoutComplete} :: ${record.summaryLine}`,
        )),
  ].join("\n");
}
