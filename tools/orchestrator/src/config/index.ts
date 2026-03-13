import type { OrchestratorState } from "../schemas";

export type PromotionConfig = {
  branchNameTemplate: string;
  baseBranch: string;
  allowPublish: boolean;
  approvalRequired: boolean;
  allowApplyWorkspace: boolean;
  requirePatchExport: boolean;
};

export type RetentionConfig = {
  recentSuccessKeep: number;
  recentFailureKeep: number;
  staleWorkspaceTtlMinutes: number;
  orphanArtifactTtlMinutes: number;
  preserveApprovalPending: boolean;
};

export const DEFAULT_PROMOTION_CONFIG: PromotionConfig = {
  branchNameTemplate: "orchestrator/{taskId}/iter-{iteration}",
  baseBranch: "main",
  allowPublish: false,
  approvalRequired: true,
  allowApplyWorkspace: false,
  requirePatchExport: true,
};

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  recentSuccessKeep: 3,
  recentFailureKeep: 5,
  staleWorkspaceTtlMinutes: 120,
  orphanArtifactTtlMinutes: 240,
  preserveApprovalPending: true,
};

function safeTaskSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "task";
}

export function resolvePromotionConfig(task: { promotionConfig?: Partial<PromotionConfig> | null }) {
  return {
    ...DEFAULT_PROMOTION_CONFIG,
    ...(task.promotionConfig ?? {}),
  };
}

export function resolveRetentionConfig(task: {
  retentionConfig?: Partial<RetentionConfig> | null;
  artifactRetentionSuccess?: number;
  artifactRetentionFailure?: number;
}) {
  return {
    ...DEFAULT_RETENTION_CONFIG,
    recentSuccessKeep: task.retentionConfig?.recentSuccessKeep ?? task.artifactRetentionSuccess ?? DEFAULT_RETENTION_CONFIG.recentSuccessKeep,
    recentFailureKeep: task.retentionConfig?.recentFailureKeep ?? task.artifactRetentionFailure ?? DEFAULT_RETENTION_CONFIG.recentFailureKeep,
    staleWorkspaceTtlMinutes:
      task.retentionConfig?.staleWorkspaceTtlMinutes ?? DEFAULT_RETENTION_CONFIG.staleWorkspaceTtlMinutes,
    orphanArtifactTtlMinutes:
      task.retentionConfig?.orphanArtifactTtlMinutes ?? DEFAULT_RETENTION_CONFIG.orphanArtifactTtlMinutes,
    preserveApprovalPending:
      task.retentionConfig?.preserveApprovalPending ?? DEFAULT_RETENTION_CONFIG.preserveApprovalPending,
  };
}

export function resolvePromotionBranchName(state: Pick<OrchestratorState, "id" | "lastExecutionReport" | "task">) {
  const config = resolvePromotionConfig(state.task);
  const iteration = state.lastExecutionReport?.iterationNumber ?? 0;
  return config.branchNameTemplate
    .split("{taskId}")
    .join(safeTaskSegment(state.id))
    .split("{iteration}")
    .join(String(iteration))
    .split("{baseBranch}")
    .join(config.baseBranch);
}
