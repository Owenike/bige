import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { buildSandboxGovernanceStatus } from "../sandbox-governance-status";
import {
  listSandboxResolutionAuditLogs,
  type SandboxResolutionAuditLog,
} from "../sandbox-resolution-audit";

export type SandboxResolutionAuditHistory = {
  entries: SandboxResolutionAuditLog[];
  latestEntry: SandboxResolutionAuditLog | null;
  previousEntry: SandboxResolutionAuditLog | null;
  latestCloseoutDecision: SandboxResolutionAuditLog["closeoutDecision"] | "none";
  repeatedCloseoutDecisionPatterns: Array<{
    decision: SandboxResolutionAuditLog["closeoutDecision"];
    count: number;
  }>;
  repeatedBlockedReasons: string[];
  repeatedReviewRequiredReasons: string[];
  repeatedResolvedNotReadyReasons: string[];
  repeatedClosureReadyReasons: string[];
  latestEvidenceSnapshotSummary: string | null;
  latestReadinessSnapshotSummary: string | null;
  latestClosureGatingSnapshotSummary: string | null;
  latestOperatorActionSummary: string | null;
  latestGovernanceWarnings: string[];
  retainedEntryCount: number;
  summaryLine: string;
};

function collectRepeated(items: string[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([item]) => item);
}

export async function buildSandboxResolutionAuditHistory(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  limit?: number;
}) {
  const limit = Math.max(3, params.limit ?? 10);
  const auditTrail = await listSandboxResolutionAuditLogs({
    configPath: params.configPath,
    limit,
  });
  const governance = await buildSandboxGovernanceStatus({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const latestEntry = auditTrail.records[0] ?? null;
  const previousEntry = auditTrail.records[1] ?? null;
  const repeatedCloseoutDecisionPatterns = Array.from(
    auditTrail.records.reduce((map, record) => {
      map.set(record.closeoutDecision, (map.get(record.closeoutDecision) ?? 0) + 1);
      return map;
    }, new Map<SandboxResolutionAuditLog["closeoutDecision"], number>()),
  )
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1])
    .map(([decision, count]) => ({ decision, count }));
  const repeatedBlockedReasons = collectRepeated(
    auditTrail.records.flatMap((record) => record.closeoutBlockedReasons),
  );
  const repeatedReviewRequiredReasons = collectRepeated(
    auditTrail.records
      .filter((record) => record.reviewRequired)
      .flatMap((record) => record.closeoutBlockedReasons),
  );
  const repeatedResolvedNotReadyReasons = collectRepeated(
    auditTrail.records
      .filter((record) => record.closeoutDecision === "resolved_not_ready")
      .flatMap((record) => record.closeoutBlockedReasons),
  );
  const repeatedClosureReadyReasons = collectRepeated(
    auditTrail.records
      .filter((record) => record.closeoutDecision === "closure_ready")
      .flatMap((record) => record.closeoutDecisionReasons),
  );
  const summaryLine =
    latestEntry === null
      ? "No sandbox resolution audit history has been captured yet."
      : `Sandbox resolution audit history: latest=${latestEntry.closeoutDecision}, retained=${auditTrail.records.length}, repeatedBlocked=${repeatedBlockedReasons.join(", ") || "none"}.`;

  return {
    entries: auditTrail.records,
    latestEntry,
    previousEntry,
    latestCloseoutDecision: latestEntry?.closeoutDecision ?? "none",
    repeatedCloseoutDecisionPatterns,
    repeatedBlockedReasons,
    repeatedReviewRequiredReasons,
    repeatedResolvedNotReadyReasons,
    repeatedClosureReadyReasons,
    latestEvidenceSnapshotSummary: latestEntry?.resolutionEvidenceSnapshot.summary ?? null,
    latestReadinessSnapshotSummary: latestEntry?.resolutionReadinessSnapshot.summary ?? null,
    latestClosureGatingSnapshotSummary: latestEntry?.closureGatingDecisionSnapshot.summary ?? null,
    latestOperatorActionSummary:
      latestEntry === null
        ? null
        : `${latestEntry.latestOperatorAction}/${latestEntry.latestOperatorActionStatus}`,
    latestGovernanceWarnings: governance.governanceWarnings,
    retainedEntryCount: auditTrail.records.length,
    summaryLine,
  } satisfies SandboxResolutionAuditHistory;
}

export function formatSandboxResolutionAuditHistory(result: SandboxResolutionAuditHistory) {
  return [
    "Sandbox resolution audit history",
    `Retained entries: ${result.retainedEntryCount}`,
    `Latest decision: ${result.latestCloseoutDecision}`,
    `Latest audit: ${result.latestEntry?.auditedAt ?? "none"} ${result.latestEntry?.summaryLine ?? ""}`.trimEnd(),
    `Previous audit: ${result.previousEntry?.auditedAt ?? "none"} ${result.previousEntry?.summaryLine ?? ""}`.trimEnd(),
    `Repeated decisions: ${result.repeatedCloseoutDecisionPatterns.map((pattern) => `${pattern.decision}x${pattern.count}`).join(", ") || "none"}`,
    `Repeated blocked reasons: ${result.repeatedBlockedReasons.join(" | ") || "none"}`,
    `Repeated review-required reasons: ${result.repeatedReviewRequiredReasons.join(" | ") || "none"}`,
    `Repeated resolved_not_ready reasons: ${result.repeatedResolvedNotReadyReasons.join(" | ") || "none"}`,
    `Repeated closure-ready reasons: ${result.repeatedClosureReadyReasons.join(" | ") || "none"}`,
    `Latest evidence snapshot: ${result.latestEvidenceSnapshotSummary ?? "none"}`,
    `Latest readiness snapshot: ${result.latestReadinessSnapshotSummary ?? "none"}`,
    `Latest gating snapshot: ${result.latestClosureGatingSnapshotSummary ?? "none"}`,
    `Latest operator action: ${result.latestOperatorActionSummary ?? "none"}`,
    `Governance warnings: ${result.latestGovernanceWarnings.join(" | ") || "none"}`,
    `Summary: ${result.summaryLine}`,
  ].join("\n");
}
