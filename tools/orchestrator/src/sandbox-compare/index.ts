import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import { buildSandboxRegistryDiff } from "../sandbox-change-review";
import { buildSandboxImpactSummary, type SandboxImpactSummary } from "../sandbox-impact-summary";
import { listSandboxRestorePoints } from "../sandbox-restore-points";

export type SandboxCompareResult = {
  status: "ready" | "manual_required" | "blocked";
  mode: "current_vs_restore_point" | "restore_point_vs_restore_point";
  leftLabel: string;
  rightLabel: string;
  diffSummary: string[];
  impactSummary: SandboxImpactSummary;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
};

export async function compareSandboxRestorePoints(params: {
  configPath: string;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  restorePointId: string | null;
  compareRestorePointId?: string | null;
}) {
  const trail = await listSandboxRestorePoints({
    configPath: params.configPath,
    limit: 500,
  });
  const left =
    (params.restorePointId ? trail.trail.records.find((record) => record.id === params.restorePointId) : null) ?? null;
  if (!left) {
    return {
      status: "manual_required",
      mode: "current_vs_restore_point",
      leftLabel: "current",
      rightLabel: params.restorePointId ?? "none",
      diffSummary: [],
      impactSummary: buildSandboxImpactSummary({
        diffs: [],
        affectedProfileIds: [],
      }),
      summary: "Sandbox compare requires a valid restore point.",
      failureReason: "sandbox_restore_point_missing",
      suggestedNextAction: "Choose an existing restore point id before compare.",
    } satisfies SandboxCompareResult;
  }

  const leftRegistry = params.compareRestorePointId ? left.previousRegistry : params.loadedRegistry.registry;
  const right =
    params.compareRestorePointId
      ? trail.trail.records.find((record) => record.id === params.compareRestorePointId) ?? null
      : left;
  if (!right) {
    return {
      status: "manual_required",
      mode: "restore_point_vs_restore_point",
      leftLabel: left.id,
      rightLabel: params.compareRestorePointId ?? "none",
      diffSummary: [],
      impactSummary: buildSandboxImpactSummary({
        diffs: [],
        affectedProfileIds: [],
      }),
      summary: "Sandbox compare requires both restore points when comparing restore point A vs B.",
      failureReason: "sandbox_restore_point_compare_missing",
      suggestedNextAction: "Pass a valid --compare-restore-point-id.",
    } satisfies SandboxCompareResult;
  }

  const rightRegistry = right.previousRegistry;
  const diffs = buildSandboxRegistryDiff(leftRegistry, rightRegistry);
  const affectedProfileIds = Array.from(
    new Set([
      ...left.previousProfileSummaries.map((item) => item.profileId ?? "").filter(Boolean),
      ...right.previousProfileSummaries.map((item) => item.profileId ?? "").filter(Boolean),
    ]),
  ).sort();
  const impactSummary = buildSandboxImpactSummary({
    diffs,
    affectedProfileIds,
    defaultProfileId: rightRegistry.defaultProfileId,
  });
  return {
    status: "ready",
    mode: params.compareRestorePointId ? "restore_point_vs_restore_point" : "current_vs_restore_point",
    leftLabel: params.compareRestorePointId ? left.id : "current",
    rightLabel: right.id,
    diffSummary: diffs.map((item) => item.summary),
    impactSummary,
    summary:
      diffs.length === 0
        ? "Sandbox compare found no differences."
        : `Sandbox compare found ${diffs.length} change item(s) across ${affectedProfileIds.length} affected profile(s).`,
    failureReason: null,
    suggestedNextAction:
      diffs.length === 0
        ? "No rollback preview is needed for this compare."
        : "Use the compare summary to decide whether rollback preview, validate, or apply is appropriate.",
  } satisfies SandboxCompareResult;
}

export function formatSandboxCompare(result: SandboxCompareResult) {
  return [
    `Sandbox compare: ${result.status}`,
    `Mode: ${result.mode}`,
    `Left: ${result.leftLabel}`,
    `Right: ${result.rightLabel}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
    ...result.impactSummary.summaryLines.map((line) => `- ${line}`),
  ].join("\n");
}
