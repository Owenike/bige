import type {
  GitHubAuthSmokeTarget,
  GitHubTargetSelectionStatus,
  OrchestratorState,
  StatusReportPermissionStatus,
} from "../schemas";

export type RequestedGitHubSandboxTarget = {
  repository: string | null;
  targetType: "issue" | "pull_request" | null;
  targetNumber: number | null;
  allowCorrelatedReuse?: boolean;
};

export type GitHubLiveTargetSelectionResult = {
  status: GitHubTargetSelectionStatus;
  target: GitHubAuthSmokeTarget;
  mode: "none" | "sandbox_issue" | "sandbox_pull_request" | "correlated_reuse";
  attemptedAction: "none" | "create" | "update";
  permissionResult: StatusReportPermissionStatus;
  failureReason: string | null;
  summary: string;
  suggestedNextAction: string;
};

function buildTarget(params: Partial<GitHubAuthSmokeTarget>): GitHubAuthSmokeTarget {
  return {
    repository: params.repository ?? null,
    targetType: params.targetType ?? null,
    targetNumber: params.targetNumber ?? null,
    commentId: params.commentId ?? null,
    selectionStatus: params.selectionStatus ?? "unknown",
    selectionSummary: params.selectionSummary ?? null,
  };
}

export function selectGitHubLiveSmokeTarget(params: {
  state: OrchestratorState;
  requestedTarget?: RequestedGitHubSandboxTarget | null;
}) {
  const requested = params.requestedTarget ?? null;
  const existing = params.state.lastStatusReportTarget;

  if (requested?.repository && requested.targetType && requested.targetNumber) {
    const explicitKind = requested.targetType === "pull_request" ? "pull_request_comment" : "issue_comment";
    if (existing?.commentId && existing.repository && existing.repository !== requested.repository) {
      return {
        status: "blocked",
        target: buildTarget({
          repository: requested.repository,
          targetType: requested.targetType,
          targetNumber: requested.targetNumber,
          selectionStatus: "blocked",
          selectionSummary: "Sandbox target conflicts with the stored correlated repository.",
        }),
        mode: "none",
        attemptedAction: "none",
        permissionResult: "repository_mismatch",
        failureReason: "github_auth_smoke_repository_mismatch",
        summary: "GitHub live auth smoke is blocked because the explicit sandbox target does not match the stored correlated repository.",
        suggestedNextAction: "Clear the stale correlated target or choose the matching repository for the sandbox smoke.",
      } satisfies GitHubLiveTargetSelectionResult;
    }
    return {
      status: "sandbox_explicit",
      target: buildTarget({
        repository: requested.repository,
        targetType: requested.targetType,
        targetNumber: requested.targetNumber,
        commentId:
          existing?.repository === requested.repository &&
          existing.targetNumber === requested.targetNumber &&
          existing.kind === explicitKind
            ? existing.commentId
            : null,
        selectionStatus: "sandbox_explicit",
        selectionSummary: "Explicit sandbox target selected for GitHub live auth smoke.",
      }),
      mode: requested.targetType === "pull_request" ? "sandbox_pull_request" : "sandbox_issue",
      attemptedAction:
        existing?.repository === requested.repository &&
        existing.targetNumber === requested.targetNumber &&
        existing.kind === explicitKind &&
        Boolean(existing.commentId)
          ? "update"
          : "create",
      permissionResult: "ready",
      failureReason: null,
      summary: "GitHub live auth smoke will use the explicit sandbox target.",
      suggestedNextAction: "Run the auth smoke against the explicit sandbox target.",
    } satisfies GitHubLiveTargetSelectionResult;
  }

  if (requested && (requested.repository || requested.targetType || requested.targetNumber)) {
    return {
      status: "manual_required",
      target: buildTarget({
        repository: requested.repository ?? null,
        targetType: requested.targetType ?? null,
        targetNumber: requested.targetNumber ?? null,
        selectionStatus: "manual_required",
        selectionSummary: "Sandbox target is incomplete.",
      }),
      mode: "none",
      attemptedAction: "none",
      permissionResult: "blocked",
      failureReason: "github_auth_smoke_incomplete_target",
      summary: "GitHub live auth smoke requires repository, target type, and target number for an explicit sandbox target.",
      suggestedNextAction: "Provide --target-repo, --target-type, and --target-number together.",
    } satisfies GitHubLiveTargetSelectionResult;
  }

  if (requested?.allowCorrelatedReuse && existing?.repository && existing.targetNumber) {
    return {
      status: "correlated_reuse",
      target: buildTarget({
        repository: existing.repository,
        targetType: existing.kind === "pull_request_comment" ? "pull_request" : existing.kind === "issue_comment" ? "issue" : null,
        targetNumber: existing.targetNumber,
        commentId: existing.commentId,
        selectionStatus: "correlated_reuse",
        selectionSummary: "Existing correlated target will be reused for auth smoke.",
      }),
      mode: "correlated_reuse",
      attemptedAction: existing.commentId ? "update" : "create",
      permissionResult: "ready",
      failureReason: null,
      summary: "GitHub live auth smoke will reuse the stored correlated target.",
      suggestedNextAction: existing.commentId
        ? "Run the auth smoke to validate correlated comment update permissions."
        : "Run the auth smoke to create the first correlated comment on the reused target.",
    } satisfies GitHubLiveTargetSelectionResult;
  }

  return {
    status: "manual_required",
    target: buildTarget({
      selectionStatus: "manual_required",
      selectionSummary: "No explicit sandbox target was provided.",
    }),
    mode: "none",
    attemptedAction: "none",
    permissionResult: "blocked",
    failureReason: "github_auth_smoke_missing_sandbox_target",
    summary: "GitHub live auth smoke is blocked until an explicit sandbox target is provided.",
    suggestedNextAction: "Provide --target-repo, --target-type, and --target-number, or enable --allow-correlated-reuse for a known safe target.",
  } satisfies GitHubLiveTargetSelectionResult;
}
