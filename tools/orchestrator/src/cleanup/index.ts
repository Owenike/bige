import type { CleanupDecision, OrchestratorState } from "../schemas";
import { FileSystemWorkspaceManager } from "../workspace";
import { resolveRetentionConfig } from "../config";

function collectProtectedWorkspaceRoots(state: OrchestratorState) {
  const protectedPaths = new Set<string>();
  for (const record of state.iterationHistory) {
    if (!["patch_ready", "patch_exported", "branch_ready", "promotion_ready", "waiting_approval", "approved_for_apply"].includes(record.patchStatus)) {
      continue;
    }
    const workspacePath = record.executionReport?.artifacts.find((artifact) => artifact.kind === "workspace")?.path;
    if (workspacePath) {
      protectedPaths.add(workspacePath);
    }
  }
  return protectedPaths;
}

export async function inspectWorkspaceCleanup(params: {
  state: OrchestratorState;
  workspaceManager: FileSystemWorkspaceManager;
  now?: Date;
  staleMinutes?: number;
}) {
  const now = params.now ?? new Date();
  const retention = resolveRetentionConfig(params.state.task);
  const staleMs = (params.staleMinutes ?? retention.staleWorkspaceTtlMinutes) * 60 * 1000;
  const workspaces = await params.workspaceManager.listWorkspaces(params.state.id);
  const protectedRoots = collectProtectedWorkspaceRoots(params.state);

  const retainedPaths: string[] = [];
  const deletedPaths: string[] = [];
  const orphanPaths: string[] = [];
  const stalePaths: string[] = [];

  for (const workspace of workspaces) {
    const isProtected = protectedRoots.has(workspace.rootDir);
    const isKnownIteration = params.state.iterationHistory.some((record) => record.iterationNumber === workspace.iterationNumber);
    const ageMs = now.getTime() - new Date(workspace.updatedAt).getTime();
    const isStale = ageMs >= staleMs;

    if (isProtected) {
      retainedPaths.push(workspace.rootDir);
      continue;
    }

    if (!isKnownIteration) {
      orphanPaths.push(workspace.rootDir);
      await params.workspaceManager.cleanupPath(workspace.rootDir);
      deletedPaths.push(workspace.rootDir);
      continue;
    }

    if (isStale) {
      stalePaths.push(workspace.rootDir);
      await params.workspaceManager.cleanupPath(workspace.rootDir);
      deletedPaths.push(workspace.rootDir);
      continue;
    }

    retainedPaths.push(workspace.rootDir);
  }

  const workspaceStatus =
    orphanPaths.length > 0
      ? "orphaned"
      : stalePaths.length > 0
        ? "stale"
        : deletedPaths.length > 0
          ? "cleaned"
          : retainedPaths.length > 0
            ? "active"
            : "clean";

  return {
    workspaceStatus,
    deletedPaths,
    retainedPaths,
    orphanPaths,
    stalePaths,
    summary:
      deletedPaths.length > 0
        ? `Cleaned ${deletedPaths.length} workspace roots and retained ${retainedPaths.length}.`
        : `No workspace cleanup needed; retained ${retainedPaths.length} workspace roots.`,
    cleanedAt: now.toISOString(),
  } satisfies CleanupDecision;
}
