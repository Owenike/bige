import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SandboxCloseoutCompletionActionRecord } from "../sandbox-closeout-completion-actions";
import type { SandboxCloseoutCompletionCarryForwardQueue } from "../sandbox-closeout-completion-carry-forward-queue";
import type { SandboxCloseoutCompletionDispositionSummary } from "../sandbox-closeout-completion-disposition-summary";
import type { SandboxCloseoutCompletionLifecycle } from "../sandbox-closeout-completion-lifecycle";
import type { SandboxCloseoutCompletionResolutionSummary } from "../sandbox-closeout-completion-resolution-summary";

const sandboxCloseoutCompletionDecisionAuditEntrySchema = z.object({
  id: z.string(),
  auditedAt: z.string(),
  completionActionId: z.string().nullable().default(null),
  completionAuditId: z.string().nullable().default(null),
  latestCompletionAction: z.enum([
    "confirm_review_complete",
    "confirm_closeout_complete",
    "keep_carry_forward",
    "reopen_completion",
  ]),
  latestCompletionActionStatus: z.enum(["accepted", "blocked", "rejected", "manual_required"]),
  latestCompletionActionReason: z.string().nullable().default(null),
  latestCompletionActionNote: z.string().nullable().default(null),
  dispositionSnapshot: z.unknown(),
  lifecycleSnapshot: z.unknown(),
  carryForwardQueueSnapshot: z.unknown(),
  resolutionSnapshot: z.unknown(),
  latestIncidentType: z.string(),
  latestIncidentSeverity: z.string().nullable().default(null),
  latestIncidentSummary: z.string().nullable().default(null),
  completionFinalized: z.boolean().default(false),
  completionRetained: z.boolean().default(false),
  completionReopened: z.boolean().default(false),
  queueRetainedReasons: z.array(z.string()).default([]),
  missingFollowUpSignals: z.array(z.string()).default([]),
  missingEvidenceSignals: z.array(z.string()).default([]),
  actorSource: z.string(),
  commandSource: z.string().nullable().default(null),
  summaryLine: z.string(),
});

const sandboxCloseoutCompletionDecisionAuditTrailSchema = z.object({
  updatedAt: z.string(),
  records: z.array(sandboxCloseoutCompletionDecisionAuditEntrySchema).default([]),
});

export type SandboxCloseoutCompletionDecisionAuditEntry = {
  id: string;
  auditedAt: string;
  completionActionId: string | null;
  completionAuditId: string | null;
  latestCompletionAction: SandboxCloseoutCompletionActionRecord["latestCompletionAction"];
  latestCompletionActionStatus: SandboxCloseoutCompletionActionRecord["latestCompletionActionStatus"];
  latestCompletionActionReason: string | null;
  latestCompletionActionNote: string | null;
  dispositionSnapshot: SandboxCloseoutCompletionDispositionSummary;
  lifecycleSnapshot: SandboxCloseoutCompletionLifecycle;
  carryForwardQueueSnapshot: SandboxCloseoutCompletionCarryForwardQueue;
  resolutionSnapshot: SandboxCloseoutCompletionResolutionSummary;
  latestIncidentType: string;
  latestIncidentSeverity: string | null;
  latestIncidentSummary: string | null;
  completionFinalized: boolean;
  completionRetained: boolean;
  completionReopened: boolean;
  queueRetainedReasons: string[];
  missingFollowUpSignals: string[];
  missingEvidenceSignals: string[];
  actorSource: string;
  commandSource: string | null;
  summaryLine: string;
};

export type SandboxCloseoutCompletionDecisionAuditTrail = {
  updatedAt: string;
  records: SandboxCloseoutCompletionDecisionAuditEntry[];
};

function buildCompletionDecisionAuditId(
  auditedAt: string,
  action: SandboxCloseoutCompletionActionRecord["latestCompletionAction"],
  disposition: SandboxCloseoutCompletionDispositionSummary["dispositionResult"],
) {
  return `sandbox-closeout-completion-decision-audit:${auditedAt}:${action}:${disposition}`;
}

function resolveTrailPath(configPath: string) {
  return `${path.resolve(configPath)}.closeout-completion-decision-audit.json`;
}

async function loadCompletionDecisionAuditTrail(configPath: string) {
  const trailPath = resolveTrailPath(configPath);
  try {
    const raw = await readFile(trailPath, "utf8");
    return {
      trailPath,
      trail: sandboxCloseoutCompletionDecisionAuditTrailSchema.parse(JSON.parse(raw)),
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return {
        trailPath,
        trail: sandboxCloseoutCompletionDecisionAuditTrailSchema.parse({
          updatedAt: new Date(0).toISOString(),
          records: [],
        }),
      };
    }
    throw error;
  }
}

async function saveCompletionDecisionAuditTrail(
  configPath: string,
  trail: z.infer<typeof sandboxCloseoutCompletionDecisionAuditTrailSchema>,
) {
  const trailPath = resolveTrailPath(configPath);
  await mkdir(path.dirname(trailPath), { recursive: true });
  await writeFile(trailPath, `${JSON.stringify(trail, null, 2)}\n`, "utf8");
  return trailPath;
}

function buildQueueRetainedReasons(params: {
  dispositionSummary: SandboxCloseoutCompletionDispositionSummary;
  lifecycle: SandboxCloseoutCompletionLifecycle;
  carryForwardQueue: SandboxCloseoutCompletionCarryForwardQueue;
  resolutionSummary: SandboxCloseoutCompletionResolutionSummary;
}) {
  const queueRetained =
    params.carryForwardQueue.queueStatus !== "empty" ||
    params.lifecycle.keptCarryForwardOpen ||
    params.lifecycle.carryForwardQueueShouldRemain ||
    !params.lifecycle.carryForwardQueueExitAllowed ||
    params.dispositionSummary.carryForwardRemainsOpen;
  if (!queueRetained) {
    return [];
  }
  return Array.from(
    new Set(
      [
        ...params.dispositionSummary.dispositionWarnings,
        ...params.lifecycle.lifecycleReasons,
        ...params.carryForwardQueue.carryForwardReasons,
        ...params.resolutionSummary.unresolvedCompletionReasons,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function buildMissingFollowUpSignals(params: {
  carryForwardQueue: SandboxCloseoutCompletionCarryForwardQueue;
  resolutionSummary: SandboxCloseoutCompletionResolutionSummary;
}) {
  return Array.from(
    new Set(
      [
        ...(params.carryForwardQueue.followUpOpen
          ? params.carryForwardQueue.carryForwardReasons
          : []),
        ...(params.resolutionSummary.followUpRemainsOpen
          ? params.resolutionSummary.unresolvedCompletionReasons
          : []),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function buildMissingEvidenceSignals(params: {
  carryForwardQueue: SandboxCloseoutCompletionCarryForwardQueue;
  resolutionSummary: SandboxCloseoutCompletionResolutionSummary;
}) {
  return Array.from(
    new Set(
      [
        ...params.carryForwardQueue.missingEvidenceSummary,
        ...params.resolutionSummary.unresolvedCompletionReasons.filter((reason) =>
          /evidence|validate|apply|preview/i.test(reason),
        ),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

export async function appendSandboxCloseoutCompletionDecisionAudit(params: {
  configPath: string;
  actorSource: string;
  commandSource?: string | null;
  completionAction: SandboxCloseoutCompletionActionRecord;
  dispositionSummary: SandboxCloseoutCompletionDispositionSummary;
  completionLifecycle: SandboxCloseoutCompletionLifecycle;
  completionCarryForwardQueue: SandboxCloseoutCompletionCarryForwardQueue;
  completionResolutionSummary: SandboxCloseoutCompletionResolutionSummary;
  latestIncidentType: string;
  latestIncidentSeverity: string | null;
  latestIncidentSummary: string | null;
}) {
  const auditedAt = new Date().toISOString();
  const { trail } = await loadCompletionDecisionAuditTrail(params.configPath);
  const queueRetainedReasons = buildQueueRetainedReasons({
    dispositionSummary: params.dispositionSummary,
    lifecycle: params.completionLifecycle,
    carryForwardQueue: params.completionCarryForwardQueue,
    resolutionSummary: params.completionResolutionSummary,
  });
  const missingFollowUpSignals = buildMissingFollowUpSignals({
    carryForwardQueue: params.completionCarryForwardQueue,
    resolutionSummary: params.completionResolutionSummary,
  });
  const missingEvidenceSignals = buildMissingEvidenceSignals({
    carryForwardQueue: params.completionCarryForwardQueue,
    resolutionSummary: params.completionResolutionSummary,
  });
  const completionFinalized =
    params.completionLifecycle.closeoutCompleteFinalized ||
    params.completionLifecycle.reviewCompleteFinalized;
  const completionRetained =
    params.completionAction.carryForwardRetained ||
    params.completionLifecycle.keptCarryForwardOpen ||
    params.completionCarryForwardQueue.queueStatus !== "empty";
  const completionReopened =
    params.completionAction.completionReopened || params.completionLifecycle.completionReopened;
  const record = sandboxCloseoutCompletionDecisionAuditEntrySchema.parse({
    id: buildCompletionDecisionAuditId(
      auditedAt,
      params.completionAction.latestCompletionAction,
      params.dispositionSummary.dispositionResult,
    ),
    auditedAt,
    completionActionId: params.completionAction.id,
    completionAuditId: params.completionAction.completionAuditId,
    latestCompletionAction: params.completionAction.latestCompletionAction,
    latestCompletionActionStatus: params.completionAction.latestCompletionActionStatus,
    latestCompletionActionReason: params.completionAction.latestCompletionActionReason,
    latestCompletionActionNote: params.completionAction.latestCompletionActionNote,
    dispositionSnapshot: params.dispositionSummary,
    lifecycleSnapshot: params.completionLifecycle,
    carryForwardQueueSnapshot: params.completionCarryForwardQueue,
    resolutionSnapshot: params.completionResolutionSummary,
    latestIncidentType: params.latestIncidentType,
    latestIncidentSeverity: params.latestIncidentSeverity,
    latestIncidentSummary: params.latestIncidentSummary,
    completionFinalized,
    completionRetained,
    completionReopened,
    queueRetainedReasons,
    missingFollowUpSignals,
    missingEvidenceSignals,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    summaryLine:
      completionFinalized && params.completionLifecycle.carryForwardQueueExitAllowed
        ? `Closeout completion decision audit: ${params.completionAction.latestCompletionAction}/${params.completionAction.latestCompletionActionStatus} keeps the thread finalized.`
        : `Closeout completion decision audit: ${params.completionAction.latestCompletionAction}/${params.completionAction.latestCompletionActionStatus} keeps carry-forward ${params.completionCarryForwardQueue.queueStatus}.`,
  });
  const nextTrail = sandboxCloseoutCompletionDecisionAuditTrailSchema.parse({
    updatedAt: auditedAt,
    records: [...trail.records, record].slice(-100),
  });
  await saveCompletionDecisionAuditTrail(params.configPath, nextTrail);
  return record as SandboxCloseoutCompletionDecisionAuditEntry;
}

export async function listSandboxCloseoutCompletionDecisionAudit(params: {
  configPath: string;
  limit?: number;
}) {
  const { trailPath, trail } = await loadCompletionDecisionAuditTrail(params.configPath);
  const limit = Math.max(1, params.limit ?? 20);
  return {
    trailPath,
    records: trail.records.slice(-limit).reverse() as SandboxCloseoutCompletionDecisionAuditEntry[],
  };
}

export function formatSandboxCloseoutCompletionDecisionAudit(params: {
  records: SandboxCloseoutCompletionDecisionAuditEntry[];
}) {
  return [
    "Sandbox closeout completion decision audit",
    ...(params.records.length === 0
      ? ["No closeout completion decision audit records have been captured yet."]
      : params.records.map(
          (record) =>
            `- ${record.auditedAt} ${record.latestCompletionAction}/${record.latestCompletionActionStatus} disposition=${record.dispositionSnapshot.dispositionResult} lifecycle=${record.lifecycleSnapshot.lifecycleStatus} carryForward=${record.carryForwardQueueSnapshot.queueStatus} final=${record.completionFinalized} retained=${record.completionRetained} reopened=${record.completionReopened} :: ${record.summaryLine}`,
        )),
  ].join("\n");
}
