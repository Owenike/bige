import type { SandboxDiffItem } from "../sandbox-change-review";

export type SandboxImpactSummary = {
  profileCount: number;
  affectedProfileIds: string[];
  changedFields: string[];
  blockedProfileIds: string[];
  manualRequiredProfileIds: string[];
  defaultProfileImpact: string | null;
  summaryLines: string[];
  summaryText: string;
};

export function buildSandboxImpactSummary(params: {
  diffs: SandboxDiffItem[];
  affectedProfileIds: string[];
  blockedProfileIds?: string[];
  manualRequiredProfileIds?: string[];
  defaultProfileId?: string | null;
}) {
  const blockedProfileIds = Array.from(new Set(params.blockedProfileIds ?? [])).sort();
  const manualRequiredProfileIds = Array.from(new Set(params.manualRequiredProfileIds ?? [])).sort();
  const changedFields = Array.from(new Set(params.diffs.flatMap((item) => item.changedFields))).sort();
  const defaultProfileImpact =
    params.diffs.find((item) => item.action === "set_default")?.summary ??
    (params.defaultProfileId && params.affectedProfileIds.includes(params.defaultProfileId)
      ? `Default profile '${params.defaultProfileId}' is included in the batch change.`
      : null);
  const summaryLines = [
    `Affected profiles: ${params.affectedProfileIds.length}`,
    `Changed fields: ${changedFields.join(", ") || "none"}`,
    `Blocked profiles: ${blockedProfileIds.join(", ") || "none"}`,
    `Manual required profiles: ${manualRequiredProfileIds.join(", ") || "none"}`,
    `Default profile impact: ${defaultProfileImpact ?? "none"}`,
  ];
  return {
    profileCount: params.affectedProfileIds.length,
    affectedProfileIds: params.affectedProfileIds,
    changedFields,
    blockedProfileIds,
    manualRequiredProfileIds,
    defaultProfileImpact,
    summaryLines,
    summaryText: summaryLines.join(" | "),
  } satisfies SandboxImpactSummary;
}

export function formatSandboxImpactSummary(summary: SandboxImpactSummary) {
  return [
    `Sandbox impact summary: profiles=${summary.profileCount}`,
    `Changed fields: ${summary.changedFields.join(", ") || "none"}`,
    `Blocked profiles: ${summary.blockedProfileIds.join(", ") || "none"}`,
    `Manual required profiles: ${summary.manualRequiredProfileIds.join(", ") || "none"}`,
    `Default profile impact: ${summary.defaultProfileImpact ?? "none"}`,
  ].join("\n");
}
