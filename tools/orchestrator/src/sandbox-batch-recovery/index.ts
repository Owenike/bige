import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState, SandboxRestorePoint } from "../schemas";
import { applySandboxRegistryChange, buildSandboxRegistryDiff, reviewSandboxRegistryChange } from "../sandbox-change-review";
import { buildSandboxImpactSummary, type SandboxImpactSummary } from "../sandbox-impact-summary";
import { listSandboxRestorePoints } from "../sandbox-restore-points";
import { evaluateSandboxRollbackGovernance } from "../sandbox-rollback-governance";

export type SandboxBatchRecoveryStatus =
  | "previewed"
  | "validated"
  | "restored"
  | "partially_restored"
  | "blocked"
  | "manual_required"
  | "failed"
  | "no_op";

export type SandboxBatchRecoveryResult = {
  status: SandboxBatchRecoveryStatus;
  mode: "preview" | "validate" | "apply";
  restorePointIds: string[];
  affectedProfileIds: string[];
  blockedProfileIds: string[];
  manualRequiredProfileIds: string[];
  diffSummary: string[];
  impactSummary: SandboxImpactSummary;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  governanceStatus: "ready" | "blocked" | "manual_required";
  guardrailsStatus: "ready" | "blocked" | "manual_required";
  restorePointCoverage: string[];
  appliedRegistry: LoadedGitHubSandboxTargetRegistry["registry"] | null;
  restorePointId: string | null;
  restorePointSummary: string | null;
  auditId: string | null;
};

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function selectRestorePointsForProfiles(records: SandboxRestorePoint[], profileIds: string[]) {
  const selected = new Map<string, SandboxRestorePoint>();
  for (const profileId of profileIds) {
    const match = [...records].reverse().find((record) => record.affectedProfileIds.includes(profileId));
    if (match) {
      selected.set(match.id, match);
    }
  }
  return Array.from(selected.values());
}

function applyRestorePointToRegistry(
  registry: LoadedGitHubSandboxTargetRegistry["registry"],
  restorePoint: SandboxRestorePoint,
) {
  const next = JSON.parse(JSON.stringify(registry)) as LoadedGitHubSandboxTargetRegistry["registry"];
  for (const profileId of restorePoint.affectedProfileIds) {
    const previousProfile = restorePoint.previousRegistry.profiles[profileId];
    if (previousProfile) {
      next.profiles[profileId] = previousProfile;
      continue;
    }
    delete next.profiles[profileId];
  }
  const defaultWasImpacted =
    restorePoint.diffSummary.some((summary) => /default sandbox profile/i.test(summary)) ||
    (restorePoint.previousDefaultProfileId !== next.defaultProfileId &&
      (restorePoint.affectedProfileIds.includes(next.defaultProfileId ?? "") ||
        restorePoint.affectedProfileIds.includes(restorePoint.previousDefaultProfileId ?? "")));
  if (defaultWasImpacted) {
    next.defaultProfileId = restorePoint.previousDefaultProfileId;
  }
  return next;
}

export async function runSandboxBatchRecovery(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  restorePointIds?: string[];
  profileIds?: string[];
  mode: "preview" | "validate" | "apply";
  allowPartial?: boolean;
  actorSource: string;
  commandSource?: string | null;
}) {
  const restoreTrail = await listSandboxRestorePoints({
    configPath: params.configPath,
    limit: 500,
  });
  const explicitRestorePointIds = uniq(params.restorePointIds ?? []);
  const explicitProfileIds = uniq(params.profileIds ?? []);
  const selectedRestorePoints =
    explicitRestorePointIds.length > 0
      ? restoreTrail.trail.records.filter((record) => explicitRestorePointIds.includes(record.id))
      : selectRestorePointsForProfiles(restoreTrail.trail.records, explicitProfileIds);
  const missingExplicitRestorePointIds =
    explicitRestorePointIds.length > 0
      ? explicitRestorePointIds.filter((restorePointId) => !selectedRestorePoints.some((record) => record.id === restorePointId))
      : [];

  if (selectedRestorePoints.length === 0 || missingExplicitRestorePointIds.length > 0) {
    const impactSummary = buildSandboxImpactSummary({
      diffs: [],
      affectedProfileIds: [],
    });
    return {
      status: "manual_required",
      mode: params.mode,
      restorePointIds: [],
      affectedProfileIds: [],
      blockedProfileIds: [],
      manualRequiredProfileIds: [],
      diffSummary: [],
      impactSummary,
      summary:
        missingExplicitRestorePointIds.length > 0
          ? `Sandbox batch recovery could not find restore points: ${missingExplicitRestorePointIds.join(", ")}.`
          : "Sandbox batch recovery requires one or more restore points or profiles with restore-point coverage.",
      failureReason:
        missingExplicitRestorePointIds.length > 0 ? "sandbox_restore_point_missing" : "sandbox_batch_recovery_targets_required",
      suggestedNextAction:
        missingExplicitRestorePointIds.length > 0
          ? "Choose existing restore points before batch recovery preview/validate/apply."
          : "Pass --restore-point-ids or --sandbox-profiles before batch recovery preview/validate/apply.",
      governanceStatus: "manual_required",
      guardrailsStatus: "manual_required",
      restorePointCoverage:
        missingExplicitRestorePointIds.length > 0
          ? missingExplicitRestorePointIds.map((restorePointId) => `${restorePointId}: missing`)
          : [],
      appliedRegistry: null,
      restorePointId: null,
      restorePointSummary: null,
      auditId: null,
    } satisfies SandboxBatchRecoveryResult;
  }

  const blockedProfileIds: string[] = [];
  const manualRequiredProfileIds: string[] = [];
  const coverageLines: string[] = [];
  let proposedRegistry = JSON.parse(JSON.stringify(params.loadedRegistry.registry)) as LoadedGitHubSandboxTargetRegistry["registry"];
  let governanceStatus: "ready" | "blocked" | "manual_required" = "ready";

  for (const restorePoint of selectedRestorePoints) {
    const governance = await evaluateSandboxRollbackGovernance({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      restorePoint,
      actorSource: `${params.actorSource}:batch-recovery`,
      commandSource: params.commandSource ?? null,
    });
    coverageLines.push(`${restorePoint.id}: ${governance.status} (${governance.affectedProfileIds.join(", ") || "none"})`);
    if (governance.status !== "ready") {
      if (governance.status === "blocked") {
        blockedProfileIds.push(...governance.affectedProfileIds);
        governanceStatus = "blocked";
      } else {
        manualRequiredProfileIds.push(...governance.affectedProfileIds);
        if (governanceStatus !== "blocked") {
          governanceStatus = "manual_required";
        }
      }
      if (!params.allowPartial) {
        continue;
      }
    } else {
      proposedRegistry = applyRestorePointToRegistry(proposedRegistry, restorePoint);
    }
  }

  const diffs = buildSandboxRegistryDiff(params.loadedRegistry.registry, proposedRegistry);
  const affectedProfileIds = uniq(selectedRestorePoints.flatMap((record) => record.affectedProfileIds));
  const impactSummary = buildSandboxImpactSummary({
    diffs,
    affectedProfileIds,
    blockedProfileIds: uniq(blockedProfileIds),
    manualRequiredProfileIds: uniq(manualRequiredProfileIds),
    defaultProfileId: params.loadedRegistry.registry.defaultProfileId,
  });
  const diffSummary = diffs.map((item) => item.summary);

  if (diffSummary.length === 0 && affectedProfileIds.length > 0) {
    return {
      status: "no_op",
      mode: params.mode,
      restorePointIds: selectedRestorePoints.map((record) => record.id),
      affectedProfileIds,
      blockedProfileIds: uniq(blockedProfileIds),
      manualRequiredProfileIds: uniq(manualRequiredProfileIds),
      diffSummary,
      impactSummary,
      summary: "Sandbox batch recovery is a no-op because the current registry already matches the selected restore points.",
      failureReason: null,
      suggestedNextAction: "No rollback apply is needed.",
      governanceStatus,
      guardrailsStatus: governanceStatus === "ready" ? "ready" : governanceStatus,
      restorePointCoverage: coverageLines,
      appliedRegistry: params.loadedRegistry.registry,
      restorePointId: null,
      restorePointSummary: null,
      auditId: null,
    } satisfies SandboxBatchRecoveryResult;
  }

  const review = await reviewSandboxRegistryChange({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    proposedRegistry,
    actorSource: `${params.actorSource}:batch-recovery`,
    commandSource: params.commandSource ?? null,
    recordAudit: params.mode === "validate",
  });

  if (params.mode === "preview") {
    return {
      status: "previewed",
      mode: params.mode,
      restorePointIds: selectedRestorePoints.map((record) => record.id),
      affectedProfileIds,
      blockedProfileIds: uniq(blockedProfileIds),
      manualRequiredProfileIds: uniq(manualRequiredProfileIds),
      diffSummary,
      impactSummary,
      summary:
        governanceStatus === "ready"
          ? `Sandbox batch recovery preview prepared ${affectedProfileIds.length} profile(s).`
          : "Sandbox batch recovery preview found blocked/manual_required restore points.",
      failureReason: governanceStatus === "ready" ? null : review.failureReason ?? "sandbox_batch_recovery_governance_failed",
      suggestedNextAction:
        governanceStatus === "ready"
          ? "Run sandbox:batch-recovery:validate or sandbox:batch-recovery:apply after reviewing the rollback impact summary."
          : "Resolve the blocked/manual_required restore points or re-run with --allow-partial true if partial recovery is intended.",
      governanceStatus,
      guardrailsStatus: review.guardrailsStatus,
      restorePointCoverage: coverageLines,
      appliedRegistry: null,
      restorePointId: null,
      restorePointSummary: null,
      auditId: review.auditId,
    } satisfies SandboxBatchRecoveryResult;
  }

  if (review.status !== "ready") {
    return {
      status: review.status,
      mode: params.mode,
      restorePointIds: selectedRestorePoints.map((record) => record.id),
      affectedProfileIds,
      blockedProfileIds: uniq(blockedProfileIds),
      manualRequiredProfileIds: uniq(manualRequiredProfileIds),
      diffSummary,
      impactSummary,
      summary: review.summary,
      failureReason: review.failureReason,
      suggestedNextAction: review.suggestedNextAction,
      governanceStatus,
      guardrailsStatus: review.guardrailsStatus,
      restorePointCoverage: coverageLines,
      appliedRegistry: null,
      restorePointId: null,
      restorePointSummary: null,
      auditId: review.auditId,
    } satisfies SandboxBatchRecoveryResult;
  }

  if (params.mode === "validate") {
    return {
      status: "validated",
      mode: params.mode,
      restorePointIds: selectedRestorePoints.map((record) => record.id),
      affectedProfileIds,
      blockedProfileIds: uniq(blockedProfileIds),
      manualRequiredProfileIds: uniq(manualRequiredProfileIds),
      diffSummary,
      impactSummary,
      summary:
        governanceStatus === "ready"
          ? `Sandbox batch recovery validation passed for ${affectedProfileIds.length} profile(s).`
          : "Sandbox batch recovery validation passed for partial restore coverage; some profiles still need operator attention.",
      failureReason: null,
      suggestedNextAction:
        governanceStatus === "ready"
          ? "Run sandbox:batch-recovery:apply when you are ready to restore the selected profiles."
          : "Fix the blocked/manual_required restore points or re-run with --allow-partial true before apply.",
      governanceStatus,
      guardrailsStatus: review.guardrailsStatus,
      restorePointCoverage: coverageLines,
      appliedRegistry: null,
      restorePointId: null,
      restorePointSummary: null,
      auditId: review.auditId,
    } satisfies SandboxBatchRecoveryResult;
  }

  if (!params.allowPartial && governanceStatus !== "ready") {
    return {
      status: governanceStatus,
      mode: params.mode,
      restorePointIds: selectedRestorePoints.map((record) => record.id),
      affectedProfileIds,
      blockedProfileIds: uniq(blockedProfileIds),
      manualRequiredProfileIds: uniq(manualRequiredProfileIds),
      diffSummary,
      impactSummary,
      summary: "Sandbox batch recovery apply stopped because some restore points failed governance and allowPartial is disabled.",
      failureReason: governanceStatus === "blocked" ? "sandbox_batch_recovery_blocked" : "sandbox_batch_recovery_manual_required",
      suggestedNextAction: "Resolve the blocked/manual_required restore points or re-run with --allow-partial true if partial recovery is acceptable.",
      governanceStatus,
      guardrailsStatus: review.guardrailsStatus,
      restorePointCoverage: coverageLines,
      appliedRegistry: null,
      restorePointId: null,
      restorePointSummary: null,
      auditId: review.auditId,
    } satisfies SandboxBatchRecoveryResult;
  }

  const applied = await applySandboxRegistryChange({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    proposedRegistry,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    applySource: "rollback",
    auditAction: "rollback-apply",
  });
  if (applied.status !== "ready" || !applied.appliedRegistry) {
    return {
      status: applied.status,
      mode: params.mode,
      restorePointIds: selectedRestorePoints.map((record) => record.id),
      affectedProfileIds,
      blockedProfileIds: uniq(blockedProfileIds),
      manualRequiredProfileIds: uniq(manualRequiredProfileIds),
      diffSummary,
      impactSummary,
      summary: applied.summary,
      failureReason: applied.failureReason,
      suggestedNextAction: applied.suggestedNextAction,
      governanceStatus,
      guardrailsStatus: review.guardrailsStatus,
      restorePointCoverage: coverageLines,
      appliedRegistry: null,
      restorePointId: applied.restorePointId ?? null,
      restorePointSummary: applied.restorePointSummary ?? null,
      auditId: applied.applyAuditId ?? applied.auditId,
    } satisfies SandboxBatchRecoveryResult;
  }

  return {
    status:
      governanceStatus === "ready" || (!blockedProfileIds.length && !manualRequiredProfileIds.length)
        ? "restored"
        : "partially_restored",
    mode: params.mode,
    restorePointIds: selectedRestorePoints.map((record) => record.id),
    affectedProfileIds,
    blockedProfileIds: uniq(blockedProfileIds),
    manualRequiredProfileIds: uniq(manualRequiredProfileIds),
    diffSummary,
    impactSummary,
    summary:
      governanceStatus === "ready" || (!blockedProfileIds.length && !manualRequiredProfileIds.length)
        ? `Sandbox batch recovery restored ${affectedProfileIds.length} profile(s).`
        : "Sandbox batch recovery applied partial restores; some profiles still require operator attention.",
    failureReason: null,
    suggestedNextAction:
      governanceStatus === "ready"
        ? "Review the restored sandbox profiles or run sandbox:rollback:validate for a post-restore check."
        : "Review the blocked/manual_required profiles before attempting another batch recovery.",
    governanceStatus,
    guardrailsStatus: review.guardrailsStatus,
    restorePointCoverage: coverageLines,
    appliedRegistry: applied.appliedRegistry,
    restorePointId: applied.restorePointId ?? null,
    restorePointSummary: applied.restorePointSummary ?? null,
    auditId: applied.applyAuditId ?? applied.auditId,
  } satisfies SandboxBatchRecoveryResult;
}

export function summarizeSandboxBatchRecovery(result: SandboxBatchRecoveryResult) {
  return [
    `Sandbox batch recovery: ${result.status}`,
    `Mode: ${result.mode}`,
    `Restore points: ${result.restorePointIds.join(", ") || "none"}`,
    `Affected profiles: ${result.affectedProfileIds.join(", ") || "none"}`,
    `Blocked profiles: ${result.blockedProfileIds.join(", ") || "none"}`,
    `Manual required profiles: ${result.manualRequiredProfileIds.join(", ") || "none"}`,
    `Governance: ${result.governanceStatus}`,
    `Guardrails: ${result.guardrailsStatus}`,
    `Summary: ${result.summary}`,
    `Next action: ${result.suggestedNextAction}`,
  ].join("\n");
}
