import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { BlockedReason, OrchestratorState, SandboxRestorePoint } from "../schemas";
import { reviewSandboxRegistryChange } from "../sandbox-change-review";

export type SandboxRollbackGovernanceDecision = {
  status: "ready" | "blocked" | "manual_required";
  restorePointId: string | null;
  reason: BlockedReason | null;
  summary: string;
  suggestedNextAction: string;
  affectedProfileIds: string[];
};

function buildReason(params: {
  code: string;
  summary: string;
  missingPrerequisites?: string[];
  recoverable?: boolean;
  suggestedNextAction: string;
}): BlockedReason {
  return {
    code: params.code,
    summary: params.summary,
    missingPrerequisites: params.missingPrerequisites ?? [],
    recoverable: params.recoverable ?? true,
    suggestedNextAction: params.suggestedNextAction,
  };
}

function resolveMaxAgeHours(explicitMaxAgeHours?: number) {
  if (typeof explicitMaxAgeHours === "number" && Number.isFinite(explicitMaxAgeHours) && explicitMaxAgeHours > 0) {
    return explicitMaxAgeHours;
  }
  const envValue = process.env.ORCHESTRATOR_SANDBOX_RESTORE_MAX_AGE_HOURS;
  if (!envValue) {
    return 24 * 7;
  }
  const parsed = Number.parseInt(envValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24 * 7;
}

function diffHours(fromIso: string, toIso: string) {
  return (Date.parse(toIso) - Date.parse(fromIso)) / (1000 * 60 * 60);
}

export async function evaluateSandboxRollbackGovernance(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  restorePoint: SandboxRestorePoint | null;
  actorSource: string;
  commandSource?: string | null;
  maxAgeHours?: number;
}) {
  if (!params.restorePoint) {
    const reason = buildReason({
      code: "sandbox_restore_point_missing",
      summary: "Sandbox rollback governance requires an existing restore point.",
      missingPrerequisites: ["restore point"],
      suggestedNextAction: "Create or choose a valid restore point before rollback preview/validate/apply.",
    });
    return {
      status: "manual_required",
      restorePointId: null,
      reason,
      summary: reason.summary,
      suggestedNextAction: reason.suggestedNextAction,
      affectedProfileIds: [],
    } satisfies SandboxRollbackGovernanceDecision;
  }

  const affectedProfileIds = Array.from(new Set(params.restorePoint.affectedProfileIds)).sort();
  if (affectedProfileIds.length === 0) {
    const reason = buildReason({
      code: "sandbox_restore_point_invalid",
      summary: `Restore point '${params.restorePoint.id}' does not contain any affected sandbox profiles.`,
      missingPrerequisites: [`valid restore point '${params.restorePoint.id}'`],
      suggestedNextAction: "Choose a restore point that captured a real sandbox change or recreate the restore point.",
    });
    return {
      status: "manual_required",
      restorePointId: params.restorePoint.id,
      reason,
      summary: reason.summary,
      suggestedNextAction: reason.suggestedNextAction,
      affectedProfileIds,
    } satisfies SandboxRollbackGovernanceDecision;
  }

  const maxAgeHours = resolveMaxAgeHours(params.maxAgeHours);
  const ageHours = diffHours(params.restorePoint.createdAt, new Date().toISOString());
  if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) {
    const reason = buildReason({
      code: "sandbox_restore_point_expired",
      summary: `Restore point '${params.restorePoint.id}' is older than the rollback governance window (${maxAgeHours}h).`,
      missingPrerequisites: [`fresh restore point newer than ${maxAgeHours}h`],
      suggestedNextAction: "Create a new restore point or review the stale restore point manually before rollback apply.",
    });
    return {
      status: "manual_required",
      restorePointId: params.restorePoint.id,
      reason,
      summary: reason.summary,
      suggestedNextAction: reason.suggestedNextAction,
      affectedProfileIds,
    } satisfies SandboxRollbackGovernanceDecision;
  }

  const review = await reviewSandboxRegistryChange({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    proposedRegistry: params.restorePoint.previousRegistry,
    actorSource: `${params.actorSource}:rollback-governance`,
    commandSource: params.commandSource ?? null,
    recordAudit: false,
  });
  if (review.status !== "ready") {
    const reason =
      review.failureReason === null
        ? null
        : buildReason({
            code: review.failureReason,
            summary: review.summary,
            suggestedNextAction: review.suggestedNextAction,
          });
    return {
      status: review.status,
      restorePointId: params.restorePoint.id,
      reason,
      summary: review.summary,
      suggestedNextAction: review.suggestedNextAction,
      affectedProfileIds,
    } satisfies SandboxRollbackGovernanceDecision;
  }

  return {
    status: "ready",
    restorePointId: params.restorePoint.id,
    reason: null,
    summary: `Rollback governance passed for restore point '${params.restorePoint.id}'.`,
    suggestedNextAction: "Run rollback validate or apply when you are ready to restore the captured sandbox state.",
    affectedProfileIds,
  } satisfies SandboxRollbackGovernanceDecision;
}

export function formatSandboxRollbackGovernanceSummary(decision: SandboxRollbackGovernanceDecision) {
  return [
    `Sandbox rollback governance: ${decision.status}`,
    `Restore point: ${decision.restorePointId ?? "none"}`,
    `Summary: ${decision.summary}`,
    `Reason: ${decision.reason?.code ?? "none"}`,
    `Affected profiles: ${decision.affectedProfileIds.join(", ") || "none"}`,
    `Next action: ${decision.suggestedNextAction}`,
  ].join("\n");
}
