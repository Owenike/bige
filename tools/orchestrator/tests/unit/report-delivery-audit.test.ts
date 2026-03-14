import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { statusReportSummarySchema, type OrchestratorState } from "../../src/schemas";
import { applyStatusReportToState } from "../../src/status-reporting";

function createState(): OrchestratorState {
  return {
    ...createInitialState({
      id: "report-delivery-audit-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Track report delivery attempts",
      objective: "Persist recent live GitHub reporting attempts",
      subtasks: ["status-reporting", "audit"],
      successCriteria: ["delivery attempts are retained"],
    }),
    sourceEventType: "issue_opened" as const,
    sourceEventId: "issue:7:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 7,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#7",
    },
  };
}

test("report delivery audit keeps recent attempts with explicit action history", () => {
  let state = createState();
  const summaries = [
    { action: "created", status: "comment_created", permissionStatus: "ready", failureReason: null },
    { action: "updated", status: "comment_updated", permissionStatus: "ready", failureReason: null },
    { action: "skipped", status: "skipped", permissionStatus: "missing_token", failureReason: "missing_github_token" },
    { action: "blocked", status: "blocked", permissionStatus: "blocked", failureReason: "missing_github_thread_target" },
    { action: "failed", status: "failed", permissionStatus: "create_denied", failureReason: "github_report_create_denied" },
    { action: "failed", status: "failed", permissionStatus: "update_denied", failureReason: "github_report_update_denied" },
  ] as const;

  for (const [index, summary] of summaries.entries()) {
    state = applyStatusReportToState(
      state,
      statusReportSummarySchema.parse({
        status: summary.status,
        provider: "github_comment",
        summary: `attempt-${index}`,
        markdownPath: null,
        payloadPath: null,
        targetUrl: `https://github.com/example/bige/issues/7#issuecomment-${index + 1}`,
        targetNumber: 7,
        commentId: index + 1,
        correlationId: "orchestrator-status:report-delivery-audit-state",
        readiness: summary.status === "blocked" ? "blocked" : summary.status === "skipped" ? "degraded" : "ready",
        permissionStatus: summary.permissionStatus,
        targetKind: "issue_comment",
        targetStrategy: summary.action === "created" ? "create" : summary.action === "updated" ? "update" : summary.action === "blocked" ? "blocked" : "skip",
        failureReason: summary.failureReason,
        action: summary.action,
        auditId: `audit-${index}`,
        nextAction: "inspect",
        ranAt: new Date(Date.UTC(2026, 2, 14, 12, index, 0)).toISOString(),
      }),
    );
  }

  assert.equal(state.reportDeliveryAttempts.length, 5);
  assert.equal(state.reportDeliveryAttempts[0]?.id, "audit-1");
  assert.equal(state.lastReportDeliveryAuditId, "audit-5");
  assert.equal(state.reportDeliveryAttempts[state.reportDeliveryAttempts.length - 1]?.permissionCheckResult, "update_denied");
});
