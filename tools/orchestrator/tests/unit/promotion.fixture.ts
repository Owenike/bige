import { spawn } from "node:child_process";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { FileSystemWorkspaceManager } from "../../src/workspace";

function runGit(repoPath: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repoPath,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code && code !== 0) {
        reject(new Error(stderr || stdout || `git ${args.join(" ")} failed with ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function createPromotionReadyFixture(stateId: string) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), `orchestrator-${stateId}-repo-`));
  const storageRoot = await mkdtemp(path.join(tmpdir(), `orchestrator-${stateId}-storage-`));
  const workspaceRoot = path.join(repoRoot, ".workspaces");
  await mkdir(path.join(repoRoot, "allowed"), { recursive: true });
  await writeFile(path.join(repoRoot, "allowed", "file.txt"), "before\n", "utf8");

  await runGit(repoRoot, ["init"]);
  await runGit(repoRoot, ["config", "user.email", "orchestrator@example.test"]);
  await runGit(repoRoot, ["config", "user.name", "Orchestrator Test"]);
  await runGit(repoRoot, ["add", "."]);
  await runGit(repoRoot, ["commit", "-m", "init"]);

  const dependencies = createDefaultDependencies({
    repoPath: repoRoot,
    storageRoot,
    executorMode: "openai_responses",
    workspaceRoot,
    openaiClient: null,
  });
  const workspaceManager = new FileSystemWorkspaceManager(workspaceRoot);
  const workspace = await workspaceManager.createWorkspace({
    taskId: stateId,
    iterationNumber: 1,
    repoPath: repoRoot,
    allowedFiles: ["allowed"],
    forbiddenFiles: ["app/api/platform/notifications"],
  });
  await writeFile(path.join(workspace.rootDir, "allowed", "file.txt"), "after\n", "utf8");
  const diff = await workspaceManager.collectDiffArtifacts(workspace);

  const state = createInitialState({
    id: stateId,
    repoPath: repoRoot,
    repoName: "repo",
    userGoal: "Promote approved patch to a branch-ready state",
    objective: "Exercise patch export and branch promotion",
    subtasks: ["executor", "workspace", "promotion", "branch"],
    allowedFiles: ["allowed"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["promotion branch created"],
    autoMode: false,
    approvalMode: "human_approval",
    executorMode: "openai_responses",
    executionMode: "apply",
    workspaceRoot,
  });

  await dependencies.storage.saveState({
    ...state,
    status: "waiting_approval",
    iterationNumber: 1,
    pendingHumanApproval: true,
    patchStatus: "waiting_approval",
    approvalStatus: "pending_patch",
    promotionStatus: "not_ready",
    workspaceStatus: "active",
    liveAcceptanceStatus: "not_run",
    livePassStatus: "not_run",
    exportArtifactPaths: [],
    handoffStatus: "not_ready",
    prDraftStatus: "not_ready",
    handoffArtifactPaths: [],
    lastExecutionReport: {
      iterationNumber: 1,
      changedFiles: diff.changedFiles,
      checkedButUnmodifiedFiles: [],
      summaryOfChanges: ["Prepared a patch in the isolated workspace."],
      whyThisWasDone: ["Exercise branch promotion."],
      howBehaviorWasKeptStable: ["The main repo remains untouched until promotion."],
      localValidation: [],
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
      verdict: "accept",
      reasons: ["Patch is ready for promotion."],
      violatedConstraints: [],
      missingValidation: [],
      suggestedPatchScope: [],
      canAutoContinue: false,
    },
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
        executionReport: null,
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
        stateBefore: "planning",
        stateAfter: "waiting_approval",
        stopReason: null,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      },
    ],
    updatedAt: new Date().toISOString(),
  });

  return { dependencies, repoRoot };
}
