import { listSandboxAuditRecords } from "../sandbox-audit";
import { listSandboxRestorePoints } from "../sandbox-restore-points";

export type SandboxHistoryKind = "all" | "restore_points" | "rollback" | "batch_recovery";

export type SandboxHistoryEntry = {
  kind: "restore_point" | "rollback" | "batch_recovery";
  timestamp: string;
  restorePointId: string | null;
  affectedProfiles: string[];
  source: string;
  result: string;
  summary: string;
  reason: string | null;
  auditId: string | null;
};

export type SandboxHistoryResult = {
  kind: SandboxHistoryKind;
  entries: SandboxHistoryEntry[];
  summary: string;
  restorePointCount: number;
  rollbackCount: number;
  batchRecoveryCount: number;
};

function buildRollbackSummary(entry: SandboxHistoryEntry) {
  return `${entry.timestamp} ${entry.kind} restore=${entry.restorePointId ?? "none"} result=${entry.result} profiles=${entry.affectedProfiles.join(",") || "none"} source=${entry.source} reason=${entry.reason ?? "none"}`;
}

export async function querySandboxHistory(params: {
  configPath: string;
  kind?: SandboxHistoryKind;
  limit?: number;
}) {
  const limit = Math.max(1, params.limit ?? 10);
  const kind = params.kind ?? "all";
  const restorePoints = await listSandboxRestorePoints({
    configPath: params.configPath,
    limit: Math.max(limit, 100),
  });
  const audit = await listSandboxAuditRecords({
    configPath: params.configPath,
    limit: Math.max(limit * 3, 100),
  });

  const restoreEntries: SandboxHistoryEntry[] = restorePoints.trail.records.map((record) => ({
    kind: "restore_point",
    timestamp: record.createdAt,
    restorePointId: record.id,
    affectedProfiles: record.affectedProfileIds,
    source: record.source,
    result: "captured",
    summary: record.diffSummary[0] ?? `Restore point '${record.id}' captured ${record.affectedProfileIds.length} profile(s).`,
    reason: record.reason,
    auditId: null,
  }));

  const rollbackEntries: SandboxHistoryEntry[] = audit.trail.records
    .filter((record) => record.action.startsWith("rollback-") && !/batch-recovery/i.test(record.actorSource))
    .map((record) => ({
      kind: "rollback",
      timestamp: record.changedAt,
      restorePointId: record.restorePointId,
      affectedProfiles: [
        ...(record.previousSummary?.profileId ? [record.previousSummary.profileId] : []),
        ...(record.nextSummary?.profileId ? [record.nextSummary.profileId] : []),
      ],
      source: record.actorSource,
      result: record.decision ?? record.action,
      summary: record.diffSummary[0] ?? `${record.action} ${record.decision ?? "completed"}`,
      reason: record.failureReason,
      auditId: record.id,
    }));

  const batchEntries: SandboxHistoryEntry[] = audit.trail.records
    .filter((record) => /batch-recovery/i.test(record.actorSource))
    .map((record) => ({
      kind: "batch_recovery",
      timestamp: record.changedAt,
      restorePointId: record.restorePointId,
      affectedProfiles: [
        ...(record.previousSummary?.profileId ? [record.previousSummary.profileId] : []),
        ...(record.nextSummary?.profileId ? [record.nextSummary.profileId] : []),
      ],
      source: record.actorSource,
      result: record.decision ?? record.action,
      summary: record.diffSummary[0] ?? `${record.actorSource} ${record.decision ?? "completed"}`,
      reason: record.failureReason,
      auditId: record.id,
    }));

  const selectedEntries =
    kind === "restore_points"
      ? restoreEntries
      : kind === "rollback"
        ? rollbackEntries
        : kind === "batch_recovery"
          ? batchEntries
          : [...restoreEntries, ...rollbackEntries, ...batchEntries];

  const entries = selectedEntries.sort((left, right) => right.timestamp.localeCompare(left.timestamp)).slice(0, limit);
  const result = {
    kind,
    entries,
    summary:
      entries.length === 0
        ? "Sandbox history is empty."
        : `Sandbox history returned ${entries.length} item(s) for ${kind}.`,
    restorePointCount: restoreEntries.length,
    rollbackCount: rollbackEntries.length,
    batchRecoveryCount: batchEntries.length,
  } satisfies SandboxHistoryResult;
  return result;
}

export function formatSandboxHistory(result: SandboxHistoryResult) {
  if (result.entries.length === 0) {
    return `Sandbox history (${result.kind}): none`;
  }
  return [
    `Sandbox history (${result.kind}): restorePoints=${result.restorePointCount} rollbacks=${result.rollbackCount} batchRecovery=${result.batchRecoveryCount}`,
    ...result.entries.map((entry) => `- ${buildRollbackSummary(entry)}`),
  ].join("\n");
}
