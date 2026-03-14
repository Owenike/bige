import { appendSandboxAuditRecord } from "../sandbox-audit";
import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import { buildSandboxImpactSummary, type SandboxImpactSummary } from "../sandbox-impact-summary";
import type { OrchestratorState } from "../schemas";
import { listSandboxRestorePoints } from "../sandbox-restore-points";
import { applySandboxRegistryChange, buildSandboxRegistryDiff, reviewSandboxRegistryChange } from "../sandbox-change-review";

export type SandboxRollbackResult = {
  status: "previewed" | "validated" | "restored" | "partially_restored" | "blocked" | "manual_required" | "failed" | "no_op";
  mode: "preview" | "validate" | "apply";
  restorePointId: string | null;
  affectedProfileIds: string[];
  blockedProfileIds: string[];
  manualRequiredProfileIds: string[];
  diffSummary: string[];
  impactSummary: SandboxImpactSummary;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  auditId: string | null;
  appliedRegistry: LoadedGitHubSandboxTargetRegistry["registry"] | null;
};

export async function runSandboxRollback(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  restorePointId?: string | null;
  mode: "preview" | "validate" | "apply";
  actorSource: string;
  commandSource?: string | null;
}) {
  const restorePoints = await listSandboxRestorePoints({
    configPath: params.configPath,
    limit: 20,
  });
  const restorePoint =
    (params.restorePointId
      ? restorePoints.trail.records.find((record) => record.id === params.restorePointId)
      : restorePoints.records[0]) ?? null;

  if (!restorePoint) {
    const impactSummary = buildSandboxImpactSummary({
      diffs: [],
      affectedProfileIds: [],
    });
    return {
      status: "manual_required",
      mode: params.mode,
      restorePointId: null,
      affectedProfileIds: [],
      blockedProfileIds: [],
      manualRequiredProfileIds: [],
      diffSummary: [],
      impactSummary,
      summary: "Sandbox rollback requires an existing restore point.",
      failureReason: "sandbox_restore_point_missing",
      suggestedNextAction: "Create or inspect restore points before running rollback preview/validate/apply.",
      auditId: null,
      appliedRegistry: null,
    } satisfies SandboxRollbackResult;
  }

  const proposedRegistry = restorePoint.previousRegistry;
  const diffs = buildSandboxRegistryDiff(params.loadedRegistry.registry, proposedRegistry);
  const diffSummary = diffs.map((item) => item.summary);
  const affectedProfileIds = Array.from(new Set(restorePoint.affectedProfileIds)).sort();
  const impactSummary = buildSandboxImpactSummary({
    diffs,
    affectedProfileIds,
    defaultProfileId: params.loadedRegistry.registry.defaultProfileId,
  });

  if (diffSummary.length === 0) {
    const audit = await appendSandboxAuditRecord({
      configPath: params.configPath,
      action:
        params.mode === "preview"
          ? "rollback-preview"
          : params.mode === "validate"
            ? "rollback-validate"
            : "rollback-apply",
      profileId: null,
      previousRegistry: params.loadedRegistry.registry,
      nextRegistry: proposedRegistry,
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? null,
      restorePointId: restorePoint.id,
      rollbackMode: params.mode,
      decision: "no_op",
      diffSummary,
    });
    return {
      status: "no_op",
      mode: params.mode,
      restorePointId: restorePoint.id,
      affectedProfileIds,
      blockedProfileIds: [],
      manualRequiredProfileIds: [],
      diffSummary,
      impactSummary,
      summary: "Sandbox rollback is a no-op because the registry already matches the restore point.",
      failureReason: null,
      suggestedNextAction: "No rollback apply is needed.",
      auditId: audit.record.id,
      appliedRegistry: params.loadedRegistry.registry,
    } satisfies SandboxRollbackResult;
  }

  const review = await reviewSandboxRegistryChange({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    proposedRegistry,
    actorSource: `${params.actorSource}:rollback`,
    commandSource: params.commandSource ?? null,
    recordAudit: false,
  });

  const blockedProfileIds =
    review.status === "blocked" ? affectedProfileIds : [];
  const manualRequiredProfileIds =
    review.status === "manual_required" ? affectedProfileIds : [];

  if (params.mode === "preview") {
    const audit = await appendSandboxAuditRecord({
      configPath: params.configPath,
      action: "rollback-preview",
      profileId: null,
      previousRegistry: params.loadedRegistry.registry,
      nextRegistry: proposedRegistry,
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? null,
      restorePointId: restorePoint.id,
      rollbackMode: "preview",
      decision: "previewed",
      diffSummary,
      failureReason: review.failureReason,
    });
    return {
      status: "previewed",
      mode: params.mode,
      restorePointId: restorePoint.id,
      affectedProfileIds,
      blockedProfileIds,
      manualRequiredProfileIds,
      diffSummary,
      impactSummary,
      summary:
        review.status === "ready"
          ? `Sandbox rollback preview prepared ${affectedProfileIds.length} profile(s).`
          : review.summary,
      failureReason: review.failureReason,
      suggestedNextAction:
        review.status === "ready"
          ? "Run sandbox:rollback:validate or sandbox:rollback:apply after reviewing the rollback impact summary."
          : review.suggestedNextAction,
      auditId: audit.record.id,
      appliedRegistry: null,
    } satisfies SandboxRollbackResult;
  }

  if (review.status !== "ready") {
    const audit = await appendSandboxAuditRecord({
      configPath: params.configPath,
      action: params.mode === "validate" ? "rollback-validate" : "rollback-apply",
      profileId: null,
      previousRegistry: params.loadedRegistry.registry,
      nextRegistry: proposedRegistry,
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? null,
      restorePointId: restorePoint.id,
      rollbackMode: params.mode,
      decision: review.status,
      diffSummary,
      failureReason: review.failureReason,
    });
    return {
      status: review.status,
      mode: params.mode,
      restorePointId: restorePoint.id,
      affectedProfileIds,
      blockedProfileIds,
      manualRequiredProfileIds,
      diffSummary,
      impactSummary,
      summary: review.summary,
      failureReason: review.failureReason,
      suggestedNextAction: review.suggestedNextAction,
      auditId: audit.record.id,
      appliedRegistry: null,
    } satisfies SandboxRollbackResult;
  }

  if (params.mode === "validate") {
    const audit = await appendSandboxAuditRecord({
      configPath: params.configPath,
      action: "rollback-validate",
      profileId: null,
      previousRegistry: params.loadedRegistry.registry,
      nextRegistry: proposedRegistry,
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? null,
      restorePointId: restorePoint.id,
      rollbackMode: "validate",
      decision: "validated",
      diffSummary,
    });
    return {
      status: "validated",
      mode: params.mode,
      restorePointId: restorePoint.id,
      affectedProfileIds,
      blockedProfileIds: [],
      manualRequiredProfileIds: [],
      diffSummary,
      impactSummary,
      summary: `Sandbox rollback validation passed for ${affectedProfileIds.length} profile(s).`,
      failureReason: null,
      suggestedNextAction: "Run sandbox:rollback:apply when you are ready to restore the recorded state.",
      auditId: audit.record.id,
      appliedRegistry: null,
    } satisfies SandboxRollbackResult;
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
      restorePointId: restorePoint.id,
      affectedProfileIds,
      blockedProfileIds: applied.status === "blocked" ? affectedProfileIds : [],
      manualRequiredProfileIds: applied.status === "manual_required" ? affectedProfileIds : [],
      diffSummary,
      impactSummary,
      summary: applied.summary,
      failureReason: applied.failureReason,
      suggestedNextAction: applied.suggestedNextAction,
      auditId: applied.applyAuditId ?? applied.auditId,
      appliedRegistry: null,
    } satisfies SandboxRollbackResult;
  }

  return {
    status: "restored",
    mode: params.mode,
    restorePointId: restorePoint.id,
    affectedProfileIds,
    blockedProfileIds: [],
    manualRequiredProfileIds: [],
    diffSummary,
    impactSummary,
    summary: applied.summary,
    failureReason: null,
    suggestedNextAction: applied.suggestedNextAction,
    auditId: applied.applyAuditId,
    appliedRegistry: applied.appliedRegistry,
  } satisfies SandboxRollbackResult;
}
