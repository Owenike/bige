import type { GitHubLiveReportReadiness } from "../status-reporting";
import type { StatusReportPermissionStatus } from "../schemas";

export function mapReadinessToPermissionStatus(readiness: GitHubLiveReportReadiness): StatusReportPermissionStatus {
  if (readiness.failureReason === "github_live_reporting_disabled") {
    return "disabled";
  }
  if (readiness.failureReason === "missing_github_token") {
    return "missing_token";
  }
  if (readiness.failureReason === "missing_gh_cli") {
    return "missing_gh";
  }
  if (readiness.failureReason === "missing_github_thread_target") {
    return "blocked";
  }
  return readiness.status === "ready" ? "ready" : "unknown";
}

export function classifyGitHubReportingFailure(params: {
  error: unknown;
  attemptedAction: "create" | "update";
  correlatedTargetVisible?: boolean;
}) {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  const normalized = message.toLowerCase();

  if (normalized.includes("http 404") || normalized.includes("not found")) {
    return {
      permissionStatus: "target_invalid" as const,
      failureReason: "github_report_target_invalid",
      suggestedNextAction:
        "Verify that the issue, pull request, or correlated comment still exists before retrying live reporting.",
    };
  }
  if (normalized.includes("http 401") || normalized.includes("requires authentication")) {
    return {
      permissionStatus: "missing_token" as const,
      failureReason: "github_report_authentication_failed",
      suggestedNextAction: "Provide a valid GITHUB_TOKEN or GH_TOKEN before retrying live reporting.",
    };
  }
  if (normalized.includes("http 403") || normalized.includes("resource not accessible")) {
    return {
      permissionStatus:
        params.attemptedAction === "update" && params.correlatedTargetVisible
          ? ("correlation_not_updatable" as const)
          : params.attemptedAction === "update"
            ? ("update_denied" as const)
            : ("create_denied" as const),
      failureReason:
        params.attemptedAction === "update" && params.correlatedTargetVisible
          ? "github_report_correlation_not_updatable"
          : params.attemptedAction === "update"
            ? "github_report_update_denied"
            : "github_report_create_denied",
      suggestedNextAction:
        params.attemptedAction === "update" && params.correlatedTargetVisible
          ? "Clear or replace the stale correlated comment target, or use a token that can update that comment."
          : params.attemptedAction === "update"
          ? "Use a token that can update the correlated comment, or clear the stale target so reporting can recreate it."
          : "Use a token that can create issue or pull request comments on the target repository.",
    };
  }
  return {
    permissionStatus: params.attemptedAction === "update" ? ("update_denied" as const) : ("create_denied" as const),
    failureReason: params.attemptedAction === "update" ? "github_report_update_failed" : "github_report_create_failed",
    suggestedNextAction:
      params.attemptedAction === "update"
        ? "Inspect gh stderr/output and verify that the correlated comment is still writable."
        : "Inspect gh stderr/output and verify that the repository target is writable for comment creation.",
  };
}

export function summarizePermissionStatus(status: StatusReportPermissionStatus) {
  switch (status) {
    case "ready":
      return "GitHub live reporting permissions look usable.";
    case "disabled":
      return "GitHub live reporting is disabled.";
    case "missing_token":
      return "GitHub live reporting is missing a token.";
    case "missing_gh":
      return "GitHub live reporting is missing gh.";
    case "target_invalid":
      return "GitHub live reporting target is invalid or no longer exists.";
    case "create_denied":
      return "GitHub live reporting cannot create a comment on the target thread.";
    case "update_denied":
      return "GitHub live reporting cannot update the correlated comment.";
    case "correlation_not_updatable":
      return "GitHub live reporting can see the correlation target but cannot safely update it.";
    case "blocked":
      return "GitHub live reporting is blocked by missing thread context.";
    default:
      return "GitHub live reporting permission status is unknown.";
  }
}
