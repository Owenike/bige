import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, stat, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pruneOrchestratorArtifacts } from "../../src/artifacts";
import { createInitialState } from "../../src/orchestrator";
import { FileSystemWorkspaceManager } from "../../src/workspace";
import { inspectWorkspaceCleanup } from "../../src/cleanup";

async function exists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function createWorkspaceArtifact(root: string, taskId: string, iterationNumber: number) {
  const workspaceRoot = path.join(root, taskId, `iteration-${iterationNumber}`);
  await mkdir(path.join(workspaceRoot, ".orchestrator"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, ".orchestrator", "workspace.json"),
    `${JSON.stringify({
      id: `${taskId}:${iterationNumber}`,
      taskId,
      iterationNumber,
      rootDir: workspaceRoot,
      sourceRepoPath: root,
      allowedFiles: ["tools/orchestrator"],
      forbiddenFiles: ["app/api/platform/notifications"],
    })}\n`,
    "utf8",
  );
  const diffPath = path.join(workspaceRoot, ".orchestrator", "diff.patch");
  await writeFile(diffPath, `diff-${iterationNumber}\n`, "utf8");
  return { workspaceRoot, diffPath };
}

test("retention config preserves approval-pending artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-retention-"));
  const manager = new FileSystemWorkspaceManager(workspaceRoot);
  const state = createInitialState({
    id: "retention-state",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Retain approval pending work",
    objective: "Exercise retention config",
    subtasks: ["retention", "artifacts"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["protected iterations stay"],
    autoMode: false,
    approvalMode: "human_approval",
    workspaceRoot,
    retentionConfig: {
      recentSuccessKeep: 0,
      recentFailureKeep: 0,
      preserveApprovalPending: true,
      staleWorkspaceTtlMinutes: 120,
      orphanArtifactTtlMinutes: 1,
    },
  });

  const art = await createWorkspaceArtifact(workspaceRoot, state.id, 1);
  const pruned = await pruneOrchestratorArtifacts({
    state: {
      ...state,
      iterationNumber: 1,
      patchStatus: "waiting_approval",
      approvalStatus: "pending_patch",
      iterationHistory: [
        {
          iterationNumber: 1,
          plannerProviderRequested: "rule_based",
          plannerProviderResolved: "rule_based",
          plannerFallbackReason: null,
          executorProviderRequested: "openai_responses",
          executorProviderResolved: "openai_responses",
          executorFallbackReason: null,
          executionMode: "apply",
          reviewerProviderRequested: "rule_based",
          reviewerProviderResolved: "rule_based",
          reviewerFallbackReason: null,
          plannerDecision: null,
          executionReport: {
            iterationNumber: 1,
            changedFiles: ["tools/orchestrator/src/a.ts"],
            checkedButUnmodifiedFiles: [],
            summaryOfChanges: [],
            whyThisWasDone: [],
            howBehaviorWasKeptStable: [],
            localValidation: [],
            ciValidation: null,
            blockers: [],
            risks: [],
            recommendedNextStep: "approve",
            shouldCloseSlice: false,
            artifacts: [
              { kind: "workspace", label: "workspace", path: art.workspaceRoot, value: null },
              { kind: "diff", label: "diff", path: art.diffPath, value: null },
            ],
          },
          reviewVerdict: null,
          ciSummary: null,
          patchStatus: "waiting_approval",
          approvalStatus: "pending_patch",
          promotionStatus: "not_ready",
          liveAcceptanceStatus: "not_run",
          livePassStatus: "not_run",
          workspaceStatus: "active",
          exportArtifactPaths: [],
          handoffStatus: "not_ready",
          prDraftStatus: "not_ready",
          handoffArtifactPaths: [],
          artifactPruneResult: null,
          cleanupDecision: null,
          auditTrailPath: null,
          liveEvidencePath: null,
          githubHandoffResultPath: null,
          stateBefore: "planning",
          stateAfter: "waiting_approval",
          stopReason: null,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        },
      ],
    },
    workspaceManager: manager,
  });

  assert.equal(pruned.result.retainedIterations.includes(1), true);
  assert.equal(await exists(art.workspaceRoot), true);
});

test("retention config staleWorkspaceTtlMinutes drives cleanup", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-retention-cleanup-"));
  const workspaceRoot = path.join(repoRoot, ".workspaces");
  const manager = new FileSystemWorkspaceManager(workspaceRoot);
  const state = createInitialState({
    id: "retention-cleanup-state",
    repoPath: repoRoot,
    repoName: "repo",
    userGoal: "Cleanup stale workspaces",
    objective: "Exercise cleanup config",
    subtasks: ["cleanup"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["stale cleanup uses config"],
    autoMode: false,
    approvalMode: "human_approval",
    workspaceRoot,
    retentionConfig: {
      staleWorkspaceTtlMinutes: 1,
      orphanArtifactTtlMinutes: 1,
      recentSuccessKeep: 1,
      recentFailureKeep: 1,
      preserveApprovalPending: true,
    },
  });
  const stale = await manager.createWorkspace({
    taskId: state.id,
    iterationNumber: 2,
    repoPath: repoRoot,
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
  });
  const metadataPath = path.join(stale.rootDir, ".orchestrator", "workspace.json");
  const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await utimes(metadataPath, oldDate, oldDate);

  const result = await inspectWorkspaceCleanup({
    state: {
      ...state,
      iterationNumber: 1,
      iterationHistory: [],
    },
    workspaceManager: manager,
  });

  assert.equal(result.deletedPaths.includes(stale.rootDir), true);
});
