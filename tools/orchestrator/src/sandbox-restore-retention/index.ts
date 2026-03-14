import type { OrchestratorState, SandboxRestorePoint } from "../schemas";
import { listSandboxAuditRecords } from "../sandbox-audit";
import {
  formatSandboxRestorePoint,
  loadSandboxRestorePointTrail,
  resolveSandboxRestorePointsPath,
  saveSandboxRestorePointTrail,
} from "../sandbox-restore-points";

export type SandboxRestorePointRetentionResult = {
  status: "ready" | "pruned" | "blocked" | "manual_required" | "failed";
  totalCount: number;
  validCount: number;
  protectedRestorePointIds: string[];
  prunedRestorePointIds: string[];
  summary: string;
  suggestedNextAction: string;
};

function resolveRetentionCount(explicitCount?: number) {
  if (typeof explicitCount === "number" && Number.isFinite(explicitCount) && explicitCount > 0) {
    return explicitCount;
  }
  const envValue = process.env.ORCHESTRATOR_SANDBOX_RESTORE_RETAIN_COUNT;
  if (!envValue) {
    return 10;
  }
  const parsed = Number.parseInt(envValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function resolveRetentionAgeHours(explicitMaxAgeHours?: number) {
  if (typeof explicitMaxAgeHours === "number" && Number.isFinite(explicitMaxAgeHours) && explicitMaxAgeHours > 0) {
    return explicitMaxAgeHours;
  }
  const envValue = process.env.ORCHESTRATOR_SANDBOX_RESTORE_RETENTION_HOURS;
  if (!envValue) {
    return 24 * 30;
  }
  const parsed = Number.parseInt(envValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24 * 30;
}

function isExpired(record: SandboxRestorePoint, maxAgeHours: number) {
  const ageMs = Date.now() - Date.parse(record.createdAt);
  return Number.isFinite(ageMs) && ageMs > maxAgeHours * 60 * 60 * 1000;
}

function summarizeProtectedRestorePointIds(records: SandboxRestorePoint[], state: OrchestratorState, retainRecent: number) {
  const protectedIds = new Set<string>();
  const recentRecords = records.slice(-retainRecent);
  for (const record of recentRecords) {
    protectedIds.add(record.id);
  }
  const latest = records[records.length - 1];
  if (latest) {
    protectedIds.add(latest.id);
  }
  if (state.lastRestorePointId) {
    protectedIds.add(state.lastRestorePointId);
  }
  return protectedIds;
}

export async function inspectSandboxRestorePointRetention(params: {
  configPath: string;
  state: OrchestratorState;
  retainRecent?: number;
  maxAgeHours?: number;
}) {
  const restorePointsPath = resolveSandboxRestorePointsPath(params.configPath);
  const trail = await loadSandboxRestorePointTrail(restorePointsPath);
  const retainRecent = resolveRetentionCount(params.retainRecent);
  const maxAgeHours = resolveRetentionAgeHours(params.maxAgeHours);
  const protectedIds = summarizeProtectedRestorePointIds(trail.records, params.state, retainRecent);

  const auditTrail = await listSandboxAuditRecords({
    configPath: params.configPath,
    limit: 200,
  });
  for (const record of auditTrail.records) {
    if (record.restorePointId) {
      protectedIds.add(record.restorePointId);
    }
  }

  const expiredRecords = trail.records.filter((record) => isExpired(record, maxAgeHours));
  const validCount = trail.records.filter((record) => !isExpired(record, maxAgeHours) || protectedIds.has(record.id)).length;

  return {
    restorePointsPath,
    trail,
    retainRecent,
    maxAgeHours,
    protectedRestorePointIds: Array.from(protectedIds).sort(),
    expiredRestorePointIds: expiredRecords.map((record) => record.id).sort(),
    totalCount: trail.records.length,
    validCount,
  };
}

export async function pruneSandboxRestorePoints(params: {
  configPath: string;
  state: OrchestratorState;
  retainRecent?: number;
  maxAgeHours?: number;
}) {
  const inspection = await inspectSandboxRestorePointRetention(params);
  const prunable = inspection.trail.records.filter(
    (record) => !inspection.protectedRestorePointIds.includes(record.id) && inspection.expiredRestorePointIds.includes(record.id),
  );
  if (prunable.length === 0) {
    return {
      status: "ready",
      totalCount: inspection.totalCount,
      validCount: inspection.validCount,
      protectedRestorePointIds: inspection.protectedRestorePointIds,
      prunedRestorePointIds: [],
      summary: `Sandbox restore point retention found nothing to prune. Valid restore points: ${inspection.validCount}/${inspection.totalCount}.`,
      suggestedNextAction: inspection.totalCount === 0 ? "Create a new restore point before the next sandbox apply." : "No retention cleanup is needed right now.",
    } satisfies SandboxRestorePointRetentionResult;
  }

  const nextRecords = inspection.trail.records.filter((record) => !prunable.some((candidate) => candidate.id === record.id));
  await saveSandboxRestorePointTrail(
    inspection.restorePointsPath,
    {
      updatedAt: new Date().toISOString(),
      records: nextRecords,
    },
  );
  return {
    status: "pruned",
    totalCount: nextRecords.length,
    validCount: nextRecords.filter((record) => !isExpired(record, inspection.maxAgeHours) || inspection.protectedRestorePointIds.includes(record.id)).length,
    protectedRestorePointIds: inspection.protectedRestorePointIds,
    prunedRestorePointIds: prunable.map((record) => record.id),
    summary: `Sandbox restore point retention pruned ${prunable.length} expired restore point(s).`,
    suggestedNextAction: nextRecords.length === 0 ? "Create a fresh restore point before the next sandbox apply." : "Inspect the remaining restore points if you need a specific rollback target.",
  } satisfies SandboxRestorePointRetentionResult;
}

export function formatSandboxRestoreRetentionSummary(result: SandboxRestorePointRetentionResult) {
  return [
    `Sandbox restore retention: ${result.status}`,
    `Valid restore points: ${result.validCount}/${result.totalCount}`,
    `Protected restore points: ${result.protectedRestorePointIds.join(", ") || "none"}`,
    `Pruned restore points: ${result.prunedRestorePointIds.join(", ") || "none"}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.suggestedNextAction}`,
  ].join("\n");
}

export function formatSandboxRestorePointList(records: SandboxRestorePoint[]) {
  if (records.length === 0) {
    return "Sandbox restore points: none";
  }
  return ["Sandbox restore points:", ...records.map((record) => `- ${formatSandboxRestorePoint(record)}`)].join("\n");
}
