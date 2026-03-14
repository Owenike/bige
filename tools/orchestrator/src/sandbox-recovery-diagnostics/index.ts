import type { OrchestratorState } from "../schemas";
import { querySandboxHistory } from "../sandbox-history";
import { inspectSandboxRestorePointRetention } from "../sandbox-restore-retention";

export type SandboxRecoveryDiagnosticsResult = {
  validRestorePointCount: number;
  totalRestorePointCount: number;
  latestRollbackStatus: string | null;
  latestBatchRecoveryStatus: string | null;
  recentIncidentSummaries: string[];
  blockedHotSpots: string[];
  expiredRestorePointIds: string[];
  referencedRestorePointIds: string[];
  summary: string;
  suggestedNextAction: string;
};

export async function buildSandboxRecoveryDiagnostics(params: {
  configPath: string;
  state: OrchestratorState;
  limit?: number;
}) {
  const history = await querySandboxHistory({
    configPath: params.configPath,
    kind: "all",
    limit: Math.max(3, params.limit ?? 10),
  });
  const retention = await inspectSandboxRestorePointRetention({
    configPath: params.configPath,
    state: params.state,
  });

  const latestRollback = history.entries.find((entry) => entry.kind === "rollback") ?? null;
  const latestBatchRecovery = history.entries.find((entry) => entry.kind === "batch_recovery") ?? null;
  const blockedCounter = new Map<string, number>();
  for (const entry of history.entries) {
    if (!["blocked", "manual_required", "failed"].includes(entry.result)) {
      continue;
    }
    for (const profileId of entry.affectedProfiles) {
      blockedCounter.set(profileId, (blockedCounter.get(profileId) ?? 0) + 1);
    }
  }
  const blockedHotSpots = Array.from(blockedCounter.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([profileId, count]) => `${profileId}:${count}`);

  const result = {
    validRestorePointCount: retention.validCount,
    totalRestorePointCount: retention.totalCount,
    latestRollbackStatus: latestRollback?.result ?? null,
    latestBatchRecoveryStatus: latestBatchRecovery?.result ?? null,
    recentIncidentSummaries: history.entries.slice(0, Math.max(3, params.limit ?? 10)).map((entry) => entry.summary),
    blockedHotSpots,
    expiredRestorePointIds: retention.expiredRestorePointIds,
    referencedRestorePointIds: retention.protectedRestorePointIds,
    summary: `Sandbox recovery diagnostics: valid restore points ${retention.validCount}/${retention.totalCount}, latest rollback ${latestRollback?.result ?? "none"}, latest batch recovery ${latestBatchRecovery?.result ?? "none"}.`,
    suggestedNextAction:
      latestRollback?.result === "blocked" || latestRollback?.result === "manual_required"
        ? "Inspect rollback governance or compare the restore point before retrying rollback."
        : blockedHotSpots.length > 0
          ? "Inspect the blocked/manual_required hotspot profiles before the next recovery attempt."
          : retention.validCount === 0
            ? "Create a fresh restore point before the next sandbox apply."
            : "Use sandbox:compare or sandbox:rollback:preview if you want a recovery dry run.",
  } satisfies SandboxRecoveryDiagnosticsResult;
  return result;
}

export function formatSandboxRecoveryDiagnostics(result: SandboxRecoveryDiagnosticsResult) {
  return [
    `Sandbox recovery diagnostics`,
    `Valid restore points: ${result.validRestorePointCount}/${result.totalRestorePointCount}`,
    `Latest rollback: ${result.latestRollbackStatus ?? "none"}`,
    `Latest batch recovery: ${result.latestBatchRecoveryStatus ?? "none"}`,
    `Blocked hotspots: ${result.blockedHotSpots.join(", ") || "none"}`,
    `Expired restore points: ${result.expiredRestorePointIds.join(", ") || "none"}`,
    `Referenced restore points: ${result.referencedRestorePointIds.join(", ") || "none"}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.suggestedNextAction}`,
    ...(result.recentIncidentSummaries.length > 0
      ? ["Recent incidents:", ...result.recentIncidentSummaries.map((item) => `- ${item}`)]
      : []),
  ].join("\n");
}
