import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { reportStateStatus, applyStatusReportToState, runGitHubReportPermissionSmoke, type StatusReportingAdapter } from "../status-reporting";
import {
  orchestratorStateSchema,
  type GitHubAuthSmokeResult,
  type GitHubLiveAuthEvidence,
  type OrchestratorState,
} from "../schemas";
import { selectGitHubLiveSmokeTarget, type GitHubLiveTargetSelectionResult, type RequestedGitHubSandboxTarget } from "../github-live-targets";
import { resolveGitHubSandboxTarget, type LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";

export async function runGitHubLiveAuthSmoke(params: {
  state: OrchestratorState;
  outputRoot: string;
  adapter: StatusReportingAdapter;
  enabled: boolean;
  token: string | null;
  requestedTarget?: RequestedGitHubSandboxTarget | null;
  sandboxRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  sandboxProfileId?: string | null;
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
  const registryResolution = resolveGitHubSandboxTarget({
    state: params.state,
    loadedRegistry: params.sandboxRegistry,
    requestedTarget: params.requestedTarget,
    requestedProfileId: params.sandboxProfileId ?? null,
  });
  const selection = applySandboxActionPolicy(resolveSelection(params.state, registryResolution), registryResolution);
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
      permissionResult: selection.permissionResult === "ready" ? "blocked" : selection.permissionResult,
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

  const evidence = buildGitHubAuthSmokeEvidence({
    result,
    selection,
    registryResolution,
  });
  await writeFile(
    evidencePath,
    `${JSON.stringify({ selection, registryResolution, permissionSmoke, result, evidence }, null, 2)}\n`,
    "utf8",
  );
  const updatedState = applyGitHubAuthSmokeToState(nextState, result, evidence);
  return {
    result,
    state: updatedState,
    evidencePath,
  };
}

function resolveSelection(
  state: OrchestratorState,
  registryResolution: ReturnType<typeof resolveGitHubSandboxTarget>,
): GitHubLiveTargetSelectionResult {
  if (registryResolution.status === "resolved") {
    return selectGitHubLiveSmokeTarget({
      state,
      requestedTarget: registryResolution.requestedTarget,
    });
  }

  const fallbackStatus = registryResolution.status as "blocked" | "manual_required";
  return {
    status: fallbackStatus,
    target: {
      repository: null,
      targetType: null,
      targetNumber: null,
      commentId: null,
      selectionStatus: fallbackStatus,
      selectionSummary: registryResolution.summary,
    },
    mode: "none",
    attemptedAction: "none",
    permissionResult: "blocked",
    failureReason: registryResolution.failureReason,
    summary: registryResolution.summary,
    suggestedNextAction: registryResolution.suggestedNextAction,
  } satisfies GitHubLiveTargetSelectionResult;
}

function applySandboxActionPolicy(
  selection: GitHubLiveTargetSelectionResult,
  registryResolution: ReturnType<typeof resolveGitHubSandboxTarget>,
) {
  if (registryResolution.status !== "resolved" || !registryResolution.actionPolicy) {
    return selection;
  }

  if (registryResolution.actionPolicy === "create_only" && selection.attemptedAction === "update") {
    return {
      ...selection,
      status: "blocked",
      mode: "none",
      attemptedAction: "none",
      permissionResult: "blocked",
      failureReason: "github_auth_smoke_update_disallowed_by_sandbox_policy",
      summary: "GitHub live auth smoke is blocked because the selected sandbox target only permits create.",
      suggestedNextAction: "Choose a sandbox target that allows update, or clear the correlated target so the smoke can create a fresh comment.",
      target: {
        ...selection.target,
        selectionStatus: "blocked",
        selectionSummary: "Sandbox target policy permits create only.",
      },
    } satisfies GitHubLiveTargetSelectionResult;
  }

  if (registryResolution.actionPolicy === "update_only" && selection.attemptedAction === "create") {
    return {
      ...selection,
      status: "blocked",
      mode: "none",
      attemptedAction: "none",
      permissionResult: "blocked",
      failureReason: "github_auth_smoke_create_disallowed_by_sandbox_policy",
      summary: "GitHub live auth smoke is blocked because the selected sandbox target only permits update.",
      suggestedNextAction: "Reuse a correlated target that already has a comment, or change the sandbox target policy to allow create.",
      target: {
        ...selection.target,
        selectionStatus: "blocked",
        selectionSummary: "Sandbox target policy permits update only.",
      },
    } satisfies GitHubLiveTargetSelectionResult;
  }

  return selection;
}

function buildGitHubAuthSmokeEvidence(params: {
  result: GitHubAuthSmokeResult;
  selection: GitHubLiveTargetSelectionResult;
  registryResolution: ReturnType<typeof resolveGitHubSandboxTarget>;
}): GitHubLiveAuthEvidence {
  const targetReference =
    params.result.target.repository && params.result.target.targetType && params.result.target.targetNumber
      ? `${params.result.target.repository}:${params.result.target.targetType}:${params.result.target.targetNumber}`
      : null;

  return {
    attemptedAt: params.result.ranAt,
    sandboxTargetProfileId: params.registryResolution.profileId,
    sandboxTargetConfigVersion: params.registryResolution.configVersion,
    sandboxTargetConfigSource: params.registryResolution.configSource,
    targetSelectionStatus: params.result.target.selectionStatus,
    targetSelectionSummary: params.selection.summary,
    permissionResult: params.result.permissionResult,
    action:
      params.result.status === "passed"
        ? "success"
        : params.result.status === "failed"
          ? "failed"
          : params.result.attemptedAction,
    providerUsed: params.result.providerUsed,
    target: params.result.target,
    lastCommentId: params.result.target.commentId,
    targetReference,
    failureReason: params.result.failureReason,
    summary: params.result.summary,
    suggestedNextAction: params.result.suggestedNextAction,
  };
}

function withSandboxTarget(state: OrchestratorState, selection: GitHubLiveTargetSelectionResult) {
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

export function applyGitHubAuthSmokeToState(state: OrchestratorState, result: GitHubAuthSmokeResult, evidence: GitHubLiveAuthEvidence) {
  return orchestratorStateSchema.parse({
    ...state,
    authSmokeStatus: result.status,
    authSmokeSuccessStatus: result.status === "passed" ? "success" : result.status === "not_run" ? "not_run" : "non_success",
    authSmokeMode: result.mode,
    authSmokeTarget: result.target,
    authSmokePermissionResult: result.permissionResult,
    authSmokeFailureReason: result.failureReason,
    sandboxTargetProfileId: evidence.sandboxTargetProfileId,
    sandboxTargetConfigVersion: evidence.sandboxTargetConfigVersion,
    targetSelectionStatus: result.target.selectionStatus,
    lastAuthSmokeTarget: result.target,
    lastAuthSmokeAction:
      result.attemptedAction === "create" || result.attemptedAction === "update" || result.attemptedAction === "skip" || result.attemptedAction === "blocked"
        ? result.attemptedAction
        : "none",
    lastAuthSmokeEvidencePath: result.evidencePath,
    lastLiveSmokeEvidencePath: result.evidencePath,
    lastLiveAuthEvidence: evidence,
    lastGitHubAuthSmokeResult: result,
    updatedAt: result.ranAt,
  });
}
