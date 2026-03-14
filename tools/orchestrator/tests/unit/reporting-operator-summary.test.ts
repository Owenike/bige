import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { statusReportSummarySchema, type OrchestratorState } from "../../src/schemas";
import { applyStatusReportToState, inspectGitHubReportingOperatorSummary } from "../../src/status-reporting";

test("reporting operator summary shows recent attempts and next action", async () => {
  let state: OrchestratorState = {
    ...createInitialState({
      id: "reporting-operator-summary-state",
      repoPath: process.cwd(),
      repoName: "bige",
      userGoal: "Explain live reporting status",
      objective: "Show operator-readable reporting diagnostics",
      subtasks: ["status-reporting", "diagnostics"],
      successCriteria: ["summary is readable"],
    }),
    sourceEventType: "pull_request_opened" as const,
    sourceEventId: "pr:11:opened",
    sourceEventSummary: {
      repository: "example/bige",
      branch: "feature/reporting",
      issueNumber: null,
      prNumber: 11,
      commentId: null,
      label: null,
      headSha: "abc123",
      command: null,
      triggerReason: "pull_request_opened from example/bige#11",
    },
  };

  state = applyStatusReportToState(
    state,
    statusReportSummarySchema.parse({
      status: "comment_created",
      provider: "github_comment",
      summary: "GitHub comment created.",
      markdownPath: null,
      payloadPath: null,
      targetUrl: "https://github.com/example/bige/pull/11#issuecomment-777",
      targetNumber: 11,
      commentId: 777,
      correlationId: "orchestrator-status:reporting-operator-summary-state",
      readiness: "ready",
      permissionStatus: "ready",
      targetKind: "pull_request_comment",
      targetStrategy: "create",
      failureReason: null,
      action: "created",
      auditId: "audit-1",
      nextAction: "Reuse the correlated comment.",
      ranAt: new Date().toISOString(),
    }),
  );

  const summary = await inspectGitHubReportingOperatorSummary({
    state,
    enabled: true,
    token: null,
  });
  assert.match(summary.summaryText, /Last permission status: ready/);
  assert.match(summary.summaryText, /Current permission smoke: degraded \/ missing_token \/ skip/);
  assert.match(summary.summaryText, /Recent attempts:/);
});
