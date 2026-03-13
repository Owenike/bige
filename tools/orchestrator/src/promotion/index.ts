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

  if (state.patchStatus !== "patch_ready" && state.patchStatus !== "waiting_approval") {
    issues.push(`Patch promotion requires patch_ready state, received ${state.patchStatus}.`);
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
  };
}
