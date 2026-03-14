import type { OrchestratorDependencies } from "../orchestrator";
import { backendHealthSummarySchema, backendRepairResultSchema, type BackendHealthSummary, type BackendRepairResult } from "../schemas";
import { hasLeaseExpired } from "../locking";
import { recoverStaleQueueRuns } from "../recovery";
import { listQueueRuns, updateQueueRunStatus } from "../queue";

export async function inspectBackendHealth(params: {
  dependencies: OrchestratorDependencies;
  now?: Date;
}): Promise<BackendHealthSummary> {
  const now = params.now ?? new Date();
  const [backendStatus, queue, stateIds] = await Promise.all([
    params.dependencies.backend.status(now),
    listQueueRuns(params.dependencies.backend),
    params.dependencies.storage.listStateIds(),
  ]);
  const stateSet = new Set(stateIds);
  const activeLeaseCount = queue.filter((item) => item.status === "running" && !hasLeaseExpired(item, now)).length;
  const staleLeaseCount = queue.filter((item) => item.status === "running" && hasLeaseExpired(item, now)).length;
  const orphanRunCount = queue.filter((item) => !stateSet.has(item.stateId)).length;

  let pendingApprovalCount = 0;
  let pendingPromotionCount = 0;
  for (const stateId of stateIds) {
    const state = await params.dependencies.storage.loadState(stateId);
    if (!state) {
      continue;
    }
    if (state.pendingHumanApproval) {
      pendingApprovalCount += 1;
    }
    if (["promotion_ready", "branch_ready"].includes(state.promotionStatus)) {
      pendingPromotionCount += 1;
    }
  }

  const recoverableAnomalyCount = staleLeaseCount + orphanRunCount;
  const status =
    backendStatus.status === "blocked"
      ? "blocked"
      : backendStatus.status === "manual_required"
        ? "manual_required"
        : recoverableAnomalyCount > 0
          ? "degraded"
          : "ready";

  return backendHealthSummarySchema.parse({
    backendType: params.dependencies.backend.backendType,
    status,
    queueDepth: queue.length,
    activeLeaseCount,
    staleLeaseCount,
    orphanRunCount,
    pendingApprovalCount,
    pendingPromotionCount,
    recoverableAnomalyCount,
    summary:
      status === "ready"
        ? `${params.dependencies.backend.backendType} backend is healthy.`
        : `${params.dependencies.backend.backendType} backend has recoverable or blocking anomalies.`,
    details: backendStatus.details,
    inspectedAt: now.toISOString(),
  });
}

export async function repairBackendHealth(params: {
  dependencies: OrchestratorDependencies;
  now?: Date;
}): Promise<BackendRepairResult> {
  const now = params.now ?? new Date();
  const staleDecisions = await recoverStaleQueueRuns({
    dependencies: params.dependencies,
    now,
  });

  const queue = await listQueueRuns(params.dependencies.backend);
  const stateIds = new Set(await params.dependencies.storage.listStateIds());
  let orphanBlockedCount = 0;
  const manualRequiredReasons: string[] = [];

  for (const item of queue) {
    if (stateIds.has(item.stateId)) {
      continue;
    }
    if (item.status === "running" && !hasLeaseExpired(item, now)) {
      manualRequiredReasons.push(`Run ${item.id} is orphaned but still has an active lease.`);
      continue;
    }
    if (["completed", "failed", "cancelled", "blocked"].includes(item.status)) {
      continue;
    }
    await updateQueueRunStatus({
      backend: params.dependencies.backend,
      runId: item.id,
      status: "blocked",
      reason: "Run is orphaned because its state record is missing.",
      now,
    });
    orphanBlockedCount += 1;
  }

  const staleRequeuedCount = staleDecisions.filter((decision) => decision.decision.action === "requeued").length;
  const status = manualRequiredReasons.length > 0 ? "manual_required" : staleRequeuedCount + orphanBlockedCount > 0 ? "repaired" : "skipped";
  return backendRepairResultSchema.parse({
    status,
    staleRequeuedCount,
    orphanBlockedCount,
    manualRequiredReasons,
    summary:
      status === "skipped"
        ? "Backend repair found no recoverable anomalies."
        : status === "manual_required"
          ? "Backend repair found anomalies that still require manual follow-up."
          : "Backend repair normalized stale leases or orphan queue items.",
    ranAt: now.toISOString(),
  });
}
