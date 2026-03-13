import type { OrchestratorDependencies } from "../orchestrator";
import { cleanupDecisionSchema, orchestratorStateSchema, recoveryDecisionSchema, type QueueRunItem } from "../schemas";
import { inspectWorkspaceCleanup } from "../cleanup";
import { hasLeaseExpired } from "../locking";
import { applyQueueItemToState, forceRequeueExpiredRun, listQueueRuns, updateQueueRunStatus } from "../queue";

function isProtectedPendingState(itemState: Awaited<ReturnType<OrchestratorDependencies["storage"]["loadState"]>>) {
  if (!itemState) {
    return false;
  }
  return (
    itemState.pendingHumanApproval ||
    ["waiting_approval", "blocked"].includes(itemState.status) ||
    ["promotion_ready", "branch_ready"].includes(itemState.promotionStatus) ||
    ["exported", "handoff_ready", "branch_published"].includes(itemState.handoffStatus)
  );
}

export async function recoverStaleQueueRuns(params: {
  dependencies: OrchestratorDependencies;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const queueItems = await listQueueRuns(params.dependencies.storage);
  const decisions: Array<{
    run: QueueRunItem;
    decision: ReturnType<typeof recoveryDecisionSchema.parse>;
  }> = [];

  for (const item of queueItems) {
    if (item.status !== "running" || !hasLeaseExpired(item, now)) {
      continue;
    }

    const state = await params.dependencies.storage.loadState(item.stateId);
    let workspaceDecision = cleanupDecisionSchema.parse({
      workspaceStatus: state ? "clean" : "unknown",
      deletedPaths: [],
      retainedPaths: [],
      orphanPaths: [],
      stalePaths: [],
      summary: state ? "No workspace cleanup needed before recovery." : "State is missing; workspace cleanup was not inspected.",
      cleanedAt: now.toISOString(),
    });
    if (state) {
      try {
        workspaceDecision = cleanupDecisionSchema.parse(
          await inspectWorkspaceCleanup({
            state,
            workspaceManager: params.dependencies.workspaceManager,
            now,
          }),
        );
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
          throw error;
        }
      }
    }

    const decision = recoveryDecisionSchema.parse(
      isProtectedPendingState(state)
        ? {
            runId: item.id,
            action: "paused",
            reason: "Run lease expired while approval, handoff, or blocked state still requires manual review.",
            workspaceStatus: workspaceDecision.workspaceStatus,
            recoverable: true,
            decidedAt: now.toISOString(),
          }
        : {
            runId: item.id,
            action: "requeued",
            reason: "Run lease expired and was safely requeued for takeover.",
            workspaceStatus: workspaceDecision.workspaceStatus,
            recoverable: true,
            decidedAt: now.toISOString(),
          },
    );

    const updatedRun =
      decision.action === "requeued"
        ? await forceRequeueExpiredRun({
            storage: params.dependencies.storage,
            runId: item.id,
            reason: decision.reason,
            now,
          })
        : await updateQueueRunStatus({
            storage: params.dependencies.storage,
            runId: item.id,
            status: "paused",
            reason: decision.reason,
            recoveryDecision: decision,
            now,
          });

    if (state && updatedRun) {
      const updatedState = orchestratorStateSchema.parse(
        applyQueueItemToState(
          {
            ...state,
            workspaceStatus: workspaceDecision.workspaceStatus,
            lastCleanupDecision: workspaceDecision,
          },
          updatedRun,
          now,
          decision,
        ),
      );
      await params.dependencies.storage.saveState(updatedState);
    }

    decisions.push({
      run: updatedRun ?? item,
      decision,
    });
  }

  return decisions;
}
