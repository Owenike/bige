import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { reportStateStatus, applyStatusReportToState, runGitHubReportPermissionSmoke, type StatusReportingAdapter } from "../status-reporting";
import { orchestratorStateSchema, type GitHubAuthSmokeResult, type OrchestratorState } from "../schemas";
import { selectGitHubLiveSmokeTarget, type RequestedGitHubSandboxTarget } from "../github-live-targets";

export async function runGitHubLiveAuthSmoke(params: {
  state: OrchestratorState;
  outputRoot: string;
  adapter: StatusReportingAdapter;
  enabled: boolean;
  token: string | null;
  requestedTarget?: RequestedGitHubSandboxTarget | null;
  execFileImpl?: (
    file: string,
    args: readonly string[],
    options?: {
      windowsHide?: boolean;
    },
  ) => Promise<{
    stdout: string;
    stderr: string;
  }>;
}) {
  const selection = selectGitHubLiveSmokeTarget({
    state: params.state,
    requestedTarget: params.requestedTarget,
  });
  const permissionSmoke = await runGitHubReportPermissionSmoke({
    state:
      selection.target.repository && selection.target.targetNumber && selection.target.targetType
        ? withSandboxTarget(params.state, selection)
        : params.state,
    enabled: params.enabled,
    token: params.token,
    execFileImpl: params.execFileImpl,
  });

  const ranAt = new Date().toISOString();
  await mkdir(params.outputRoot, { recursive: true });
  const evidencePath = path.join(params.outputRoot, `${params.state.id}-github-auth-smoke.json`);

  let result: GitHubAuthSmokeResult;
  let nextState = params.state;

  if (selection.status === "manual_required" || selection.status === "blocked") {
    result = {
      status: selection.status === "blocked" ? "blocked" : "manual_required",
      mode: "readiness_only",
      target: selection.target,
      attemptedAction: "blocked",
      permissionResult: selection.permissionResult,
      failureReason: selection.failureReason,
      providerUsed: permissionSmoke.providerUsed,
      evidencePath,
      summary: selection.summary,
      suggestedNextAction: selection.suggestedNextAction,
      ranAt,
    };
  } else if (permissionSmoke.status !== "ready") {
    result = {
      status: permissionSmoke.status === "blocked" ? "blocked" : "skipped",
      mode: selection.mode,
      target: selection.target,
      attemptedAction: selection.attemptedAction === "update" ? "update" : selection.attemptedAction === "create" ? "create" : "skip",
      permissionResult: permissionSmoke.permissionStatus,
      failureReason: permissionSmoke.failureReason,
      providerUsed: permissionSmoke.providerUsed,
      evidencePath,
      summary: permissionSmoke.summary,
      suggestedNextAction: permissionSmoke.suggestedNextAction,
      ranAt,
    };
  } else {
    const sandboxState = withSandboxTarget(params.state, selection);
    const first = await reportStateStatus({
      state: sandboxState,
      outputRoot: params.outputRoot,
      adapter: params.adapter,
    });
    let finalSummary = first;
    let action: "create" | "update" = selection.attemptedAction === "update" ? "update" : "create";
    if (first.status === "comment_created") {
      const createdState = applyStatusReportToState(sandboxState, first);
      const second = await reportStateStatus({
        state: createdState,
        outputRoot: params.outputRoot,
        adapter: params.adapter,
      });
      finalSummary = second;
      action = "update";
      nextState = applyStatusReportToState(params.state, second);
    } else {
      nextState = applyStatusReportToState(params.state, first);
    }
    result = {
      status:
        finalSummary.status === "comment_created" || finalSummary.status === "comment_updated"
          ? "passed"
          : finalSummary.status === "blocked"
            ? "blocked"
            : finalSummary.status === "failed"
              ? "failed"
              : "skipped",
      mode: selection.mode,
      target: {
        ...selection.target,
        commentId: finalSummary.commentId ?? selection.target.commentId,
      },
      attemptedAction: action,
      permissionResult: finalSummary.permissionStatus,
      failureReason: finalSummary.failureReason,
      providerUsed: finalSummary.provider,
      evidencePath,
      summary: finalSummary.summary,
      suggestedNextAction: finalSummary.nextAction,
      ranAt,
    };
  }

  await writeFile(evidencePath, `${JSON.stringify({ selection, permissionSmoke, result }, null, 2)}\n`, "utf8");
  const updatedState = applyGitHubAuthSmokeToState(nextState, result);
  return {
    result,
    state: updatedState,
    evidencePath,
  };
}

function withSandboxTarget(state: OrchestratorState, selection: ReturnType<typeof selectGitHubLiveSmokeTarget>) {
  const target = selection.target;
  return orchestratorStateSchema.parse({
    ...state,
    sourceEventSummary: target.repository && target.targetType && target.targetNumber
      ? {
          repository: target.repository,
          branch: state.sourceEventSummary?.branch ?? null,
          issueNumber: target.targetType === "issue" ? target.targetNumber : null,
          prNumber: target.targetType === "pull_request" ? target.targetNumber : null,
          commentId: target.commentId,
          label: state.sourceEventSummary?.label ?? null,
          headSha: state.sourceEventSummary?.headSha ?? null,
          command: state.sourceEventSummary?.command ?? null,
          triggerReason: `github_auth_smoke:${target.repository}#${target.targetNumber}`,
        }
      : state.sourceEventSummary,
    lastStatusReportTarget:
      target.repository && target.targetType && target.targetNumber
        ? {
            kind: target.targetType === "pull_request" ? "pull_request_comment" : "issue_comment",
            repository: target.repository,
            targetNumber: target.targetNumber,
            commentId: target.commentId,
            targetUrl: state.lastStatusReportTarget?.targetUrl ?? null,
            correlationId: state.statusReportCorrelationId,
            updatedAt: state.updatedAt,
          }
        : state.lastStatusReportTarget,
  });
}

export function applyGitHubAuthSmokeToState(state: OrchestratorState, result: GitHubAuthSmokeResult) {
  return orchestratorStateSchema.parse({
    ...state,
    authSmokeStatus: result.status,
    authSmokeMode: result.mode,
    authSmokeTarget: result.target,
    authSmokePermissionResult: result.permissionResult,
    authSmokeFailureReason: result.failureReason,
    targetSelectionStatus: result.target.selectionStatus,
    lastLiveSmokeEvidencePath: result.evidencePath,
    lastGitHubAuthSmokeResult: result,
    updatedAt: result.ranAt,
  });
}
