import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { ExecutionReport, OrchestratorState } from "../schemas";
import { FileSystemWorkspaceManager } from "../workspace";

function findArtifactPath(report: ExecutionReport, kind: string) {
  return report.artifacts.find((artifact) => artifact.kind === kind)?.path ?? null;
}

export function validatePatchPromotionPreconditions(state: OrchestratorState) {
  const issues: string[] = [];
  const report = state.lastExecutionReport;
  if (!report) {
    issues.push("No execution report is available for patch promotion.");
    return issues;
  }

  if (!["patch_ready", "patch_exported", "branch_ready", "promotion_ready", "waiting_approval", "approved_for_apply"].includes(state.patchStatus)) {
    issues.push(`Patch promotion requires a promotion-ready patch state, received ${state.patchStatus}.`);
  }
  if (state.approvalStatus === "rejected") {
    issues.push("Patch promotion cannot continue after rejection.");
  }
  if (report.changedFiles.length === 0) {
    issues.push("Patch promotion requires changed files.");
  }
  if (!findArtifactPath(report, "workspace")) {
    issues.push("Patch promotion requires a workspace artifact.");
  }
  if (!findArtifactPath(report, "diff")) {
    issues.push("Patch promotion requires a diff artifact.");
  }
  if (report.changedFiles.some((changedFile) => state.task.forbiddenFiles.some((forbidden) => changedFile === forbidden || changedFile.startsWith(`${forbidden}/`) || changedFile.startsWith(`${forbidden}\\`)))) {
    issues.push("Patch promotion cannot proceed because forbidden files were changed.");
  }

  return issues;
}

function safeTaskSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "task";
}

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

export function buildPromotionMetadata(state: OrchestratorState) {
  const report = state.lastExecutionReport;
  if (!report) {
    throw new Error("Promotion metadata requires an execution report.");
  }
  const branchName = `orchestrator/${safeTaskSegment(state.id)}/iter-${report.iterationNumber}`;
  const diffPath = findArtifactPath(report, "diff");
  const workspacePath = findArtifactPath(report, "workspace");
  return {
    branchName,
    diffPath,
    workspacePath,
    changedFiles: report.changedFiles,
    prTitle: `orchestrator: promote patch for ${state.id} iteration ${report.iterationNumber}`,
    prBody: [
      `Objective: ${state.plannerDecision?.objective ?? state.task.objective}`,
      `Changed files: ${report.changedFiles.join(", ") || "none"}`,
      `Recommended next step: ${report.recommendedNextStep}`,
    ].join("\n"),
  };
}

export async function exportPatchBundle(params: {
  state: OrchestratorState;
  exportRoot: string;
}) {
  const report = params.state.lastExecutionReport;
  if (!report) {
    throw new Error("Patch export requires an execution report.");
  }
  const metadata = buildPromotionMetadata(params.state);
  const exportDir = path.join(params.exportRoot, params.state.id, `iteration-${report.iterationNumber}`);
  await mkdir(exportDir, { recursive: true });
  const manifestPath = path.join(exportDir, "promotion-manifest.json");
  const patchExportPath = path.join(exportDir, "patch-export.json");
  await writeFile(
    patchExportPath,
    `${JSON.stringify(
      {
        branchName: metadata.branchName,
        diffPath: metadata.diffPath,
        workspacePath: metadata.workspacePath,
        changedFiles: metadata.changedFiles,
        prTitle: metadata.prTitle,
        prBody: metadata.prBody,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        patchExportPath,
        ...metadata,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    branchName: metadata.branchName,
    patchExportPath,
    manifestPath,
    prTitle: metadata.prTitle,
    prBody: metadata.prBody,
  };
}

export async function preparePromotionBranch(params: {
  state: OrchestratorState;
  createBranch?: boolean;
}) {
  const metadata = buildPromotionMetadata(params.state);
  let branchCreated = false;
  let branchReason = "Branch metadata prepared without creating a git ref.";

  if (params.createBranch) {
    try {
      await runGit(params.state.task.repoPath, ["branch", metadata.branchName]);
      branchCreated = true;
      branchReason = `Created branch ${metadata.branchName}.`;
    } catch (error) {
      branchReason = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ...metadata,
    branchCreated,
    branchReason,
  };
}

export async function promotePatchFromState(params: {
  state: OrchestratorState;
  workspaceManager: FileSystemWorkspaceManager;
}) {
  const report = params.state.lastExecutionReport;
  if (!report) {
    throw new Error("Patch promotion requires an execution report.");
  }
  const workspacePath = findArtifactPath(report, "workspace");
  if (!workspacePath) {
    throw new Error("Patch promotion requires a workspace artifact path.");
  }

  await params.workspaceManager.applyWorkspaceRootToRepo(workspacePath, report.changedFiles);
  return {
    workspacePath,
    changedFiles: report.changedFiles,
    branchName: buildPromotionMetadata(params.state).branchName,
  };
}
