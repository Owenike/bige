import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { cleanupStateWorkspaces, createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { FileSystemWorkspaceManager } from "../../src/workspace";

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

test("cleanupStateWorkspaces removes stale and orphan workspaces while retaining approval-critical workspaces", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-cleanup-repo-"));
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-cleanup-storage-"));
  const workspaceRoot = path.join(repoRoot, ".workspaces");
  const dependencies = createDefaultDependencies({
    repoPath: repoRoot,
    storageRoot,
    workspaceRoot,
  });
  const manager = new FileSystemWorkspaceManager(workspaceRoot);

  const protectedWorkspace = await manager.createWorkspace({
    taskId: "cleanup-state",
    iterationNumber: 1,
    repoPath: repoRoot,
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
  });
  const staleWorkspace = await manager.createWorkspace({
    taskId: "cleanup-state",
    iterationNumber: 2,
    repoPath: repoRoot,
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
  });
  const orphanWorkspace = await manager.createWorkspace({
    taskId: "cleanup-state",
    iterationNumber: 99,
    repoPath: repoRoot,
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
  });

  const staleMetadataPath = path.join(staleWorkspace.rootDir, ".orchestrator", "workspace.json");
  const orphanMetadataPath = path.join(orphanWorkspace.rootDir, ".orchestrator", "workspace.json");
  const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await utimes(staleMetadataPath, oldDate, oldDate);
  await utimes(orphanMetadataPath, oldDate, oldDate);
  await writeFile(path.join(protectedWorkspace.rootDir, ".orchestrator", "diff.patch"), "protected\n", "utf8");

  const state = createInitialState({
    id: "cleanup-state",
    repoPath: repoRoot,
    repoName: "repo",
    userGoal: "Clean stale workspaces",
    objective: "Exercise workspace cleanup flow",
    subtasks: ["workspace", "cleanup", "artifacts", "resume"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["stale cleanup works"],
    autoMode: false,
    approvalMode: "human_approval",
    workspaceRoot,
  });

  await dependencies.storage.saveState({
    ...state,
    iterationNumber: 2,
    patchStatus: "waiting_approval",
    approvalStatus: "pending_patch",
    workspaceStatus: "active",
    iterationHistory: [
      {
        iterationNumber: 1,
        plannerProviderRequested: "rule_based",
        plannerProviderResolved: "rule_based",
        plannerFallbackReason: null,
        executorProviderRequested: "openai_responses",
        executorProviderResolved: "openai_responses",
        executorFallbackReason: null,
        executionMode: "dry_run",
        reviewerProviderRequested: "rule_based",
        reviewerProviderResolved: "rule_based",
        reviewerFallbackReason: null,
        plannerDecision: null,
        executionReport: {
          iterationNumber: 1,
          changedFiles: ["tools/orchestrator/src/a.ts"],
          checkedButUnmodifiedFiles: [],
          summaryOfChanges: ["protected"],
          whyThisWasDone: ["protect"],
          howBehaviorWasKeptStable: ["protect"],
          localValidation: [],
          ciValidation: null,
          blockers: [],
          risks: [],
          recommendedNextStep: "approve",
          shouldCloseSlice: false,
          artifacts: [
            { kind: "workspace", label: "workspace", path: protectedWorkspace.rootDir, value: protectedWorkspace.id },
            { kind: "diff", label: "diff", path: path.join(protectedWorkspace.rootDir, ".orchestrator", "diff.patch"), value: null },
          ],
        },
        reviewVerdict: null,
        ciSummary: null,
        patchStatus: "waiting_approval",
        approvalStatus: "pending_patch",
        promotionStatus: "not_ready",
        liveAcceptanceStatus: "not_run",
        workspaceStatus: "active",
        exportArtifactPaths: [],
        artifactPruneResult: null,
        cleanupDecision: null,
        stateBefore: "planning",
        stateAfter: "waiting_approval",
        stopReason: null,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      },
      {
        iterationNumber: 2,
        plannerProviderRequested: "rule_based",
        plannerProviderResolved: "rule_based",
        plannerFallbackReason: null,
        executorProviderRequested: "openai_responses",
        executorProviderResolved: "openai_responses",
        executorFallbackReason: null,
        executionMode: "dry_run",
        reviewerProviderRequested: "rule_based",
        reviewerProviderResolved: "rule_based",
        reviewerFallbackReason: null,
        plannerDecision: null,
        executionReport: {
          iterationNumber: 2,
          changedFiles: ["tools/orchestrator/src/b.ts"],
          checkedButUnmodifiedFiles: [],
          summaryOfChanges: ["stale"],
          whyThisWasDone: ["stale"],
          howBehaviorWasKeptStable: ["stale"],
          localValidation: [],
          ciValidation: null,
          blockers: [],
          risks: [],
          recommendedNextStep: "cleanup",
          shouldCloseSlice: false,
          artifacts: [
            { kind: "workspace", label: "workspace", path: staleWorkspace.rootDir, value: staleWorkspace.id },
          ],
        },
        reviewVerdict: null,
        ciSummary: null,
        patchStatus: "none",
        approvalStatus: "not_requested",
        promotionStatus: "not_ready",
        liveAcceptanceStatus: "not_run",
        workspaceStatus: "active",
        exportArtifactPaths: [],
        artifactPruneResult: null,
        cleanupDecision: null,
        stateBefore: "planning",
        stateAfter: "needs_revision",
        stopReason: null,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      },
    ],
    updatedAt: new Date().toISOString(),
  });

  const cleanup = await cleanupStateWorkspaces("cleanup-state", dependencies, { staleMinutes: 60 });

  assert.equal(cleanup.result.deletedPaths.includes(staleWorkspace.rootDir), true);
  assert.equal(cleanup.result.deletedPaths.includes(orphanWorkspace.rootDir), true);
  assert.equal(cleanup.result.retainedPaths.includes(protectedWorkspace.rootDir), true);
  assert.equal(cleanup.state.lastCleanupDecision?.deletedPaths.length, 2);
  assert.equal(await pathExists(protectedWorkspace.rootDir), true);
  assert.equal(await pathExists(staleWorkspace.rootDir), false);
  assert.equal(await pathExists(orphanWorkspace.rootDir), false);
});
