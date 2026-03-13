import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { approvePendingPatch, createDefaultDependencies, createInitialState, rejectPendingPatch } from "../../src/orchestrator";
import { FileSystemWorkspaceManager } from "../../src/workspace";

const acceptanceValidation = [
  { command: "npm run test:orchestrator:typecheck", status: "passed" as const, output: null },
  { command: "npm run test:orchestrator:lint", status: "passed" as const, output: null },
];

async function createPatchReadyState(params?: { forbiddenFiles?: string[] }) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-promotion-repo-"));
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-promotion-storage-"));
  const workspaceRoot = path.join(repoRoot, ".workspaces");
  await mkdir(path.join(repoRoot, "allowed"), { recursive: true });
  await writeFile(path.join(repoRoot, "allowed", "file.txt"), "before\n", "utf8");

  const dependencies = createDefaultDependencies({
    repoPath: repoRoot,
    storageRoot,
    executorMode: "openai_responses",
    workspaceRoot,
    openaiClient: null,
  });
  const workspaceManager = new FileSystemWorkspaceManager(workspaceRoot);
  const workspace = await workspaceManager.createWorkspace({
    taskId: "promotion-state",
    iterationNumber: 1,
    repoPath: repoRoot,
    allowedFiles: ["allowed"],
    forbiddenFiles: params?.forbiddenFiles ?? ["app/api/platform/notifications"],
  });
  await writeFile(path.join(workspace.rootDir, "allowed", "file.txt"), "after\n", "utf8");
  const diff = await workspaceManager.collectDiffArtifacts(workspace);

  const state = createInitialState({
    id: "promotion-state",
    repoPath: repoRoot,
    repoName: "repo",
    userGoal: "Promote prepared patch",
    objective: "Exercise patch approval flow",
    subtasks: ["executor", "workspace", "promotion", "reviewer"],
    allowedFiles: ["allowed"],
    forbiddenFiles: params?.forbiddenFiles ?? ["app/api/platform/notifications"],
    successCriteria: ["patch promotion works"],
    autoMode: false,
    approvalMode: "human_approval",
    executorMode: "openai_responses",
    executionMode: "apply",
    workspaceRoot,
  });

  const patchReady = {
    ...state,
    status: "waiting_approval" as const,
    iterationNumber: 1,
    pendingHumanApproval: true,
    patchStatus: "waiting_approval" as const,
    approvalStatus: "pending_patch" as const,
    promotionStatus: "not_ready" as const,
    workspaceStatus: "active" as const,
    liveAcceptanceStatus: "not_run" as const,
    livePassStatus: "not_run" as const,
    exportArtifactPaths: [],
    handoffStatus: "not_ready" as const,
    prDraftStatus: "not_ready" as const,
    handoffArtifactPaths: [],
    lastExecutionReport: {
      iterationNumber: 1,
      changedFiles: diff.changedFiles,
      checkedButUnmodifiedFiles: [],
      summaryOfChanges: ["Prepared a patch in the isolated workspace."],
      whyThisWasDone: ["Exercise patch approval."],
      howBehaviorWasKeptStable: ["The main repo remains untouched until approval."],
      localValidation: acceptanceValidation,
      ciValidation: null,
      blockers: [],
      risks: [],
      recommendedNextStep: "Approve patch promotion.",
      shouldCloseSlice: true,
      artifacts: [
        { kind: "workspace", label: "workspace", path: workspace.rootDir, value: workspace.id },
        { kind: "diff", label: "diff", path: diff.diffPath, value: diff.diffText },
        { kind: "tool_log", label: "tool log", path: path.join(workspace.rootDir, ".orchestrator", "tool-log.json"), value: null },
        { kind: "command_log", label: "command log", path: path.join(workspace.rootDir, ".orchestrator", "command-log.json"), value: null },
      ],
      rawExecutorOutput: { provider: "openai_responses", executionMode: "apply" },
    },
    lastReviewVerdict: {
      verdict: "accept" as const,
      reasons: ["Patch is ready for promotion."],
      violatedConstraints: [],
      missingValidation: [],
      suggestedPatchScope: [],
      canAutoContinue: false,
    },
    iterationHistory: [
      {
        iterationNumber: 1,
        plannerProviderRequested: "rule_based" as const,
        plannerProviderResolved: "rule_based" as const,
        plannerFallbackReason: null,
        executorProviderRequested: "openai_responses" as const,
        executorProviderResolved: "openai_responses" as const,
        executorFallbackReason: null,
        executionMode: "apply" as const,
        reviewerProviderRequested: "rule_based" as const,
        reviewerProviderResolved: "rule_based" as const,
        reviewerFallbackReason: null,
        plannerDecision: null,
        executionReport: null,
        reviewVerdict: null,
        ciSummary: null,
        patchStatus: "waiting_approval" as const,
        approvalStatus: "pending_patch" as const,
        promotionStatus: "not_ready" as const,
        liveAcceptanceStatus: "not_run" as const,
        livePassStatus: "not_run" as const,
        workspaceStatus: "active" as const,
        exportArtifactPaths: [],
        handoffStatus: "not_ready" as const,
        prDraftStatus: "not_ready" as const,
        handoffArtifactPaths: [],
        artifactPruneResult: null,
        cleanupDecision: null,
        auditTrailPath: null,
        stateBefore: "planning" as const,
        stateAfter: "waiting_approval" as const,
        stopReason: null,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  await dependencies.storage.saveState(patchReady);
  return { dependencies, repoRoot };
}

test("approvePendingPatch exports promotion artifacts without mutating the repo", async () => {
  const { dependencies, repoRoot } = await createPatchReadyState();
  const updated = await approvePendingPatch("promotion-state", dependencies);

  assert.equal(updated.patchStatus, "promotion_ready");
  assert.equal(updated.approvalStatus, "approved");
  assert.equal(updated.status, "completed");
  assert.equal(updated.promotionStatus, "promotion_ready");
  assert.equal(updated.exportArtifactPaths.length, 2);
  assert.equal(updated.lastExecutionReport?.artifacts.some((artifact) => artifact.kind === "patch_export"), true);
  assert.equal(await readFile(path.join(repoRoot, "allowed", "file.txt"), "utf8"), "before\n");
});

test("rejectPendingPatch blocks the state and preserves the repo", async () => {
  const { dependencies, repoRoot } = await createPatchReadyState();
  const updated = await rejectPendingPatch("promotion-state", dependencies, "Need manual review.");

  assert.equal(updated.status, "blocked");
  assert.equal(updated.patchStatus, "rejected");
  assert.equal(updated.approvalStatus, "rejected");
  assert.equal(await readFile(path.join(repoRoot, "allowed", "file.txt"), "utf8"), "before\n");
});

test("approvePendingPatch fails when forbidden files are part of the prepared patch", async () => {
  const { dependencies } = await createPatchReadyState({
    forbiddenFiles: ["allowed"],
  });

  await assert.rejects(() => approvePendingPatch("promotion-state", dependencies), /forbidden files/i);
});
