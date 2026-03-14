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
  if (readiness.failureReason === "github_auth_smoke_missing_sandbox_target") {
    return "blocked";
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
      permissionStatus:
        params.attemptedAction === "update" && params.correlatedTargetVisible
          ? ("correlation_target_missing" as const)
          : ("target_not_found" as const),
      failureReason:
        params.attemptedAction === "update" && params.correlatedTargetVisible
          ? "github_report_correlation_target_missing"
          : "github_report_target_not_found",
      suggestedNextAction:
        params.attemptedAction === "update" && params.correlatedTargetVisible
          ? "The correlated comment no longer exists. Clear the stale target or recreate the correlated comment on the sandbox thread."
          : "Verify that the target repository and issue or pull request number are valid before retrying live reporting.",
    };
  }
  if (normalized.includes("unprocessable") || normalized.includes("validation failed")) {
    return {
      permissionStatus: "target_invalid" as const,
      failureReason: "github_report_target_invalid",
      suggestedNextAction: "Fix the repository, target type, or target number before retrying live reporting.",
    };
  }
  if (normalized.includes("http 401") || normalized.includes("requires authentication")) {
    return {
      permissionStatus: "missing_token" as const,
      failureReason: "github_report_authentication_failed",
      suggestedNextAction: "Provide a valid GITHUB_TOKEN or GH_TOKEN before retrying live reporting.",
    };
  }
  if (normalized.includes("locked")) {
    return {
      permissionStatus: "target_locked_or_not_updatable" as const,
      failureReason: "github_report_target_locked_or_not_updatable",
      suggestedNextAction: "Choose a different sandbox target or wait until the existing target becomes writable again.",
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
    case "target_not_found":
      return "GitHub live reporting target could not be found.";
    case "create_denied":
      return "GitHub live reporting cannot create a comment on the target thread.";
    case "update_denied":
      return "GitHub live reporting cannot update the correlated comment.";
    case "target_locked_or_not_updatable":
      return "GitHub live reporting target is locked or currently not updatable.";
    case "correlation_target_missing":
      return "GitHub live reporting expected a correlated comment target, but it no longer exists.";
    case "correlation_not_updatable":
      return "GitHub live reporting can see the correlation target but cannot safely update it.";
    case "repository_mismatch":
      return "GitHub live reporting target does not match the expected repository.";
    case "blocked":
      return "GitHub live reporting is blocked by missing thread context.";
    default:
      return "GitHub live reporting permission status is unknown.";
  }
}
