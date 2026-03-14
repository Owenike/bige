import type {
  OrchestratorState,
  ReportDeliveryAttempt,
  StatusReportSummary,
} from "../schemas";

const MAX_ATTEMPTS = 5;

function mapSummaryActionToAttemptAction(summary: StatusReportSummary): ReportDeliveryAttempt["action"] {
  if (summary.action === "created") return "create";
  if (summary.action === "updated") return "update";
  if (summary.action === "blocked") return "blocked";
  if (summary.action === "failed") return "failed";
  return "skip";
}

export function buildReportDeliveryAttempt(summary: StatusReportSummary): ReportDeliveryAttempt {
  const targetId = summary.commentId ?? summary.targetNumber ?? null;
  return {
    id: summary.auditId ?? `report-delivery:${summary.correlationId ?? "none"}:${summary.ranAt}:${summary.action}`,
    attemptedAt: summary.ranAt,
    targetType: summary.targetKind,
    targetId,
    targetUrl: summary.targetUrl,
    action: mapSummaryActionToAttemptAction(summary),
    correlationId: summary.correlationId,
    readinessStatus: summary.readiness,
    permissionCheckResult: summary.permissionStatus,
    failureReason: summary.failureReason,
    providerUsed: summary.provider,
    summary: summary.summary,
    suggestedNextAction: summary.nextAction,
  };
}

export function applyReportDeliveryAudit(state: OrchestratorState, summary: StatusReportSummary) {
  const attempt = buildReportDeliveryAttempt(summary);
  const attempts = [...state.reportDeliveryAttempts, attempt].slice(-MAX_ATTEMPTS);
  return {
    attempts,
    lastAuditId: attempt.id,
  };
}

export function formatReportDeliveryAttempts(attempts: ReportDeliveryAttempt[]) {
  if (attempts.length === 0) {
    return "No report delivery attempts recorded.";
  }
  return attempts
    .map((attempt) =>
      [
        `${attempt.attemptedAt}`,
        `${attempt.action}`,
        `${attempt.targetType}:${attempt.targetId ?? "none"}`,
        `${attempt.permissionCheckResult}`,
        `${attempt.failureReason ?? "ok"}`,
      ].join(" | "),
    )
    .join("\n");
}
