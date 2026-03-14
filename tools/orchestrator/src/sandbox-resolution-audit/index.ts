import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SandboxClosureGatingDecision } from "../sandbox-closure-gating";
import type { SandboxResolutionEvidenceSummary } from "../sandbox-resolution-evidence";
import type { SandboxResolutionReadinessSummary } from "../sandbox-resolution-readiness";

const sandboxResolutionAuditLogSchema = z.object({
  id: z.string(),
  auditedAt: z.string(),
  latestIncidentType: z.string(),
  latestIncidentSeverity: z.string().nullable().default(null),
  latestIncidentSummary: z.string().nullable().default(null),
  latestOperatorAction: z.string(),
  latestOperatorActionStatus: z.string(),
  resolutionEvidenceSnapshot: z.unknown(),
  closureGatingDecisionSnapshot: z.unknown(),
  resolutionReadinessSnapshot: z.unknown(),
  closeoutDecision: z.string(),
  closeoutDecisionReasons: z.array(z.string()).default([]),
  closeoutBlockedReasons: z.array(z.string()).default([]),
  reviewRequired: z.boolean().default(false),
  escalationRequired: z.boolean().default(false),
  validationEvidenceRequired: z.boolean().default(false),
  actorSource: z.string(),
  commandSource: z.string().nullable().default(null),
  summaryLine: z.string(),
});

const sandboxResolutionAuditTrailSchema = z.object({
  updatedAt: z.string(),
  records: z.array(sandboxResolutionAuditLogSchema).default([]),
});

export type SandboxResolutionAuditLog = {
  id: string;
  auditedAt: string;
  latestIncidentType: SandboxResolutionReadinessSummary["latestIncidentType"];
  latestIncidentSeverity: SandboxResolutionReadinessSummary["latestIncidentSeverity"];
  latestIncidentSummary: string | null;
  latestOperatorAction: SandboxResolutionReadinessSummary["latestOperatorAction"];
  latestOperatorActionStatus: SandboxResolutionReadinessSummary["latestOperatorActionStatus"];
  resolutionEvidenceSnapshot: SandboxResolutionEvidenceSummary;
  closureGatingDecisionSnapshot: SandboxClosureGatingDecision;
  resolutionReadinessSnapshot: SandboxResolutionReadinessSummary;
  closeoutDecision: SandboxClosureGatingDecision["closureStatus"];
  closeoutDecisionReasons: string[];
  closeoutBlockedReasons: string[];
  reviewRequired: boolean;
  escalationRequired: boolean;
  validationEvidenceRequired: boolean;
  actorSource: string;
  commandSource: string | null;
  summaryLine: string;
};

function buildAuditId(auditedAt: string, latestIncidentType: string, closeoutDecision: string) {
  return `sandbox-resolution-audit:${auditedAt}:${latestIncidentType}:${closeoutDecision}`;
}

function resolveTrailPath(configPath: string) {
  return `${path.resolve(configPath)}.resolution-audit.json`;
}

async function loadAuditTrail(configPath: string) {
  const trailPath = resolveTrailPath(configPath);
  try {
    const raw = await readFile(trailPath, "utf8");
    return {
      trailPath,
      trail: sandboxResolutionAuditTrailSchema.parse(JSON.parse(raw)),
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return {
        trailPath,
        trail: sandboxResolutionAuditTrailSchema.parse({
          updatedAt: new Date(0).toISOString(),
          records: [],
        }),
      };
    }
    throw error;
  }
}

async function saveAuditTrail(configPath: string, trail: z.infer<typeof sandboxResolutionAuditTrailSchema>) {
  const trailPath = resolveTrailPath(configPath);
  await mkdir(path.dirname(trailPath), { recursive: true });
  await writeFile(trailPath, `${JSON.stringify(trail, null, 2)}\n`, "utf8");
  return trailPath;
}

export async function appendSandboxResolutionAuditLog(params: {
  configPath: string;
  actorSource: string;
  commandSource?: string | null;
  resolutionEvidenceSnapshot: SandboxResolutionEvidenceSummary;
  closureGatingDecisionSnapshot: SandboxClosureGatingDecision;
  resolutionReadinessSnapshot: SandboxResolutionReadinessSummary;
}) {
  const auditedAt = new Date().toISOString();
  const { trail } = await loadAuditTrail(params.configPath);
  const closeoutDecisionReasons = Array.from(
    new Set([
      params.resolutionReadinessSnapshot.summary,
      params.closureGatingDecisionSnapshot.summary,
      ...params.resolutionEvidenceSnapshot.evidenceGaps,
    ].filter((value): value is string => Boolean(value))),
  );
  const record = sandboxResolutionAuditLogSchema.parse({
    id: buildAuditId(
      auditedAt,
      params.resolutionReadinessSnapshot.latestIncidentType,
      params.closureGatingDecisionSnapshot.closureStatus,
    ),
    auditedAt,
    latestIncidentType: params.resolutionReadinessSnapshot.latestIncidentType,
    latestIncidentSeverity: params.resolutionReadinessSnapshot.latestIncidentSeverity,
    latestIncidentSummary: params.resolutionReadinessSnapshot.latestIncidentSummary,
    latestOperatorAction: params.resolutionReadinessSnapshot.latestOperatorAction,
    latestOperatorActionStatus: params.resolutionReadinessSnapshot.latestOperatorActionStatus,
    resolutionEvidenceSnapshot: params.resolutionEvidenceSnapshot,
    closureGatingDecisionSnapshot: params.closureGatingDecisionSnapshot,
    resolutionReadinessSnapshot: params.resolutionReadinessSnapshot,
    closeoutDecision: params.closureGatingDecisionSnapshot.closureStatus,
    closeoutDecisionReasons,
    closeoutBlockedReasons: params.closureGatingDecisionSnapshot.blockedReasons,
    reviewRequired:
      params.closureGatingDecisionSnapshot.requestReviewRequired ||
      params.resolutionReadinessSnapshot.manualReviewStillRequired,
    escalationRequired:
      params.closureGatingDecisionSnapshot.escalateRequired ||
      params.resolutionReadinessSnapshot.escalationStillNeeded,
    validationEvidenceRequired: params.closureGatingDecisionSnapshot.rerunValidateRequired,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    summaryLine:
      params.closureGatingDecisionSnapshot.closureAllowed
        ? `Closeout audit: ${params.resolutionReadinessSnapshot.latestIncidentType}/${params.resolutionReadinessSnapshot.latestIncidentSeverity ?? "none"} is closure-ready.`
        : `Closeout audit: ${params.resolutionReadinessSnapshot.latestIncidentType}/${params.resolutionReadinessSnapshot.latestIncidentSeverity ?? "none"} remains ${params.closureGatingDecisionSnapshot.closureStatus}.`,
  });
  const nextTrail = sandboxResolutionAuditTrailSchema.parse({
    updatedAt: auditedAt,
    records: [...trail.records, record].slice(-100),
  });
  await saveAuditTrail(params.configPath, nextTrail);
  return record as SandboxResolutionAuditLog;
}

export async function listSandboxResolutionAuditLogs(params: {
  configPath: string;
  limit?: number;
}) {
  const { trailPath, trail } = await loadAuditTrail(params.configPath);
  const limit = Math.max(1, params.limit ?? 20);
  return {
    trailPath,
    records: trail.records.slice(-limit).reverse() as SandboxResolutionAuditLog[],
  };
}

export function formatSandboxResolutionAuditLogs(params: {
  records: SandboxResolutionAuditLog[];
}) {
  return [
    "Sandbox resolution audit log",
    ...(params.records.length === 0
      ? ["No closeout audit records have been captured yet."]
      : params.records.map(
          (record) =>
            `- ${record.auditedAt} ${record.closeoutDecision} ${record.latestIncidentType}/${record.latestIncidentSeverity ?? "none"} review=${record.reviewRequired} escalate=${record.escalationRequired} validateEvidence=${record.validationEvidenceRequired} :: ${record.summaryLine}`,
        )),
  ].join("\n");
}
