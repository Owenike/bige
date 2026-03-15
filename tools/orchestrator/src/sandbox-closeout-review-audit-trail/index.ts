import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SandboxCloseoutDispositionSummary } from "../sandbox-closeout-disposition-summary";
import type { SandboxCloseoutReviewLifecycle } from "../sandbox-closeout-review-lifecycle";
import type { SandboxCloseoutReviewQueue } from "../sandbox-closeout-review-queue";
import type { SandboxCloseoutReviewActionRecord } from "../sandbox-closeout-review-actions";
import type { SandboxCloseoutReviewSummary } from "../sandbox-closeout-review-summary";

const sandboxCloseoutReviewAuditEntrySchema = z.object({
  id: z.string(),
  auditedAt: z.string(),
  reviewActionId: z.string().nullable().default(null),
  auditId: z.string().nullable().default(null),
  latestReviewAction: z.enum([
    "approve_closeout",
    "reject_closeout",
    "request_followup",
    "defer_review",
    "reopen_review",
  ]),
  latestReviewActionStatus: z.enum(["accepted", "blocked", "rejected", "manual_required"]),
  latestReviewActionReason: z.string().nullable().default(null),
  latestReviewActionNote: z.string().nullable().default(null),
  dispositionSnapshot: z.unknown(),
  lifecycleSnapshot: z.unknown(),
  reviewQueueSnapshot: z.unknown(),
  reviewSummarySnapshot: z.unknown(),
  latestIncidentType: z.string(),
  latestIncidentSeverity: z.string().nullable().default(null),
  latestIncidentSummary: z.string().nullable().default(null),
  reviewThreadReopened: z.boolean().default(false),
  followUpRequested: z.boolean().default(false),
  queueExitAllowed: z.boolean().default(false),
  queueRetainedReasons: z.array(z.string()).default([]),
  missingFollowUpSignals: z.array(z.string()).default([]),
  actorSource: z.string(),
  commandSource: z.string().nullable().default(null),
  summaryLine: z.string(),
});

const sandboxCloseoutReviewAuditTrailSchema = z.object({
  updatedAt: z.string(),
  records: z.array(sandboxCloseoutReviewAuditEntrySchema).default([]),
});

export type SandboxCloseoutReviewAuditEntry = {
  id: string;
  auditedAt: string;
  reviewActionId: string | null;
  auditId: string | null;
  latestReviewAction: SandboxCloseoutReviewActionRecord["latestReviewAction"];
  latestReviewActionStatus: SandboxCloseoutReviewActionRecord["latestReviewActionStatus"];
  latestReviewActionReason: string | null;
  latestReviewActionNote: string | null;
  dispositionSnapshot: SandboxCloseoutDispositionSummary;
  lifecycleSnapshot: SandboxCloseoutReviewLifecycle;
  reviewQueueSnapshot: SandboxCloseoutReviewQueue;
  reviewSummarySnapshot: SandboxCloseoutReviewSummary;
  latestIncidentType: SandboxCloseoutDispositionSummary["latestIncidentType"];
  latestIncidentSeverity: SandboxCloseoutDispositionSummary["latestIncidentSeverity"];
  latestIncidentSummary: string | null;
  reviewThreadReopened: boolean;
  followUpRequested: boolean;
  queueExitAllowed: boolean;
  queueRetainedReasons: string[];
  missingFollowUpSignals: string[];
  actorSource: string;
  commandSource: string | null;
  summaryLine: string;
};

export type SandboxCloseoutReviewAuditTrail = {
  updatedAt: string;
  records: SandboxCloseoutReviewAuditEntry[];
};

function buildReviewAuditId(
  auditedAt: string,
  action: SandboxCloseoutReviewActionRecord["latestReviewAction"],
  disposition: SandboxCloseoutDispositionSummary["dispositionResult"],
) {
  return `sandbox-closeout-review-audit:${auditedAt}:${action}:${disposition}`;
}

function resolveTrailPath(configPath: string) {
  return `${path.resolve(configPath)}.closeout-review-audit.json`;
}

async function loadReviewAuditTrail(configPath: string) {
  const trailPath = resolveTrailPath(configPath);
  try {
    const raw = await readFile(trailPath, "utf8");
    return {
      trailPath,
      trail: sandboxCloseoutReviewAuditTrailSchema.parse(JSON.parse(raw)),
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return {
        trailPath,
        trail: sandboxCloseoutReviewAuditTrailSchema.parse({
          updatedAt: new Date(0).toISOString(),
          records: [],
        }),
      };
    }
    throw error;
  }
}

async function saveReviewAuditTrail(
  configPath: string,
  trail: z.infer<typeof sandboxCloseoutReviewAuditTrailSchema>,
) {
  const trailPath = resolveTrailPath(configPath);
  await mkdir(path.dirname(trailPath), { recursive: true });
  await writeFile(trailPath, `${JSON.stringify(trail, null, 2)}\n`, "utf8");
  return trailPath;
}

function buildQueueRetainedReasons(params: {
  disposition: SandboxCloseoutDispositionSummary;
  lifecycle: SandboxCloseoutReviewLifecycle;
  reviewQueue: SandboxCloseoutReviewQueue;
  reviewSummary: SandboxCloseoutReviewSummary;
}) {
  return Array.from(
    new Set(
      [
        ...params.reviewQueue.blockedReasonsSummary,
        ...params.reviewQueue.missingEvidenceSummary,
        ...params.disposition.dispositionWarnings,
        ...params.lifecycle.lifecycleReasons,
        ...params.reviewSummary.governanceWarnings,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function buildMissingFollowUpSignals(params: {
  disposition: SandboxCloseoutDispositionSummary;
  reviewQueue: SandboxCloseoutReviewQueue;
  reviewSummary: SandboxCloseoutReviewSummary;
}) {
  return Array.from(
    new Set(
      [
        ...(params.reviewQueue.evidenceFollowUpRequired
          ? params.reviewQueue.missingEvidenceSummary
          : []),
        ...(params.disposition.followUpRemainsOpen
          ? params.disposition.dispositionWarnings
          : []),
        ...(params.reviewSummary.evidenceFollowUpPending
          ? params.reviewSummary.repeatedResolvedNotReadyHotspots
          : []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

export async function appendSandboxCloseoutReviewAuditTrail(params: {
  configPath: string;
  actorSource: string;
  commandSource?: string | null;
  reviewAction: SandboxCloseoutReviewActionRecord;
  dispositionSummary: SandboxCloseoutDispositionSummary;
  reviewLifecycle: SandboxCloseoutReviewLifecycle;
  reviewQueue: SandboxCloseoutReviewQueue;
  reviewSummary: SandboxCloseoutReviewSummary;
}) {
  const auditedAt = new Date().toISOString();
  const { trail } = await loadReviewAuditTrail(params.configPath);
  const queueRetainedReasons = buildQueueRetainedReasons({
    disposition: params.dispositionSummary,
    lifecycle: params.reviewLifecycle,
    reviewQueue: params.reviewQueue,
    reviewSummary: params.reviewSummary,
  });
  const missingFollowUpSignals = buildMissingFollowUpSignals({
    disposition: params.dispositionSummary,
    reviewQueue: params.reviewQueue,
    reviewSummary: params.reviewSummary,
  });
  const record = sandboxCloseoutReviewAuditEntrySchema.parse({
    id: buildReviewAuditId(
      auditedAt,
      params.reviewAction.latestReviewAction,
      params.dispositionSummary.dispositionResult,
    ),
    auditedAt,
    reviewActionId: params.reviewAction.id,
    auditId: params.reviewAction.auditId,
    latestReviewAction: params.reviewAction.latestReviewAction,
    latestReviewActionStatus: params.reviewAction.latestReviewActionStatus,
    latestReviewActionReason: params.reviewAction.latestReviewActionReason,
    latestReviewActionNote: params.reviewAction.latestReviewActionNote,
    dispositionSnapshot: params.dispositionSummary,
    lifecycleSnapshot: params.reviewLifecycle,
    reviewQueueSnapshot: params.reviewQueue,
    reviewSummarySnapshot: params.reviewSummary,
    latestIncidentType: params.dispositionSummary.latestIncidentType,
    latestIncidentSeverity: params.dispositionSummary.latestIncidentSeverity,
    latestIncidentSummary: params.dispositionSummary.latestIncidentSummary,
    reviewThreadReopened:
      params.reviewAction.reviewQueueReopened || params.reviewLifecycle.reopenedForReview,
    followUpRequested:
      params.reviewAction.followUpRequested || params.dispositionSummary.followUpRemainsOpen,
    queueExitAllowed:
      params.dispositionSummary.queueExitAllowed && params.reviewLifecycle.queueExitAllowed,
    queueRetainedReasons,
    missingFollowUpSignals,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    summaryLine:
      params.reviewLifecycle.queueExitAllowed
        ? `Closeout review audit: ${params.reviewAction.latestReviewAction}/${params.reviewAction.latestReviewActionStatus} allows queue exit.`
        : `Closeout review audit: ${params.reviewAction.latestReviewAction}/${params.reviewAction.latestReviewActionStatus} keeps queue ${params.reviewQueue.queueStatus}.`,
  });
  const nextTrail = sandboxCloseoutReviewAuditTrailSchema.parse({
    updatedAt: auditedAt,
    records: [...trail.records, record].slice(-100),
  });
  await saveReviewAuditTrail(params.configPath, nextTrail);
  return record as SandboxCloseoutReviewAuditEntry;
}

export async function listSandboxCloseoutReviewAuditTrail(params: {
  configPath: string;
  limit?: number;
}) {
  const { trailPath, trail } = await loadReviewAuditTrail(params.configPath);
  const limit = Math.max(1, params.limit ?? 20);
  return {
    trailPath,
    records: trail.records.slice(-limit).reverse() as SandboxCloseoutReviewAuditEntry[],
  };
}

export function formatSandboxCloseoutReviewAuditTrail(params: {
  records: SandboxCloseoutReviewAuditEntry[];
}) {
  return [
    "Sandbox closeout review audit trail",
    ...(params.records.length === 0
      ? ["No closeout review audit records have been captured yet."]
      : params.records.map(
          (record) =>
            `- ${record.auditedAt} ${record.latestReviewAction}/${record.latestReviewActionStatus} disposition=${record.dispositionSnapshot.dispositionResult} lifecycle=${record.lifecycleSnapshot.lifecycleStatus} queue=${record.reviewQueueSnapshot.queueStatus} exit=${record.queueExitAllowed} :: ${record.summaryLine}`,
        )),
  ].join("\n");
}
