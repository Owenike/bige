import type { OrchestratorState, StatusReportTarget } from "../schemas";

export type GitHubThreadTarget = {
  repository: string;
  targetNumber: number;
  targetKind: StatusReportTarget["kind"];
  isPullRequest: boolean;
};

export type CommentTargetingDecision = {
  status: "ready" | "blocked";
  action: "create" | "update" | "blocked";
  targetKind: StatusReportTarget["kind"];
  repository: string | null;
  targetNumber: number | null;
  commentId: number | null;
  targetUrl: string | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
};

export function resolveGitHubThreadTarget(state: OrchestratorState): GitHubThreadTarget | null {
  const source = state.sourceEventSummary;
  if (!source || (!source.issueNumber && !source.prNumber)) {
    return null;
  }
  return {
    repository: source.repository,
    targetNumber: source.prNumber ?? source.issueNumber!,
    targetKind: source.prNumber ? "pull_request_comment" : "issue_comment",
    isPullRequest: Boolean(source.prNumber),
  };
}

export function resolveCommentTargetingDecision(params: {
  state: OrchestratorState;
  discoveredComment?:
    | {
        id: number | null;
        url: string | null;
      }
    | null;
}) {
  const threadTarget = resolveGitHubThreadTarget(params.state);
  if (!threadTarget) {
    return {
      status: "blocked",
      action: "blocked",
      targetKind: "artifact_only",
      repository: null,
      targetNumber: null,
      commentId: null,
      targetUrl: null,
      summary: "Live GitHub comment reporting is blocked because no issue or pull request target is available.",
      failureReason: "missing_github_thread_target",
      suggestedNextAction: "Run status reporting from an issue or pull request sourced task, or rely on payload-only reporting.",
    } satisfies CommentTargetingDecision;
  }

  const storedTarget = params.state.lastStatusReportTarget;
  const discoveredCommentId = params.discoveredComment?.id ?? null;
  const discoveredCommentUrl = params.discoveredComment?.url ?? null;
  const storedCommentId =
    storedTarget?.kind === threadTarget.targetKind &&
    storedTarget.targetNumber === threadTarget.targetNumber &&
    storedTarget.repository === threadTarget.repository
      ? storedTarget.commentId
      : null;
  const storedTargetUrl =
    storedTarget?.kind === threadTarget.targetKind &&
    storedTarget.targetNumber === threadTarget.targetNumber &&
    storedTarget.repository === threadTarget.repository
      ? storedTarget.targetUrl
      : null;

  const effectiveCommentId = discoveredCommentId ?? storedCommentId ?? null;
  const effectiveTargetUrl = discoveredCommentUrl ?? storedTargetUrl ?? null;

  if (effectiveCommentId) {
    return {
      status: "ready",
      action: "update",
      targetKind: threadTarget.targetKind,
      repository: threadTarget.repository,
      targetNumber: threadTarget.targetNumber,
      commentId: effectiveCommentId,
      targetUrl: effectiveTargetUrl,
      summary: `Live GitHub status reporting will update the existing correlated ${threadTarget.isPullRequest ? "pull request" : "issue"} comment.`,
      failureReason: null,
      suggestedNextAction: "Run the live reporting path to patch the correlated comment.",
    } satisfies CommentTargetingDecision;
  }

  return {
    status: "ready",
    action: "create",
    targetKind: threadTarget.targetKind,
    repository: threadTarget.repository,
    targetNumber: threadTarget.targetNumber,
    commentId: null,
    targetUrl: null,
    summary: `Live GitHub status reporting will create a new correlated ${threadTarget.isPullRequest ? "pull request" : "issue"} comment.`,
    failureReason: null,
    suggestedNextAction: "Run the live reporting path to create the first correlated comment.",
  } satisfies CommentTargetingDecision;
}
