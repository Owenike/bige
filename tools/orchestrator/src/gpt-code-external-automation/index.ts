import { execFile } from "node:child_process";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { OrchestratorDependencies } from "../orchestrator";
import { findLatestStateForThread } from "../github-events";
import { parseGptCodeChineseReport } from "../gpt-code-report";
import {
  gptCodeExternalAutomationResultSchema,
  gptCodeExternalRecoveryResultSchema,
  gptCodeExternalSourceMetadataSchema,
  gptCodeExternalTargetDispatchSchema,
  type GptCodeExternalAutomationResult,
  type GptCodeExternalRecoveryResult,
  type GptCodeExternalSourceMetadata,
  type GptCodeExternalTargetDispatch,
} from "../gpt-code-report/schema";
import {
  consumeQueuedGptCodeReportTransport,
  submitGptCodeReportTransportEntry,
} from "../gpt-code-report-transport";
import { resolveGitHubThreadTarget } from "../comment-targeting";
import {
  gptCodeDispatchAttemptRecordSchema,
  gptCodeAutomationStateSchema,
  orchestratorStateSchema,
  type GptCodeDispatchAttemptRecord,
  type GptCodeAutomationState,
  type OrchestratorState,
} from "../schemas";

const execFileAsync = promisify(execFile);

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options?: {
    windowsHide?: boolean;
  },
) => Promise<{
  stdout: string;
  stderr: string;
}>;

type IssueCommentPayload = {
  action?: string;
  issue?: {
    id?: number;
    number?: number;
    title?: string;
    body?: string | null;
    updated_at?: string;
    pull_request?: unknown;
  };
  comment?: {
    id?: number;
    body?: string | null;
  };
  repository?: {
    full_name?: string;
  };
};

type PullRequestReviewCommentPayload = {
  action?: string;
  pull_request?: {
    id?: number;
    number?: number;
    title?: string;
    body?: string | null;
    updated_at?: string;
  };
  comment?: {
    id?: number;
    body?: string | null;
  };
  repository?: {
    full_name?: string;
  };
  number?: number;
};

type ExternalGitHubTargetRoute = {
  repository: string;
  targetNumber: number;
  targetDestination: string;
  targetCommentId: string | null;
  targetLaneClassification:
    | "github_issue_thread_comment_lane"
    | "github_pull_request_thread_comment_lane"
    | "github_live_smoke_comment_lane"
    | "github_status_report_comment_lane"
    | "github_source_thread_fallback_lane";
  routingDecision: "live_smoke_target" | "status_report_target" | "state_thread_target" | "source_thread_fallback";
  fallbackDecision:
    | "not_needed"
    | "live_smoke_target_fallback"
    | "status_report_target_fallback"
    | "source_thread_fallback";
  isPullRequest: boolean;
};

type GptCodeRecoveryRequestedAction = "auto" | "inspect" | "resume" | "replay";
type GptCodeRecoveryResolvedAction = "none" | "resume" | "replay";
type GptCodeReplayEligibility =
  | "not_evaluated"
  | "safe_to_resume"
  | "safe_to_replay"
  | "manual_only"
  | "exhausted_permanently"
  | "blocked";
type GptCodeReplayOutcome =
  | "not_run"
  | "success"
  | "manual_required"
  | "failed"
  | "retryable"
  | "exhausted"
  | "blocked";

type GptCodeRecoveryQueueClassification =
  | "not_applicable"
  | "resumable"
  | "replayable"
  | "retryable"
  | "manual_required"
  | "exhausted"
  | "blocked";

type ReplayEligibilityDecision = {
  replayEligibility: GptCodeReplayEligibility;
  replayBlockReason: string | null;
  requestedAction: GptCodeRecoveryRequestedAction;
  resolvedAction: GptCodeRecoveryResolvedAction;
  source: GptCodeExternalSourceMetadata | null;
  route: ExternalGitHubTargetRoute | null;
  targetAvailable: boolean;
  correlationConsistent: boolean;
  externalReferenceConsistent: boolean;
  recommendedAction: string;
};

async function defaultExecFileLike(file: string, args: readonly string[], options?: { windowsHide?: boolean }) {
  const { stdout, stderr } = await execFileAsync(file, args, {
    windowsHide: options?.windowsHide,
    encoding: "utf8",
  });
  return {
    stdout: String(stdout),
    stderr: String(stderr),
  };
}

function buildAutomationState(params: {
  stateId: string;
  current: GptCodeAutomationState | null | undefined;
  patch: Partial<GptCodeAutomationState>;
}) {
  const merged = gptCodeAutomationStateSchema.parse({
    ...(params.current ?? {}),
    ...params.patch,
  });
  return gptCodeAutomationStateSchema.parse({
    ...merged,
    ...deriveRecoveryErgonomics({
      stateId: params.stateId,
      automation: merged,
    }),
  });
}

async function saveStateWithAutomationPatch(params: {
  state: OrchestratorState;
  dependencies: OrchestratorDependencies;
  patch: Partial<GptCodeAutomationState>;
}) {
  const now = (params.dependencies.now ?? (() => new Date()))();
  const updated = orchestratorStateSchema.parse({
    ...params.state,
    lastGptCodeAutomationState: buildAutomationState({
      stateId: params.state.id,
      current: params.state.lastGptCodeAutomationState,
      patch: params.patch,
    }),
    updatedAt: now.toISOString(),
  });
  await params.dependencies.storage.saveState(updated);
  return updated;
}

function appendArtifacts(
  state: OrchestratorState,
  artifacts: Array<{ kind: string; label: string; path: string | null; value: string | null }>,
) {
  if (!state.lastExecutionReport) {
    return state;
  }

  return orchestratorStateSchema.parse({
    ...state,
    lastExecutionReport: {
      ...state.lastExecutionReport,
      artifacts: [...state.lastExecutionReport.artifacts, ...artifacts],
    },
  });
}

function buildInstructionCorrelationId(stateId: string) {
  return `orchestrator-next-instruction:${stateId}`;
}

function withInstructionMarker(markdown: string, stateId: string) {
  const marker = `<!-- ${buildInstructionCorrelationId(stateId)} -->`;
  return markdown.includes(marker) ? markdown : `${marker}\n${markdown}`;
}

function extractInstructionCorrelationId(body: string) {
  const match = body.match(/<!--\s*(orchestrator-next-instruction:[^>\s]+)\s*-->/i);
  return match ? match[1] : null;
}

function looksLikeGptCodeChineseReport(body: string) {
  const parsed = parseGptCodeChineseReport(body);
  return (
    parsed.suggestionLevel !== null ||
    parsed.modifiedFiles.length > 0 ||
    parsed.acceptanceResults.length > 0 ||
    parsed.ciRuns.length > 0
  );
}

function classifyGitHubDispatchFailure(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("no comment found") ||
    message.includes("unprocessable") ||
    message.includes("422") ||
    message.includes("gone")
  ) {
    return {
      outcome: "failed" as const,
      failureClass: "target_invalid" as const,
      retryEligible: false,
    };
  }
  if (
    message.includes("bad credentials") ||
    message.includes("authentication") ||
    message.includes("403") ||
    message.includes("401") ||
    message.includes("insufficient permission")
  ) {
    return {
      outcome: "failed" as const,
      failureClass: "auth" as const,
      retryEligible: false,
    };
  }
  if (
    message.includes("rate limit") ||
    message.includes("secondary rate")
  ) {
    return {
      outcome: "retryable" as const,
      failureClass: "rate_limited" as const,
      retryEligible: true,
    };
  }
  if (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("econn") ||
    message.includes("connect") ||
    message.includes("reset by peer")
  ) {
    return {
      outcome: "retryable" as const,
      failureClass: "network" as const,
      retryEligible: true,
    };
  }
  if (
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  ) {
    return {
      outcome: "retryable" as const,
      failureClass: "transient" as const,
      retryEligible: true,
    };
  }
  return {
    outcome: "failed" as const,
    failureClass: "unknown" as const,
    retryEligible: false,
  };
}

function mapSourceTypeToTransportSource(source: GptCodeExternalSourceMetadata) {
  switch (source.sourceType) {
    case "github_pull_request_review_comment":
      return "github_pull_request_review_comment";
    case "github_issue_body":
      return "github_issue_body";
    case "github_pull_request_body":
      return "github_pull_request_body";
    default:
      return "github_issue_comment";
  }
}

function mapSourceTypeToSourceEventType(source: GptCodeExternalSourceMetadata) {
  switch (source.sourceType) {
    case "github_pull_request_review_comment":
      return "pull_request_review_comment_report";
    case "github_issue_body":
      return "issue_body_report";
    case "github_pull_request_body":
      return "pull_request_body_report";
    default:
      return "issue_comment_report";
  }
}

function mapTargetOutcomeToStatus(outcome: GptCodeExternalTargetDispatch["outcome"]) {
  if (outcome === "success") {
    return "dispatched" as const;
  }
  if (outcome === "exhausted") {
    return "exhausted" as const;
  }
  if (outcome === "manual_required") {
    return "manual_required" as const;
  }
  if (outcome === "retryable") {
    return "retryable" as const;
  }
  return "failed" as const;
}

function buildRouteTraceEntry(params: {
  route: ExternalGitHubTargetRoute;
  outcome: GptCodeExternalTargetDispatch["outcome"];
  failureClass: GptCodeExternalTargetDispatch["failureClass"];
}) {
  return [
    params.route.routingDecision,
    params.route.targetLaneClassification,
    params.route.targetDestination,
    params.outcome,
    params.failureClass ?? "ok",
  ].join(" | ");
}

function classifyDispatchRecoverability(params: {
  outcome: GptCodeExternalTargetDispatch["outcome"];
  attemptCount: number;
  maxAttempts: number;
  retryEligible: boolean;
}) {
  const exhausted =
    params.outcome === "exhausted" ||
    (params.outcome === "retryable" && params.attemptCount >= params.maxAttempts);
  const canRetry = params.retryEligible && params.outcome === "retryable" && params.attemptCount < params.maxAttempts;
  const normalizedOutcome = exhausted ? "exhausted" : params.outcome;
  return {
    exhausted,
    canRetry,
    normalizedOutcome,
  };
}

function deriveManualReviewReason(params: {
  dispatch: GptCodeExternalTargetDispatch;
  exhausted: boolean;
}) {
  if (params.dispatch.outcome === "success") {
    return null;
  }
  if (params.exhausted) {
    return `External target dispatch exhausted after ${params.dispatch.attemptCount}/${params.dispatch.maxAttempts} attempts.`;
  }
  if (params.dispatch.outcome === "manual_required") {
    return "External target dispatch requires manual review before it can proceed safely.";
  }
  if (params.dispatch.outcome === "retryable") {
    return `External target dispatch is retryable after attempt ${params.dispatch.attemptCount}/${params.dispatch.maxAttempts}.`;
  }
  if (params.dispatch.failureClass) {
    return `External target dispatch failed with ${params.dispatch.failureClass}.`;
  }
  return "External target dispatch failed and needs operator review.";
}

function deriveRecommendedNextStep(params: {
  dispatch: GptCodeExternalTargetDispatch;
  exhausted: boolean;
  canRetry: boolean;
}) {
  if (params.dispatch.outcome === "success") {
    return "Wait for the external target response or the next GPT CODE report.";
  }
  if (params.canRetry) {
    return "Retry the external target dispatch or inspect the target health before retrying.";
  }
  if (params.exhausted) {
    return "Review the dispatch history and fallback chain, then decide whether a safe manual retry is still possible.";
  }
  if (params.dispatch.outcome === "manual_required") {
    return "Inspect the dispatch history and take over the external target handoff manually.";
  }
  return "Review the external target dispatch outcome manually.";
}

function buildDispatchSummary(params: {
  dispatch: GptCodeExternalTargetDispatch;
  exhausted: boolean;
}) {
  const failureSuffix = params.dispatch.failureClass ? ` (${params.dispatch.failureClass})` : "";
  const traceSuffix =
    params.dispatch.routeTrace.length > 0 ? `; routeTrace=${params.dispatch.routeTrace.join(" => ")}` : "";
  if (params.dispatch.outcome === "success") {
    return `Attempt ${params.dispatch.attemptCount}/${params.dispatch.maxAttempts} delivered to ${params.dispatch.targetLaneClassification}.`;
  }
  if (params.exhausted) {
    return `Attempt ${params.dispatch.attemptCount}/${params.dispatch.maxAttempts} exhausted after retryable failures${failureSuffix}${traceSuffix}`;
  }
  return `Attempt ${params.dispatch.attemptCount}/${params.dispatch.maxAttempts} ended as ${params.dispatch.outcome}${failureSuffix}${traceSuffix}`;
}

function buildFallbackSummary(routeTrace: string[]) {
  if (routeTrace.length <= 1) {
    return routeTrace[0] ?? "No fallback was needed.";
  }
  return `Fallback chain: ${routeTrace.join(" => ")}`;
}

function toDispatchAttemptRecord(params: {
  dispatch: GptCodeExternalTargetDispatch;
  recoveryAction?: GptCodeRecoveryResolvedAction;
  replayAttemptCount?: number;
}) {
  return gptCodeDispatchAttemptRecordSchema.parse({
    attemptCount: params.dispatch.attemptCount,
    retryCount: params.dispatch.retryCount,
    recoveryAction: params.recoveryAction ?? "none",
    recoveryAttemptCount: params.replayAttemptCount ?? 0,
    targetLaneClassification: params.dispatch.targetLaneClassification,
    targetDestination: params.dispatch.targetDestination,
    routingDecision: params.dispatch.routingDecision,
    fallbackDecision: params.dispatch.fallbackDecision,
    outcome: params.dispatch.outcome,
    retryEligible: params.dispatch.retryEligible,
    failureClass: params.dispatch.failureClass,
    externalReferenceId: params.dispatch.externalReferenceId,
    externalUrl: params.dispatch.externalUrl,
    dispatchedAt: params.dispatch.dispatchedAt,
    routeTrace: params.dispatch.routeTrace,
    deliverySummary: params.dispatch.deliverySummary,
  });
}

function upsertDispatchAttemptHistory(params: {
  current: GptCodeDispatchAttemptRecord[];
  dispatch: GptCodeExternalTargetDispatch;
  recoveryAction?: GptCodeRecoveryResolvedAction;
  replayAttemptCount?: number;
}) {
  const next = toDispatchAttemptRecord({
    dispatch: params.dispatch,
    recoveryAction: params.recoveryAction,
    replayAttemptCount: params.replayAttemptCount,
  });
  const history = [...params.current.filter((entry) => entry.attemptCount !== next.attemptCount), next];
  return history.sort((left, right) => left.attemptCount - right.attemptCount);
}

function summarizeDispatchHistory(history: GptCodeDispatchAttemptRecord[]) {
  if (history.length === 0) {
    return "No external target dispatch attempts recorded yet.";
  }
  return history
    .map((entry) => {
      const recoverySuffix =
        entry.recoveryAction !== "none" ? ` ${entry.recoveryAction}:${entry.recoveryAttemptCount}` : "";
      return `#${entry.attemptCount} ${entry.outcome} ${entry.targetLaneClassification ?? "none"} ${entry.failureClass ?? "ok"}${recoverySuffix}`;
    })
    .join(" | ");
}

function summarizeRetryPolicy(params: {
  maxAttempts: number;
  currentAttemptCount: number;
  retryCount: number;
  canRetry: boolean;
  exhausted: boolean;
}) {
  const remaining = Math.max(params.maxAttempts - params.currentAttemptCount, 0);
  if (params.exhausted) {
    return `Retry policy exhausted after ${params.currentAttemptCount}/${params.maxAttempts} attempts (${params.retryCount} retries).`;
  }
  if (params.canRetry) {
    return `Retry policy allows another attempt; ${remaining} attempt(s) remain out of ${params.maxAttempts}.`;
  }
  return `Retry policy settled after ${params.currentAttemptCount}/${params.maxAttempts} attempts (${params.retryCount} retries).`;
}

function summarizeRecoverability(params: {
  canRetry: boolean;
  exhausted: boolean;
  dispatch: GptCodeExternalTargetDispatch;
}) {
  if (params.dispatch.outcome === "success") {
    return "External lane is recoverable and currently healthy; no operator retry is needed.";
  }
  if (params.canRetry) {
    return "External lane is still recoverable; a safe retry remains available.";
  }
  if (params.exhausted) {
    return "External lane exhausted its safe retries; operator review is required before any further retry.";
  }
  return "External lane is not auto-recoverable; operator review is required.";
}

function summarizeOperatorHandoff(params: {
  dispatch: GptCodeExternalTargetDispatch;
  canRetry: boolean;
  exhausted: boolean;
}) {
  const reason = params.dispatch.manualReviewReason ?? deriveManualReviewReason({
    dispatch: params.dispatch,
    exhausted: params.exhausted,
  });
  const next = params.dispatch.recommendedNextStep ?? deriveRecommendedNextStep({
    dispatch: params.dispatch,
    exhausted: params.exhausted,
    canRetry: params.canRetry,
  });
  return [
    reason ?? "No manual review reason recorded.",
    `Tried ${params.dispatch.attemptCount}/${params.dispatch.maxAttempts} attempt(s).`,
    params.dispatch.routeTrace.length > 0 ? params.dispatch.routeTrace.join(" => ") : "No fallback chain recorded.",
    `Safe retry remaining: ${params.canRetry}.`,
    `Next: ${next}`,
  ].join(" ");
}

function summarizeRecoveryHistory(params: {
  currentSummary: string | null | undefined;
  recoveryAction: GptCodeRecoveryResolvedAction;
  replayAttemptCount: number;
  outcome: GptCodeReplayOutcome;
  dispatchedAt: string | null;
}) {
  const latest = `recovery#${params.replayAttemptCount} ${params.recoveryAction} -> ${params.outcome} at ${params.dispatchedAt ?? "unknown"}`;
  if (!params.currentSummary) {
    return latest;
  }
  return `${params.currentSummary} | ${latest}`;
}

function classifyRecoveryQueueClassification(automation: GptCodeAutomationState): GptCodeRecoveryQueueClassification {
  if (automation.replayEligibility === "safe_to_resume") {
    return "resumable";
  }
  if (automation.replayEligibility === "safe_to_replay") {
    return "replayable";
  }
  if (automation.dispatchOutcome === "retryable" || automation.dispatchReliabilityOutcome === "retryable" || automation.canRetryDispatch) {
    return "retryable";
  }
  if (
    automation.externalAutomationOutcome === "manual_required" ||
    automation.dispatchOutcome === "manual_required" ||
    automation.replayEligibility === "manual_only"
  ) {
    return "manual_required";
  }
  if (
    automation.dispatchExhausted ||
    automation.externalAutomationOutcome === "exhausted" ||
    automation.dispatchOutcome === "exhausted" ||
    automation.replayEligibility === "exhausted_permanently"
  ) {
    return "exhausted";
  }
  if (automation.replayEligibility === "blocked" || automation.dispatchOutcome === "failed" || automation.externalAutomationOutcome === "failed") {
    return "blocked";
  }
  return "not_applicable";
}

function summarizeRecentRecoveryHistory(automation: GptCodeAutomationState) {
  const structuredEntries = automation.dispatchAttemptHistory
    .filter((attempt) => attempt.recoveryAction !== "none")
    .map((attempt) => {
      const target = attempt.targetLaneClassification ?? "unknown_target";
      const failure = attempt.failureClass ?? "ok";
      return `attempt#${attempt.attemptCount} ${attempt.recoveryAction} -> ${attempt.outcome} on ${target} (${failure})`;
    });
  const summaryEntries = (automation.recoveryHistorySummary ?? "")
    .split(" | ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const combined = [...summaryEntries, ...structuredEntries];
  return [...new Set(combined)].slice(-5);
}

function detectRepeatedFailurePattern(automation: GptCodeAutomationState) {
  const failureBuckets = new Map<string, number>();
  for (const attempt of automation.dispatchAttemptHistory) {
    if (!attempt.failureClass) {
      continue;
    }
    const key = `${attempt.failureClass}:${attempt.targetLaneClassification ?? "unknown_target"}`;
    failureBuckets.set(key, (failureBuckets.get(key) ?? 0) + 1);
  }
  let repeatedKey: string | null = null;
  let repeatedCount = 0;
  for (const [key, count] of failureBuckets.entries()) {
    if (count > repeatedCount) {
      repeatedKey = key;
      repeatedCount = count;
    }
  }
  if (!repeatedKey || repeatedCount < 2) {
    return null;
  }
  const [failureClass, lane] = repeatedKey.split(":");
  return `Repeated ${failureClass} failures on ${lane} (${repeatedCount} attempts).`;
}

function buildReplayRecommendationSummary(params: {
  automation: GptCodeAutomationState;
  queueClassification: GptCodeRecoveryQueueClassification;
}) {
  const target = params.automation.targetLaneClassification ?? "unknown_target";
  const fallback = params.automation.fallbackDecision ?? "not_needed";
  if (params.automation.replayEligibility === "safe_to_replay") {
    return `Recommended: replay once against ${target}; fallback=${fallback}.`;
  }
  if (params.automation.replayEligibility === "safe_to_resume") {
    return "Not recommended: prefer resume while a safe retry path still exists.";
  }
  if (params.queueClassification === "manual_required") {
    return `Blocked for replay: ${params.automation.replayBlockReason ?? params.automation.manualReviewReason ?? "manual review is required first."}`;
  }
  if (params.queueClassification === "exhausted") {
    return "Not recommended: the lane is exhausted until the target/fallback health is reviewed.";
  }
  if (params.queueClassification === "blocked") {
    return `Blocked: ${params.automation.replayBlockReason ?? "the current target/correlation no longer matches the recorded lane."}`;
  }
  return null;
}

function buildResumeRecommendationSummary(params: {
  automation: GptCodeAutomationState;
  queueClassification: GptCodeRecoveryQueueClassification;
}) {
  const target = params.automation.targetLaneClassification ?? "unknown_target";
  if (params.automation.replayEligibility === "safe_to_resume") {
    return `Recommended: resume against ${target} using the remaining retry budget.`;
  }
  if (params.automation.replayEligibility === "safe_to_replay") {
    return "Not recommended: resume is no longer the safe path; only guarded replay remains available.";
  }
  if (params.queueClassification === "retryable") {
    return "Conditionally available: resume may become safe after the recorded retryable target is revalidated.";
  }
  if (params.queueClassification === "manual_required") {
    return `Blocked for resume: ${params.automation.manualReviewReason ?? params.automation.replayBlockReason ?? "manual review is required first."}`;
  }
  if (params.queueClassification === "exhausted") {
    return "Not recommended: the lane exhausted its safe automatic retries.";
  }
  if (params.queueClassification === "blocked") {
    return `Blocked: ${params.automation.replayBlockReason ?? "the current target/correlation no longer matches the recorded lane."}`;
  }
  return null;
}

function buildOperatorActionRecommendation(params: {
  stateId: string;
  automation: GptCodeAutomationState;
  queueClassification: GptCodeRecoveryQueueClassification;
}) {
  if (params.automation.replayEligibility === "safe_to_resume") {
    return `Run external:replay --state-id ${params.stateId} --action resume, then verify the updated dispatch summary.`;
  }
  if (params.automation.replayEligibility === "safe_to_replay") {
    return `Run external:replay --state-id ${params.stateId} --action replay, then verify the routed target and updated recovery history.`;
  }
  if (params.queueClassification === "retryable") {
    return `Inspect the target health and run external:replay --state-id ${params.stateId} --action inspect before any retry.`;
  }
  if (params.queueClassification === "manual_required") {
    return `Manual review only: resolve the blocking reason, then re-check with external:replay --state-id ${params.stateId} --action inspect.`;
  }
  if (params.queueClassification === "exhausted") {
    return "Do not replay yet; review the full dispatch and fallback history before any guarded manual action.";
  }
  if (params.queueClassification === "blocked") {
    return "Resolve the correlation/target mismatch before attempting replay or resume.";
  }
  return params.automation.recommendedNextStep ?? "Wait for the next external automation event.";
}

function buildRecoveryAuditSummary(params: {
  queueClassification: GptCodeRecoveryQueueClassification;
  automation: GptCodeAutomationState;
  repeatedFailurePattern: string | null;
  operatorActionRecommendation: string;
}) {
  const parts = [
    `queue=${params.queueClassification}`,
    `replay=${params.automation.replayEligibility}/${params.automation.lastReplayAction}/${params.automation.lastReplayOutcome}#${params.automation.replayAttemptCount}`,
    `dispatch=${params.automation.dispatchReliabilityOutcome}`,
    `attempts=${params.automation.targetAttemptCount}/${params.automation.targetMaxAttempts}`,
  ];
  if (params.repeatedFailurePattern) {
    parts.push(`pattern=${params.repeatedFailurePattern}`);
  }
  parts.push(`next=${params.operatorActionRecommendation}`);
  return parts.join(" | ");
}

function deriveRecoveryErgonomics(params: {
  stateId: string;
  automation: GptCodeAutomationState;
}) {
  const queueClassification = classifyRecoveryQueueClassification(params.automation);
  const replayRecommendation = buildReplayRecommendationSummary({
    automation: params.automation,
    queueClassification,
  });
  const resumeRecommendation = buildResumeRecommendationSummary({
    automation: params.automation,
    queueClassification,
  });
  const repeatedFailurePattern = detectRepeatedFailurePattern(params.automation);
  const recentRecoveryHistory = summarizeRecentRecoveryHistory(params.automation);
  const operatorActionRecommendation = buildOperatorActionRecommendation({
    stateId: params.stateId,
    automation: params.automation,
    queueClassification,
  });
  const recoveryAuditSummary = buildRecoveryAuditSummary({
    queueClassification,
    automation: params.automation,
    repeatedFailurePattern,
    operatorActionRecommendation,
  });

  return {
    recoveryQueueClassification: queueClassification,
    replayRecommendation,
    resumeRecommendation,
    operatorActionRecommendation,
    recentRecoveryHistory,
    repeatedFailurePattern,
    recoveryAuditSummary,
  } satisfies Partial<GptCodeAutomationState>;
}

function buildAutomationPatchFromDispatch(params: {
  currentState: OrchestratorState;
  dispatch: GptCodeExternalTargetDispatch;
  recoveryAction?: GptCodeRecoveryResolvedAction;
  replayAttemptCount?: number;
  replayEligibility?: GptCodeReplayEligibility;
  replayBlockReason?: string | null;
  operatorRecoveryRecommendation?: string | null;
}) {
  const currentAutomation = params.currentState.lastGptCodeAutomationState;
  const { exhausted, canRetry, normalizedOutcome } = classifyDispatchRecoverability({
    outcome: params.dispatch.outcome,
    attemptCount: params.dispatch.attemptCount,
    maxAttempts: params.dispatch.maxAttempts,
    retryEligible: params.dispatch.retryEligible,
  });
  const normalizedDispatch = gptCodeExternalTargetDispatchSchema.parse({
    ...params.dispatch,
    outcome: normalizedOutcome,
    retryEligible: canRetry,
    exhausted,
    manualReviewReason:
      params.dispatch.manualReviewReason ??
      deriveManualReviewReason({
        dispatch: params.dispatch,
        exhausted,
      }),
    recommendedNextStep:
      params.dispatch.recommendedNextStep ??
      deriveRecommendedNextStep({
        dispatch: params.dispatch,
        exhausted,
        canRetry,
      }),
    deliverySummary:
      params.dispatch.deliverySummary ??
      buildDispatchSummary({
        dispatch: params.dispatch,
        exhausted,
      }),
  });
  const dispatchAttemptHistory = upsertDispatchAttemptHistory({
    current: currentAutomation?.dispatchAttemptHistory ?? [],
    dispatch: normalizedDispatch,
    recoveryAction: params.recoveryAction,
    replayAttemptCount: params.replayAttemptCount,
  });
  const recoveryHistorySummary =
    params.recoveryAction && params.recoveryAction !== "none" && typeof params.replayAttemptCount === "number"
      ? summarizeRecoveryHistory({
          currentSummary: currentAutomation?.recoveryHistorySummary ?? null,
          recoveryAction: params.recoveryAction,
          replayAttemptCount: params.replayAttemptCount,
          outcome: normalizedDispatch.outcome,
          dispatchedAt: normalizedDispatch.dispatchedAt,
        })
      : (currentAutomation?.recoveryHistorySummary ?? null);

  return {
    normalizedDispatch,
    patch: {
      dispatchOutcome: normalizedDispatch.outcome,
      targetAdapterStatus: mapTargetOutcomeToStatus(normalizedDispatch.outcome),
      targetType: normalizedDispatch.targetType,
      targetLaneClassification: normalizedDispatch.targetLaneClassification,
      targetDestination: normalizedDispatch.targetDestination,
      targetAttemptCount: normalizedDispatch.attemptCount,
      targetRetryCount: normalizedDispatch.retryCount,
      targetMaxAttempts: normalizedDispatch.maxAttempts,
      routingDecision: normalizedDispatch.routingDecision,
      fallbackDecision: normalizedDispatch.fallbackDecision,
      dispatchCorrelationId: normalizedDispatch.correlationId,
      targetExternalReferenceId: normalizedDispatch.externalReferenceId,
      targetExternalUrl: normalizedDispatch.externalUrl,
      targetDispatchArtifactPath: normalizedDispatch.dispatchArtifactPath,
      lastTargetFailureClass: normalizedDispatch.failureClass,
      dispatchAttemptHistory,
      retryPolicySummary: summarizeRetryPolicy({
        maxAttempts: normalizedDispatch.maxAttempts,
        currentAttemptCount: normalizedDispatch.attemptCount,
        retryCount: normalizedDispatch.retryCount,
        canRetry,
        exhausted,
      }),
      dispatchHistorySummary: summarizeDispatchHistory(dispatchAttemptHistory),
      fallbackChainSummary: buildFallbackSummary(normalizedDispatch.routeTrace),
      recoverabilitySummary: summarizeRecoverability({
        canRetry,
        exhausted,
        dispatch: normalizedDispatch,
      }),
      operatorHandoffSummary: summarizeOperatorHandoff({
        dispatch: normalizedDispatch,
        canRetry,
        exhausted,
      }),
      replayEligibility:
        normalizedDispatch.outcome === "success"
          ? "not_evaluated"
          : (params.replayEligibility ?? currentAutomation?.replayEligibility ?? "not_evaluated"),
      replayBlockReason: normalizedDispatch.outcome === "success" ? null : (params.replayBlockReason ?? null),
      replayAttemptCount: params.replayAttemptCount ?? currentAutomation?.replayAttemptCount ?? 0,
      lastReplayAction: params.recoveryAction ?? currentAutomation?.lastReplayAction ?? "none",
      lastReplayOutcome:
        params.recoveryAction && params.recoveryAction !== "none"
          ? normalizedDispatch.outcome
          : (currentAutomation?.lastReplayOutcome ?? "not_run"),
      recoveryHistorySummary,
      operatorRecoveryRecommendation:
        params.operatorRecoveryRecommendation ??
        normalizedDispatch.recommendedNextStep ??
        currentAutomation?.operatorRecoveryRecommendation ??
        null,
      canRetryDispatch: canRetry,
      dispatchExhausted: exhausted,
      dispatchReliabilityOutcome: normalizedDispatch.outcome,
      externalAutomationOutcome: normalizedDispatch.outcome,
      lastAttemptedAt: normalizedDispatch.dispatchedAt,
      lastDispatchedAt: normalizedDispatch.dispatchedAt,
      recommendedNextStep: normalizedDispatch.recommendedNextStep,
      manualReviewReason: normalizedDispatch.manualReviewReason,
    } satisfies Partial<GptCodeAutomationState>,
  };
}

function isReplaySafeFailureClass(failureClass: GptCodeAutomationState["lastTargetFailureClass"]) {
  return failureClass === "network" || failureClass === "transient" || failureClass === "rate_limited" || failureClass === "target_invalid";
}

function rebuildExternalSourceFromState(state: OrchestratorState) {
  const automation = state.lastGptCodeAutomationState;
  const summary = state.sourceEventSummary;
  if (!automation?.sourceType || !automation.sourceLaneClassification || !summary?.repository) {
    return null;
  }

  return gptCodeExternalSourceMetadataSchema.parse({
    sourceType: automation.sourceType,
    sourceLaneClassification: automation.sourceLaneClassification,
    sourceId: automation.sourceId ?? `${automation.sourceType}:${state.id}`,
    sourceCorrelationId: automation.sourceCorrelationId ?? `recovery:${state.id}`,
    repository: summary.repository,
    issueNumber: summary.issueNumber,
    prNumber: summary.prNumber,
    commentId: summary.commentId,
    payloadPath: automation.sourcePayloadPath,
    headersPath: automation.sourceHeadersPath,
    receivedAt: automation.sourceReceivedAt ?? automation.lastReceivedAt ?? state.updatedAt,
  });
}

function buildRecoveryRecommendation(params: ReplayEligibilityDecision) {
  if (params.replayEligibility === "safe_to_resume") {
    return "External lane can safely resume using the current GitHub target path and remaining retry budget.";
  }
  if (params.replayEligibility === "safe_to_replay") {
    return "External lane can be replayed once under operator control; reuse the existing next instruction and re-check the routed target.";
  }
  if (params.replayEligibility === "exhausted_permanently") {
    return "External lane is exhausted for automatic recovery; inspect auth/routing/target health before any manual re-dispatch.";
  }
  if (params.replayEligibility === "manual_only") {
    return "External lane still needs manual review before any replay because the dispatch prerequisites are incomplete.";
  }
  return params.replayBlockReason ?? "External lane replay is currently blocked.";
}

function evaluateReplayEligibility(params: {
  state: OrchestratorState;
  requestedAction: GptCodeRecoveryRequestedAction;
}) {
  const automation = params.state.lastGptCodeAutomationState;
  if (!automation) {
    const decision: ReplayEligibilityDecision = {
      replayEligibility: "blocked",
      replayBlockReason: "No external automation state exists yet for this orchestrator state.",
      requestedAction: params.requestedAction,
      resolvedAction: "none",
      source: null,
      route: null,
      targetAvailable: false,
      correlationConsistent: false,
      externalReferenceConsistent: false,
      recommendedAction: "Wait for a GitHub external lane run before attempting replay or resume.",
    };
    return decision;
  }

  const source = rebuildExternalSourceFromState(params.state);
  const correlationId = buildInstructionCorrelationId(params.state.id);
  const correlationConsistent = !automation.dispatchCorrelationId || automation.dispatchCorrelationId === correlationId;
  const route = source ? resolveExternalGitHubTargetRoute({ state: params.state, source }) : null;
  const targetAvailable = route !== null;
  const externalReferenceConsistent =
    !automation.targetExternalReferenceId ||
    !route?.targetCommentId ||
    automation.targetExternalReferenceId === route.targetCommentId;
  const dispatchPrerequisitesReady =
    automation.intakeStatus === "accepted" &&
    automation.bridgeStatus === "accepted" &&
    automation.dispatchStatus === "dispatched" &&
    Boolean(automation.nextInstructionPath) &&
    Boolean(automation.outputPayloadPath);
  const safeRetryAvailable =
    automation.canRetryDispatch &&
    automation.dispatchOutcome === "retryable" &&
    automation.targetAdapterStatus === "retryable";
  const recoveryCapable =
    automation.targetAttemptCount > 0 &&
    isReplaySafeFailureClass(automation.lastTargetFailureClass) &&
    dispatchPrerequisitesReady;

  let replayEligibility: GptCodeReplayEligibility = "blocked";
  let replayBlockReason: string | null = null;
  let resolvedAction: GptCodeRecoveryResolvedAction = "none";

  if (!dispatchPrerequisitesReady || !source) {
    replayEligibility = "manual_only";
    replayBlockReason =
      "Transport/bridge artifacts are incomplete for replay; operator review must resolve the upstream block first.";
  } else if (!correlationConsistent) {
    replayEligibility = "blocked";
    replayBlockReason = "Dispatch correlation no longer matches the current state; replay was refused.";
  } else if (!targetAvailable) {
    replayEligibility = "blocked";
    replayBlockReason = "No valid GitHub target route is currently available for this lane.";
  } else if (params.requestedAction === "resume") {
    if (!safeRetryAvailable) {
      replayEligibility = automation.dispatchExhausted ? "exhausted_permanently" : "manual_only";
      replayBlockReason = automation.dispatchExhausted
        ? "The lane already exhausted its safe automatic retries; resume is no longer allowed."
        : "Resume is only allowed while a safe retry remains available.";
    } else if (!externalReferenceConsistent) {
      replayEligibility = "blocked";
      replayBlockReason = "The current GitHub target no longer matches the recorded external reference; replay is required instead of resume.";
    } else {
      replayEligibility = "safe_to_resume";
      resolvedAction = "resume";
    }
  } else if (params.requestedAction === "replay") {
    if (!recoveryCapable) {
      replayEligibility = automation.dispatchExhausted ? "exhausted_permanently" : "manual_only";
      replayBlockReason = automation.dispatchExhausted
        ? "This lane exhausted safe retries and does not meet the guarded replay conditions."
        : "Replay is only allowed after a dispatch attempt with recoverable target failure classes.";
    } else {
      replayEligibility = "safe_to_replay";
      resolvedAction = "replay";
    }
  } else if (safeRetryAvailable && externalReferenceConsistent) {
    replayEligibility = "safe_to_resume";
    resolvedAction = "resume";
  } else if (recoveryCapable) {
    replayEligibility = "safe_to_replay";
    resolvedAction = "replay";
  } else if (automation.dispatchExhausted || automation.dispatchOutcome === "exhausted") {
    replayEligibility = "exhausted_permanently";
    replayBlockReason = "The lane exhausted its safe retries and no guarded replay condition is currently satisfied.";
  } else {
    replayEligibility = "manual_only";
    replayBlockReason = automation.manualReviewReason ?? "Operator review is required before replay can proceed safely.";
  }

  const decision: ReplayEligibilityDecision = {
    replayEligibility,
    replayBlockReason,
    requestedAction: params.requestedAction,
    resolvedAction,
    source,
    route,
    targetAvailable,
    correlationConsistent,
    externalReferenceConsistent,
    recommendedAction: "",
  };
  decision.recommendedAction = buildRecoveryRecommendation(decision);
  return decision;
}

export function evaluateGptCodeExternalAutomationReplayEligibility(params: {
  state: OrchestratorState;
  requestedAction?: GptCodeRecoveryRequestedAction;
}) {
  return evaluateReplayEligibility({
    state: params.state,
    requestedAction: params.requestedAction ?? "auto",
  });
}

function buildRecoveryEvaluationPatch(params: {
  currentState: OrchestratorState;
  decision: ReplayEligibilityDecision;
  lastReplayOutcome?: GptCodeReplayOutcome;
}) {
  return {
    replayEligibility: params.decision.replayEligibility,
    replayBlockReason: params.decision.replayBlockReason,
    lastReplayOutcome: params.lastReplayOutcome ?? params.currentState.lastGptCodeAutomationState?.lastReplayOutcome ?? "not_run",
    operatorRecoveryRecommendation: params.decision.recommendedAction,
    recommendedNextStep: params.decision.recommendedAction,
  } satisfies Partial<GptCodeAutomationState>;
}

function summarizeRecoveryDecisionHistory(params: {
  currentSummary: string | null | undefined;
  requestedAction: GptCodeRecoveryRequestedAction;
  replayEligibility: GptCodeReplayEligibility;
  outcome: GptCodeReplayOutcome;
  at: string;
}) {
  const latest = `decision ${params.requestedAction} -> ${params.replayEligibility} (${params.outcome}) at ${params.at}`;
  if (!params.currentSummary) {
    return latest;
  }
  return `${params.currentSummary} | ${latest}`;
}

function sourcePrefersStatusReportTarget(source: GptCodeExternalSourceMetadata) {
  return source.sourceType === "github_issue_body" || source.sourceType === "github_pull_request_body";
}

function sourcePrefersLiveSmokeTarget(source: GptCodeExternalSourceMetadata) {
  return source.sourceType === "github_pull_request_body";
}

function resolveLiveSmokeTargetRoute(params: {
  state: OrchestratorState;
  source: GptCodeExternalSourceMetadata;
}): ExternalGitHubTargetRoute | null {
  const target = params.state.lastLiveSmokeTarget;
  if (!target?.repository || !target.commentId || !target.targetNumber || !target.targetType) {
    return null;
  }
  if (target.repository !== params.source.repository) {
    return null;
  }
  if (params.source.prNumber != null) {
    if (target.targetType !== "pull_request" || target.targetNumber !== params.source.prNumber) {
      return null;
    }
  } else if (params.source.issueNumber != null) {
    if (target.targetType !== "issue" || target.targetNumber !== params.source.issueNumber) {
      return null;
    }
  }

  return {
    repository: target.repository,
    targetNumber: target.targetNumber,
    targetDestination: `github://${target.repository}/issues/comments/${target.commentId}`,
    targetCommentId: String(target.commentId),
    targetLaneClassification: "github_live_smoke_comment_lane",
    routingDecision: "live_smoke_target",
    fallbackDecision: "not_needed",
    isPullRequest: target.targetType === "pull_request",
  };
}

function resolveStatusReportTargetRoute(params: {
  state: OrchestratorState;
}): ExternalGitHubTargetRoute | null {
  const target = params.state.lastStatusReportTarget;
  if (!target || target.kind === "artifact_only" || !target.commentId || !target.repository || !target.targetNumber) {
    return null;
  }

  return {
    repository: target.repository,
    targetNumber: target.targetNumber,
    targetDestination: `github://${target.repository}/issues/comments/${target.commentId}`,
    targetCommentId: String(target.commentId),
    targetLaneClassification: "github_status_report_comment_lane",
    routingDecision: "status_report_target",
    fallbackDecision: "not_needed",
    isPullRequest: target.kind === "pull_request_comment",
  };
}

function resolvePrimaryThreadOrSourceFallbackRoute(params: {
  state: OrchestratorState;
  source: GptCodeExternalSourceMetadata;
}): ExternalGitHubTargetRoute | null {
  const threadTarget = resolveGitHubThreadTarget(params.state);
  if (threadTarget) {
    return {
      repository: threadTarget.repository,
      targetNumber: threadTarget.targetNumber,
      targetDestination: `github://${threadTarget.repository}/issues/${threadTarget.targetNumber}/comments`,
      targetCommentId: null,
      targetLaneClassification: threadTarget.isPullRequest
        ? "github_pull_request_thread_comment_lane"
        : "github_issue_thread_comment_lane",
      routingDecision: "state_thread_target",
      fallbackDecision: "not_needed",
      isPullRequest: threadTarget.isPullRequest,
    };
  }

  const fallbackNumber = params.source.prNumber ?? params.source.issueNumber;
  if (!fallbackNumber) {
    return null;
  }

  return {
    repository: params.source.repository,
    targetNumber: fallbackNumber,
    targetDestination: `github://${params.source.repository}/issues/${fallbackNumber}/comments`,
    targetCommentId: null,
    targetLaneClassification: "github_source_thread_fallback_lane",
    routingDecision: "source_thread_fallback",
    fallbackDecision: "source_thread_fallback",
    isPullRequest: params.source.prNumber != null,
  };
}

function resolveExternalGitHubTargetRoute(params: {
  state: OrchestratorState;
  source: GptCodeExternalSourceMetadata;
}): ExternalGitHubTargetRoute | null {
  if (sourcePrefersLiveSmokeTarget(params.source)) {
    const liveSmokeRoute = resolveLiveSmokeTargetRoute(params);
    if (liveSmokeRoute) {
      return liveSmokeRoute;
    }
  }

  if (sourcePrefersStatusReportTarget(params.source)) {
    const statusRoute = resolveStatusReportTargetRoute({
      state: params.state,
    });
    if (statusRoute) {
      return statusRoute;
    }
  }

  return resolvePrimaryThreadOrSourceFallbackRoute(params);
}

function resolveFallbackRouteAfterInvalidTarget(params: {
  state: OrchestratorState;
  source: GptCodeExternalSourceMetadata;
  failedRoute: ExternalGitHubTargetRoute;
}) {
  if (params.failedRoute.routingDecision === "live_smoke_target") {
    const statusRoute = sourcePrefersStatusReportTarget(params.source)
      ? resolveStatusReportTargetRoute({
          state: params.state,
        })
      : null;
    if (statusRoute && statusRoute.targetDestination !== params.failedRoute.targetDestination) {
      return {
        ...statusRoute,
        fallbackDecision: "live_smoke_target_fallback" as const,
      };
    }

    const threadRoute = resolvePrimaryThreadOrSourceFallbackRoute({
      state: params.state,
      source: params.source,
    });
    if (threadRoute) {
      return {
        ...threadRoute,
        fallbackDecision: "live_smoke_target_fallback" as const,
      };
    }
    return null;
  }

  if (params.failedRoute.routingDecision === "status_report_target") {
    const threadRoute = resolvePrimaryThreadOrSourceFallbackRoute({
      state: params.state,
      source: params.source,
    });
    if (threadRoute) {
      return {
        ...threadRoute,
        fallbackDecision: "status_report_target_fallback" as const,
      };
    }
  }

  return null;
}

function extractReportTextFromSourcePayload(payload: unknown, source: GptCodeExternalSourceMetadata) {
  if (source.sourceType === "github_issue_comment" || source.sourceType === "github_pull_request_review_comment") {
    const commentPayload = payload as IssueCommentPayload | PullRequestReviewCommentPayload;
    return (commentPayload.comment?.body ?? "").trim();
  }
  if (source.sourceType === "github_issue_body") {
    const issuePayload = payload as IssueCommentPayload;
    return (issuePayload.issue?.body ?? "").trim();
  }
  const pullRequestPayload = payload as PullRequestReviewCommentPayload;
  return (pullRequestPayload.pull_request?.body ?? "").trim();
}

async function persistTargetDispatchArtifact(params: {
  state: OrchestratorState;
  dependencies: OrchestratorDependencies;
  targetDispatch: GptCodeExternalTargetDispatch;
}) {
  if (!params.targetDispatch.dispatchArtifactPath) {
    return params.state;
  }

  const updated = appendArtifacts(params.state, [
    {
      kind: "gpt_code_external_target_dispatch",
      label: "GPT CODE external target dispatch result",
      path: params.targetDispatch.dispatchArtifactPath,
      value: null,
    },
  ]);
  await params.dependencies.storage.saveState(updated);
  return updated;
}

async function writeExternalRecoveryResult(params: {
  outputRoot: string;
  result: Omit<GptCodeExternalRecoveryResult, "recoveryArtifactPath">;
}) {
  await mkdir(params.outputRoot, { recursive: true });
  const recoveryArtifactPath = path.join(params.outputRoot, "recovery-result.json");
  const result = gptCodeExternalRecoveryResultSchema.parse({
    ...params.result,
    recoveryArtifactPath,
  });
  await writeFile(recoveryArtifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

async function persistRecoveryArtifact(params: {
  state: OrchestratorState;
  dependencies: OrchestratorDependencies;
  recoveryArtifactPath: string | null;
}) {
  if (!params.recoveryArtifactPath) {
    return params.state;
  }
  const updated = appendArtifacts(params.state, [
    {
      kind: "gpt_code_external_recovery",
      label: "GPT CODE external recovery result",
      path: params.recoveryArtifactPath,
      value: null,
    },
  ]);
  await params.dependencies.storage.saveState(updated);
  return updated;
}

function buildExternalRecoveryResultPayload(params: {
  state: OrchestratorState;
  requestedAction: GptCodeRecoveryRequestedAction;
  resolvedAction: GptCodeRecoveryResolvedAction;
  outcome: GptCodeReplayOutcome;
  targetDispatch: GptCodeExternalTargetDispatch | null;
  generatedAt: string;
}) {
  const automation = params.state.lastGptCodeAutomationState;
  return {
    stateId: params.state.id,
    requestedAction: params.requestedAction,
    resolvedAction: params.resolvedAction,
    replayEligibility: automation?.replayEligibility ?? "not_evaluated",
    replayBlockReason: automation?.replayBlockReason ?? null,
    recoveryQueueClassification: automation?.recoveryQueueClassification ?? "not_applicable",
    replayRecommendation: automation?.replayRecommendation ?? null,
    resumeRecommendation: automation?.resumeRecommendation ?? null,
    operatorActionRecommendation: automation?.operatorActionRecommendation ?? null,
    recentRecoveryHistory: automation?.recentRecoveryHistory ?? [],
    repeatedFailurePattern: automation?.repeatedFailurePattern ?? null,
    recoveryAuditSummary: automation?.recoveryAuditSummary ?? null,
    targetDispatch: params.targetDispatch,
    outcome: params.outcome,
    generatedAt: params.generatedAt,
  } satisfies Omit<GptCodeExternalRecoveryResult, "recoveryArtifactPath">;
}

export function extractGptCodeReportFromGitHubComment(params: {
  payload: unknown;
  deliveryId: string | null;
  payloadPath: string | null;
  headersPath: string | null;
  receivedAt: string;
}) {
  const issueCommentPayload = params.payload as IssueCommentPayload;
  if (
    issueCommentPayload.action === "created" &&
    issueCommentPayload.issue?.number &&
    issueCommentPayload.comment?.id &&
    issueCommentPayload.repository?.full_name
  ) {
    const body = (issueCommentPayload.comment.body ?? "").trim();
    if (!body || !looksLikeGptCodeChineseReport(body)) {
      return null;
    }

    return gptCodeExternalSourceMetadataSchema.parse({
      sourceType: "github_issue_comment",
      sourceLaneClassification: "github_issue_comment_lane",
      sourceId: `github-comment:${issueCommentPayload.comment.id}`,
      sourceCorrelationId: `inbound:${params.deliveryId ?? issueCommentPayload.comment.id}`,
      repository: issueCommentPayload.repository.full_name,
      issueNumber: issueCommentPayload.issue.pull_request ? null : issueCommentPayload.issue.number,
      prNumber: issueCommentPayload.issue.pull_request ? issueCommentPayload.issue.number : null,
      commentId: issueCommentPayload.comment.id,
      payloadPath: params.payloadPath,
      headersPath: params.headersPath,
      receivedAt: params.receivedAt,
    });
  }

  if (
    (issueCommentPayload.action === "opened" || issueCommentPayload.action === "edited") &&
    issueCommentPayload.issue?.number &&
    issueCommentPayload.issue?.id &&
    issueCommentPayload.repository?.full_name
  ) {
    const body = (issueCommentPayload.issue.body ?? "").trim();
    if (!body || !looksLikeGptCodeChineseReport(body)) {
      return null;
    }

    return gptCodeExternalSourceMetadataSchema.parse({
      sourceType: issueCommentPayload.issue.pull_request ? "github_pull_request_body" : "github_issue_body",
      sourceLaneClassification: issueCommentPayload.issue.pull_request
        ? "github_pull_request_body_lane"
        : "github_issue_body_lane",
      sourceId: `github-${issueCommentPayload.issue.pull_request ? "pull-request" : "issue"}-body:${issueCommentPayload.issue.id}:${issueCommentPayload.action}:${issueCommentPayload.issue.updated_at ?? "unknown"}`,
      sourceCorrelationId: `inbound:${params.deliveryId ?? issueCommentPayload.issue.id}`,
      repository: issueCommentPayload.repository.full_name,
      issueNumber: issueCommentPayload.issue.pull_request ? null : issueCommentPayload.issue.number,
      prNumber: issueCommentPayload.issue.pull_request ? issueCommentPayload.issue.number : null,
      commentId: null,
      payloadPath: params.payloadPath,
      headersPath: params.headersPath,
      receivedAt: params.receivedAt,
    });
  }

  const reviewCommentPayload = params.payload as PullRequestReviewCommentPayload;
  if (
    reviewCommentPayload.action === "created" &&
    reviewCommentPayload.pull_request?.number &&
    reviewCommentPayload.comment?.id &&
    reviewCommentPayload.repository?.full_name
  ) {
    const body = (reviewCommentPayload.comment.body ?? "").trim();
    if (!body || !looksLikeGptCodeChineseReport(body)) {
      return null;
    }

    return gptCodeExternalSourceMetadataSchema.parse({
      sourceType: "github_pull_request_review_comment",
      sourceLaneClassification: "github_pull_request_review_comment_lane",
      sourceId: `github-pr-review-comment:${reviewCommentPayload.comment.id}`,
      sourceCorrelationId: `inbound:${params.deliveryId ?? reviewCommentPayload.comment.id}`,
      repository: reviewCommentPayload.repository.full_name,
      issueNumber: null,
      prNumber: reviewCommentPayload.pull_request.number,
      commentId: reviewCommentPayload.comment.id,
      payloadPath: params.payloadPath,
      headersPath: params.headersPath,
      receivedAt: params.receivedAt,
    });
  }

  if (
    (reviewCommentPayload.action === "opened" || reviewCommentPayload.action === "edited") &&
    reviewCommentPayload.pull_request?.number &&
    reviewCommentPayload.pull_request?.id &&
    reviewCommentPayload.repository?.full_name
  ) {
    const body = (reviewCommentPayload.pull_request.body ?? "").trim();
    if (!body || !looksLikeGptCodeChineseReport(body)) {
      return null;
    }

    return gptCodeExternalSourceMetadataSchema.parse({
      sourceType: "github_pull_request_body",
      sourceLaneClassification: "github_pull_request_body_lane",
      sourceId: `github-pull-request-body:${reviewCommentPayload.pull_request.id}:${reviewCommentPayload.action}:${reviewCommentPayload.pull_request.updated_at ?? "unknown"}`,
      sourceCorrelationId: `inbound:${params.deliveryId ?? reviewCommentPayload.pull_request.id}`,
      repository: reviewCommentPayload.repository.full_name,
      issueNumber: null,
      prNumber: reviewCommentPayload.pull_request.number ?? reviewCommentPayload.number ?? null,
      commentId: null,
      payloadPath: params.payloadPath,
      headersPath: params.headersPath,
      receivedAt: params.receivedAt,
    });
  }

  return null;
}

export interface GptCodeExternalTargetAdapter {
  readonly kind: string;
  readonly maxAttempts?: number;
  dispatchNextInstruction(params: {
    state: OrchestratorState;
    source: GptCodeExternalSourceMetadata;
    nextInstructionPath: string;
    outputPayloadPath: string;
    outputRoot: string;
  }): Promise<GptCodeExternalTargetDispatch>;
}

async function writeTargetDispatchResult(params: {
  outputRoot: string;
  attemptCount: number;
  result: Omit<
    GptCodeExternalTargetDispatch,
    "dispatchArtifactPath" | "routeTrace" | "deliverySummary" | "manualReviewReason" | "recommendedNextStep" | "exhausted"
  > &
    Partial<
      Pick<
        GptCodeExternalTargetDispatch,
        "routeTrace" | "deliverySummary" | "manualReviewReason" | "recommendedNextStep" | "exhausted"
      >
    >;
}) {
  await mkdir(params.outputRoot, { recursive: true });
  const dispatchArtifactPath = path.join(params.outputRoot, `github-target-dispatch-attempt-${params.attemptCount}.json`);
  const { exhausted, canRetry, normalizedOutcome } = classifyDispatchRecoverability({
    outcome: params.result.outcome,
    attemptCount: params.result.attemptCount,
    maxAttempts: params.result.maxAttempts,
    retryEligible: params.result.retryEligible,
  });
  const result = gptCodeExternalTargetDispatchSchema.parse({
    ...params.result,
    outcome: normalizedOutcome,
    retryEligible: canRetry,
    exhausted,
    routeTrace: params.result.routeTrace ?? [],
    manualReviewReason:
      params.result.manualReviewReason ??
      deriveManualReviewReason({
        dispatch: {
          ...params.result,
          dispatchArtifactPath: null,
          outcome: normalizedOutcome,
          retryEligible: canRetry,
          exhausted,
          routeTrace: params.result.routeTrace ?? [],
          deliverySummary: params.result.deliverySummary ?? null,
          recommendedNextStep: params.result.recommendedNextStep ?? null,
          manualReviewReason: null,
        },
        exhausted,
      }),
    recommendedNextStep:
      params.result.recommendedNextStep ??
      deriveRecommendedNextStep({
        dispatch: {
          ...params.result,
          dispatchArtifactPath: null,
          outcome: normalizedOutcome,
          retryEligible: canRetry,
          exhausted,
          routeTrace: params.result.routeTrace ?? [],
          deliverySummary: params.result.deliverySummary ?? null,
          recommendedNextStep: null,
          manualReviewReason: params.result.manualReviewReason ?? null,
        },
        exhausted,
        canRetry,
      }),
    deliverySummary:
      params.result.deliverySummary ??
      buildDispatchSummary({
        dispatch: {
          ...params.result,
          dispatchArtifactPath: null,
          outcome: normalizedOutcome,
          retryEligible: canRetry,
          exhausted,
          routeTrace: params.result.routeTrace ?? [],
          deliverySummary: null,
          recommendedNextStep: params.result.recommendedNextStep ?? null,
          manualReviewReason: params.result.manualReviewReason ?? null,
        },
        exhausted,
      }),
    dispatchArtifactPath,
  });
  await writeFile(dispatchArtifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

async function dispatchInstructionToGitHubRoute(params: {
  route: ExternalGitHubTargetRoute;
  state: OrchestratorState;
  nextInstructionPath: string;
  outputRoot: string;
  attemptCount: number;
  retryCount: number;
  maxAttempts: number;
  targetType: GptCodeExternalTargetDispatch["targetType"];
  enabled: boolean;
  token: string | null;
  execImpl: ExecFileLike;
  now: string;
  routeTrace?: string[];
}) {
  const correlationId = buildInstructionCorrelationId(params.state.id);
  const body = withInstructionMarker(await readFile(params.nextInstructionPath, "utf8"), params.state.id);
  const bodyPayloadPath = path.join(params.outputRoot, `github-target-body-attempt-${params.attemptCount}.json`);
  await writeFile(bodyPayloadPath, `${JSON.stringify({ body }, null, 2)}\n`, "utf8");
  const routeTrace = [
    ...(params.routeTrace ?? []),
    buildRouteTraceEntry({
      route: params.route,
      outcome: "manual_required",
      failureClass: "auth",
    }),
  ];

  if (!params.enabled || !params.token) {
    return writeTargetDispatchResult({
      outputRoot: params.outputRoot,
      attemptCount: params.attemptCount,
      result: {
        stateId: params.state.id,
        targetType: params.targetType,
        targetLaneClassification: params.route.targetLaneClassification,
        targetDestination: params.route.targetDestination,
        routingDecision: params.route.routingDecision,
        fallbackDecision: params.route.fallbackDecision,
        attemptCount: params.attemptCount,
        retryCount: params.retryCount,
        maxAttempts: params.maxAttempts,
        outcome: "manual_required",
        retryEligible: false,
        failureClass: "auth",
        correlationId,
        externalReferenceId: null,
        externalUrl: null,
        routeTrace,
        dispatchedAt: params.now,
      },
    });
  }

  let existingCommentId =
    params.route.targetCommentId ??
    (params.route.targetLaneClassification === "github_status_report_comment_lane"
      ? params.state.lastStatusReportTarget?.commentId?.toString() ?? null
      : params.state.lastGptCodeAutomationState?.targetExternalReferenceId ?? null);
  let existingUrl =
    params.route.targetLaneClassification === "github_status_report_comment_lane"
      ? params.state.lastStatusReportTarget?.targetUrl ?? null
      : params.state.lastGptCodeAutomationState?.targetExternalUrl ?? null;

  try {
    if (!existingCommentId && params.route.targetLaneClassification !== "github_status_report_comment_lane") {
      const { stdout: listStdout } = await params.execImpl(
        "gh",
        ["api", `repos/${params.route.repository}/issues/${params.route.targetNumber}/comments`],
        { windowsHide: true },
      );
      const comments = JSON.parse(listStdout || "[]") as Array<{ id?: number; body?: string; html_url?: string }>;
      const matched = comments.find((comment) => extractInstructionCorrelationId(comment.body ?? "") === correlationId);
      existingCommentId = matched?.id ? String(matched.id) : null;
      existingUrl = matched?.html_url ?? null;
    }

    let responsePayload: { id?: number; html_url?: string } | null = null;
    if (existingCommentId) {
      const { stdout } = await params.execImpl(
        "gh",
        ["api", `repos/${params.route.repository}/issues/comments/${existingCommentId}`, "--method", "PATCH", "--input", bodyPayloadPath],
        { windowsHide: true },
      );
      responsePayload = stdout.trim() ? (JSON.parse(stdout) as { id?: number; html_url?: string }) : null;
    } else {
      const { stdout } = await params.execImpl(
        "gh",
        ["api", `repos/${params.route.repository}/issues/${params.route.targetNumber}/comments`, "--method", "POST", "--input", bodyPayloadPath],
        { windowsHide: true },
      );
      responsePayload = stdout.trim() ? (JSON.parse(stdout) as { id?: number; html_url?: string }) : null;
    }

    return writeTargetDispatchResult({
      outputRoot: params.outputRoot,
      attemptCount: params.attemptCount,
      result: {
        stateId: params.state.id,
        targetType: params.targetType,
        targetLaneClassification: params.route.targetLaneClassification,
        targetDestination: params.route.targetDestination,
        routingDecision: params.route.routingDecision,
        fallbackDecision: params.route.fallbackDecision,
        attemptCount: params.attemptCount,
        retryCount: params.retryCount,
        maxAttempts: params.maxAttempts,
        outcome: "success",
        retryEligible: false,
        failureClass: null,
        correlationId,
        externalReferenceId: String(responsePayload?.id ?? existingCommentId ?? ""),
        externalUrl: responsePayload?.html_url ?? existingUrl,
        routeTrace: [
          ...(params.routeTrace ?? []),
          buildRouteTraceEntry({
            route: params.route,
            outcome: "success",
            failureClass: null,
          }),
        ],
        dispatchedAt: params.now,
      },
    });
  } catch (error) {
    const classified = classifyGitHubDispatchFailure(error);
    return writeTargetDispatchResult({
      outputRoot: params.outputRoot,
      attemptCount: params.attemptCount,
      result: {
        stateId: params.state.id,
        targetType: params.targetType,
        targetLaneClassification: params.route.targetLaneClassification,
        targetDestination: params.route.targetDestination,
        routingDecision: params.route.routingDecision,
        fallbackDecision: params.route.fallbackDecision,
        attemptCount: params.attemptCount,
        retryCount: params.retryCount,
        maxAttempts: params.maxAttempts,
        outcome: classified.outcome,
        retryEligible: classified.retryEligible,
        failureClass: classified.failureClass,
        correlationId,
        externalReferenceId: existingCommentId,
        externalUrl: existingUrl,
        routeTrace: [
          ...(params.routeTrace ?? []),
          buildRouteTraceEntry({
            route: params.route,
            outcome: classified.outcome,
            failureClass: classified.failureClass,
          }),
        ],
        dispatchedAt: params.now,
      },
    });
  }
}

export class GhCliGptCodeGitHubCommentTargetAdapter implements GptCodeExternalTargetAdapter {
  readonly kind = "github_issue_comment";
  readonly maxAttempts: number;

  constructor(
    private readonly params: {
      enabled: boolean;
      token: string | null;
      execFileImpl?: ExecFileLike;
      maxAttempts?: number;
    },
  ) {
    this.maxAttempts = params.maxAttempts ?? 2;
  }

  async dispatchNextInstruction(params: {
    state: OrchestratorState;
    source: GptCodeExternalSourceMetadata;
    nextInstructionPath: string;
    outputPayloadPath: string;
    outputRoot: string;
  }) {
    const now = new Date().toISOString();
    const route = resolveExternalGitHubTargetRoute({
      state: params.state,
      source: params.source,
    });
    const attemptCount = (params.state.lastGptCodeAutomationState?.targetAttemptCount ?? 0) + 1;
    const retryCount = params.state.lastGptCodeAutomationState?.targetRetryCount ?? 0;
    const correlationId = buildInstructionCorrelationId(params.state.id);
    await mkdir(params.outputRoot, { recursive: true });

    if (!route) {
      return writeTargetDispatchResult({
        outputRoot: params.outputRoot,
        attemptCount,
        result: {
          stateId: params.state.id,
          targetType: this.kind,
          targetLaneClassification: "repo_local_outbox_lane",
          targetDestination: "github://missing-thread-target",
          routingDecision: "manual_required",
        fallbackDecision: "manual_required",
        attemptCount,
        retryCount,
        maxAttempts: this.maxAttempts,
        outcome: "manual_required",
        retryEligible: false,
          failureClass: "routing",
          correlationId,
          externalReferenceId: null,
          externalUrl: null,
          routeTrace: ["manual_required | repo_local_outbox_lane | github://missing-thread-target | manual_required | routing"],
          dispatchedAt: now,
        },
      });
    }
    const execImpl: ExecFileLike = this.params.execFileImpl ?? defaultExecFileLike;
    const primaryDispatch = await dispatchInstructionToGitHubRoute({
      route,
      state: params.state,
      nextInstructionPath: params.nextInstructionPath,
      outputRoot: params.outputRoot,
      attemptCount,
      retryCount,
      maxAttempts: this.maxAttempts,
      targetType: this.kind,
      enabled: this.params.enabled,
      token: this.params.token,
      execImpl,
      now,
    });
    if (
      primaryDispatch.outcome === "failed" &&
      primaryDispatch.failureClass === "target_invalid" &&
      (route.routingDecision === "status_report_target" || route.routingDecision === "live_smoke_target")
    ) {
      const fallbackRoute = resolveFallbackRouteAfterInvalidTarget({
        state: params.state,
        source: params.source,
        failedRoute: route,
      });
      if (fallbackRoute) {
        const fallbackDispatch = await dispatchInstructionToGitHubRoute({
          route: fallbackRoute,
          state: params.state,
          nextInstructionPath: params.nextInstructionPath,
          outputRoot: params.outputRoot,
          attemptCount,
          retryCount,
          maxAttempts: this.maxAttempts,
          targetType: this.kind,
          enabled: this.params.enabled,
          token: this.params.token,
          execImpl,
          now,
          routeTrace: primaryDispatch.routeTrace,
        });
        return writeTargetDispatchResult({
          outputRoot: params.outputRoot,
          attemptCount,
          result: (({ dispatchArtifactPath: _dispatchArtifactPath, ...rest }) => rest)(fallbackDispatch),
        });
      }
    }

    return primaryDispatch;
  }
}

export async function runGptCodeExternalAutomationFromWebhook(params: {
  payload: unknown;
  deliveryId: string | null;
  payloadPath: string | null;
  headersPath: string | null;
  receivedAt: string;
  dependencies: OrchestratorDependencies;
  externalTargetAdapter?: GptCodeExternalTargetAdapter | null;
  bridgeOutputRoot?: string;
  dispatchRoot?: string;
  externalTargetRoot?: string;
  actualGitStatusShort?: string | null;
}) {
  const source = extractGptCodeReportFromGitHubComment({
    payload: params.payload,
    deliveryId: params.deliveryId,
    payloadPath: params.payloadPath,
    headersPath: params.headersPath,
    receivedAt: params.receivedAt,
  });
  if (!source) {
    return null;
  }

  const reportText = extractReportTextFromSourcePayload(params.payload, source);
  const state = await findLatestStateForThread({
    dependencies: params.dependencies,
    repository: source.repository,
    issueNumber: source.issueNumber,
    prNumber: source.prNumber,
  });
  if (!state) {
    return gptCodeExternalAutomationResultSchema.parse({
      stateId: "unlinked",
      source,
      sourceStatus: "manual_required",
      automaticTriggerStatus: "manual_required",
      transportDispatchStatus: "manual_required",
      targetDispatch: null,
      outcome: "manual_required",
      generatedAt: params.receivedAt,
    });
  }

  const sourceRoot = path.join(state.task.repoPath, ".tmp", "orchestrator-external-source", state.id, "latest");
  await mkdir(sourceRoot, { recursive: true });
  const sourceMetadataPath = path.join(sourceRoot, "source-metadata.json");
  await writeFile(sourceMetadataPath, `${JSON.stringify(source, null, 2)}\n`, "utf8");

  const targetMaxAttempts = params.externalTargetAdapter?.maxAttempts ?? 2;
  let updatedState = await saveStateWithAutomationPatch({
    state,
    dependencies: params.dependencies,
    patch: {
      sourceAdapterStatus: "linked",
      sourceType: source.sourceType,
      sourceLaneClassification: source.sourceLaneClassification,
      sourceId: source.sourceId,
      sourceCorrelationId: source.sourceCorrelationId,
      sourcePayloadPath: source.payloadPath,
      sourceHeadersPath: source.headersPath,
      sourceReceivedAt: source.receivedAt,
      transportSource: mapSourceTypeToTransportSource(source),
      automaticTriggerStatus: "triggered",
      targetAdapterStatus: "not_attempted",
      targetType: params.externalTargetAdapter?.kind ?? null,
      targetLaneClassification: null,
      targetDestination: null,
      targetAttemptCount: state.lastGptCodeAutomationState?.targetAttemptCount ?? 0,
      targetRetryCount: state.lastGptCodeAutomationState?.targetRetryCount ?? 0,
      targetMaxAttempts,
      routingDecision: null,
      fallbackDecision: null,
      dispatchCorrelationId: buildInstructionCorrelationId(state.id),
      targetExternalReferenceId: null,
      targetExternalUrl: null,
      targetDispatchArtifactPath: null,
      lastTargetFailureClass: null,
      dispatchAttemptHistory: state.lastGptCodeAutomationState?.dispatchAttemptHistory ?? [],
      retryPolicySummary: null,
      dispatchHistorySummary: state.lastGptCodeAutomationState?.dispatchHistorySummary ?? null,
      fallbackChainSummary: null,
      recoverabilitySummary: null,
      operatorHandoffSummary: null,
      canRetryDispatch: false,
      dispatchExhausted: false,
      dispatchReliabilityOutcome: "not_run",
      externalAutomationOutcome: "not_run",
      lastReceivedAt: source.receivedAt,
      recommendedNextStep: "Run transport and external target dispatch for the received GPT CODE report.",
      manualReviewReason: null,
    },
  });

  await submitGptCodeReportTransportEntry({
    stateId: updatedState.id,
    reportText,
    source: mapSourceTypeToTransportSource(source),
    dependencies: params.dependencies,
  });

  const transportResult = await consumeQueuedGptCodeReportTransport({
    stateId: updatedState.id,
    dependencies: params.dependencies,
    bridgeOutputRoot: params.bridgeOutputRoot,
    dispatchRoot: params.dispatchRoot,
    actualGitStatusShort: params.actualGitStatusShort,
  });

  updatedState = (await params.dependencies.storage.loadState(updatedState.id)) ?? updatedState;
  updatedState = appendArtifacts(updatedState, [
    {
      kind: "gpt_code_external_source",
      label: "GPT CODE external source metadata",
      path: sourceMetadataPath,
      value: null,
    },
  ]);
  await params.dependencies.storage.saveState(updatedState);

  if (
    transportResult.dispatchStatus !== "dispatched" ||
    !updatedState.lastGptCodeAutomationState?.nextInstructionPath ||
    !updatedState.lastGptCodeAutomationState.outputPayloadPath ||
    !params.externalTargetAdapter
  ) {
    const outcome =
      transportResult.dispatchStatus === "failed"
        ? "failed"
        : transportResult.dispatchStatus === "manual_required"
          ? "manual_required"
          : "manual_required";
    const manualReviewReason =
      transportResult.dispatchStatus === "dispatched" && !params.externalTargetAdapter
        ? "External target adapter is not configured."
        : updatedState.lastGptCodeAutomationState?.manualReviewReason;
    const recommendedNextStep =
      updatedState.lastGptCodeAutomationState?.manualReviewReason ??
      "Review the transport outcome manually before external dispatch.";
    updatedState = await saveStateWithAutomationPatch({
      state: updatedState,
      dependencies: params.dependencies,
      patch: {
        targetAdapterStatus: "manual_required",
        targetType: params.externalTargetAdapter?.kind ?? null,
        targetMaxAttempts,
        routingDecision: "manual_required",
        fallbackDecision: "manual_required",
        retryPolicySummary: `Retry policy not entered because external dispatch never started; max configured attempts: ${targetMaxAttempts}.`,
        fallbackChainSummary: "No external fallback chain ran because external dispatch never started.",
        recoverabilitySummary: "External lane is blocked before dispatch; operator review is required.",
        operatorHandoffSummary: [
          manualReviewReason ?? "External dispatch did not start.",
          "Tried 0 targets.",
          "Fallback chain not entered.",
          "Safe retry remaining: false.",
          `Next: ${recommendedNextStep}`,
        ].join(" "),
        canRetryDispatch: false,
        dispatchExhausted: false,
        dispatchReliabilityOutcome: outcome,
        externalAutomationOutcome: outcome,
        manualReviewReason,
        recommendedNextStep,
      },
    });

    return gptCodeExternalAutomationResultSchema.parse({
      stateId: updatedState.id,
      source,
      sourceStatus: "linked",
      automaticTriggerStatus: "triggered",
      transportDispatchStatus: transportResult.dispatchStatus,
      targetDispatch: null,
      outcome,
      generatedAt: params.receivedAt,
    });
  }

  const targetRoot =
    params.externalTargetRoot ??
    path.join(updatedState.task.repoPath, ".tmp", "orchestrator-external-target", updatedState.id, "latest");

  let targetDispatch = await params.externalTargetAdapter.dispatchNextInstruction({
    state: updatedState,
    source,
    nextInstructionPath: updatedState.lastGptCodeAutomationState.nextInstructionPath,
    outputPayloadPath: updatedState.lastGptCodeAutomationState.outputPayloadPath,
    outputRoot: targetRoot,
  });
  updatedState = await persistTargetDispatchArtifact({
    state: updatedState,
    dependencies: params.dependencies,
    targetDispatch,
  });

  while (targetDispatch.outcome === "retryable" && targetDispatch.attemptCount < targetDispatch.maxAttempts) {
    const retryPatch = buildAutomationPatchFromDispatch({
      currentState: updatedState,
      dispatch: targetDispatch,
    });
    updatedState = await saveStateWithAutomationPatch({
      state: updatedState,
      dependencies: params.dependencies,
      patch: retryPatch.patch,
    });

    targetDispatch = await params.externalTargetAdapter.dispatchNextInstruction({
      state: updatedState,
      source,
      nextInstructionPath: updatedState.lastGptCodeAutomationState?.nextInstructionPath ?? "",
      outputPayloadPath: updatedState.lastGptCodeAutomationState?.outputPayloadPath ?? "",
      outputRoot: targetRoot,
    });
    updatedState = await persistTargetDispatchArtifact({
      state: updatedState,
      dependencies: params.dependencies,
      targetDispatch,
    });
  }

  if (targetDispatch.outcome === "retryable" && targetDispatch.attemptCount >= targetDispatch.maxAttempts) {
    targetDispatch = await writeTargetDispatchResult({
      outputRoot: targetRoot,
      attemptCount: targetDispatch.attemptCount,
      result: (({ dispatchArtifactPath: _dispatchArtifactPath, ...rest }) => ({
        ...rest,
        outcome: "exhausted",
        retryEligible: false,
      }))(targetDispatch),
    });
    updatedState = await persistTargetDispatchArtifact({
      state: updatedState,
      dependencies: params.dependencies,
      targetDispatch,
    });
  }

  const finalPatch = buildAutomationPatchFromDispatch({
    currentState: updatedState,
    dispatch: targetDispatch,
  });

  updatedState = await saveStateWithAutomationPatch({
    state: updatedState,
    dependencies: params.dependencies,
    patch: finalPatch.patch,
  });

  return gptCodeExternalAutomationResultSchema.parse({
    stateId: updatedState.id,
    source,
    sourceStatus: "linked",
    automaticTriggerStatus: "triggered",
    transportDispatchStatus: transportResult.dispatchStatus,
    targetDispatch: finalPatch.normalizedDispatch,
    outcome: finalPatch.normalizedDispatch.outcome,
    generatedAt: params.receivedAt,
  });
}

export async function runGptCodeExternalAutomationRecovery(params: {
  stateId: string;
  dependencies: OrchestratorDependencies;
  requestedAction?: GptCodeRecoveryRequestedAction;
  externalTargetAdapter?: GptCodeExternalTargetAdapter | null;
  recoveryRoot?: string;
}) {
  const state = await params.dependencies.storage.loadState(params.stateId);
  if (!state) {
    throw new Error(`State ${params.stateId} was not found.`);
  }

  const requestedAction = params.requestedAction ?? "auto";
  const recoveryRoot =
    params.recoveryRoot ?? path.join(state.task.repoPath, ".tmp", "orchestrator-external-recovery", state.id, "latest");
  const decision = evaluateReplayEligibility({
    state,
    requestedAction,
  });

  let updatedState = await saveStateWithAutomationPatch({
    state,
    dependencies: params.dependencies,
    patch: buildRecoveryEvaluationPatch({
      currentState: state,
      decision,
    }),
  });

  const nextInstructionPath = updatedState.lastGptCodeAutomationState?.nextInstructionPath ?? null;
  const outputPayloadPath = updatedState.lastGptCodeAutomationState?.outputPayloadPath ?? null;
  const blockedResult = async (
    outcome: Exclude<GptCodeReplayOutcome, "not_run">,
    reason: string | null,
  ) => {
    updatedState = await saveStateWithAutomationPatch({
      state: updatedState,
      dependencies: params.dependencies,
      patch: {
        ...buildRecoveryEvaluationPatch({
          currentState: updatedState,
          decision: {
            ...decision,
            replayBlockReason: reason ?? decision.replayBlockReason,
          },
          lastReplayOutcome: outcome,
        }),
        lastReplayAction: "none",
        recoveryHistorySummary: summarizeRecoveryDecisionHistory({
          currentSummary: updatedState.lastGptCodeAutomationState?.recoveryHistorySummary ?? null,
          requestedAction,
          replayEligibility: decision.replayEligibility,
          outcome,
          at: (params.dependencies.now ?? (() => new Date()))().toISOString(),
        }),
      },
    });
    const result = await writeExternalRecoveryResult({
      outputRoot: recoveryRoot,
      result: buildExternalRecoveryResultPayload({
        state: updatedState,
        requestedAction,
        resolvedAction: decision.resolvedAction,
        outcome,
        targetDispatch: null,
        generatedAt: (params.dependencies.now ?? (() => new Date()))().toISOString(),
      }),
    });
    updatedState = await persistRecoveryArtifact({
      state: updatedState,
      dependencies: params.dependencies,
      recoveryArtifactPath: result.recoveryArtifactPath,
    });
    return result;
  };

  if (requestedAction === "inspect") {
    const result = await writeExternalRecoveryResult({
      outputRoot: recoveryRoot,
      result: buildExternalRecoveryResultPayload({
        state: updatedState,
        requestedAction,
        resolvedAction: decision.resolvedAction,
        outcome: "not_run",
        targetDispatch: null,
        generatedAt: (params.dependencies.now ?? (() => new Date()))().toISOString(),
      }),
    });
    updatedState = await persistRecoveryArtifact({
      state: updatedState,
      dependencies: params.dependencies,
      recoveryArtifactPath: result.recoveryArtifactPath,
    });
    return result;
  }

  if (decision.resolvedAction === "none" || !decision.source) {
    return blockedResult(
      decision.replayEligibility === "manual_only" ? "manual_required" : "blocked",
      decision.replayBlockReason,
    );
  }
  if (!params.externalTargetAdapter) {
    return blockedResult("manual_required", "External target adapter is not configured for replay or resume.");
  }
  if (!nextInstructionPath || !outputPayloadPath) {
    return blockedResult("manual_required", "External recovery requires both next-instruction and output payload artifacts.");
  }

  try {
    await readFile(nextInstructionPath, "utf8");
    await readFile(outputPayloadPath, "utf8");
  } catch (error) {
    return blockedResult(
      "manual_required",
      `External recovery artifacts are no longer available: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const replayAttemptCount = (updatedState.lastGptCodeAutomationState?.replayAttemptCount ?? 0) + 1;
  let targetDispatch = await params.externalTargetAdapter.dispatchNextInstruction({
    state: updatedState,
    source: decision.source,
    nextInstructionPath,
    outputPayloadPath,
    outputRoot: recoveryRoot,
  });
  updatedState = await persistTargetDispatchArtifact({
    state: updatedState,
    dependencies: params.dependencies,
    targetDispatch,
  });

  while (decision.resolvedAction === "resume" && targetDispatch.outcome === "retryable" && targetDispatch.attemptCount < targetDispatch.maxAttempts) {
    const retryPatch = buildAutomationPatchFromDispatch({
      currentState: updatedState,
      dispatch: targetDispatch,
      recoveryAction: decision.resolvedAction,
      replayAttemptCount,
      replayEligibility: decision.replayEligibility,
      replayBlockReason: null,
      operatorRecoveryRecommendation: decision.recommendedAction,
    });
    updatedState = await saveStateWithAutomationPatch({
      state: updatedState,
      dependencies: params.dependencies,
      patch: retryPatch.patch,
    });

    targetDispatch = await params.externalTargetAdapter.dispatchNextInstruction({
      state: updatedState,
      source: decision.source,
      nextInstructionPath: updatedState.lastGptCodeAutomationState?.nextInstructionPath ?? nextInstructionPath,
      outputPayloadPath: updatedState.lastGptCodeAutomationState?.outputPayloadPath ?? outputPayloadPath,
      outputRoot: recoveryRoot,
    });
    updatedState = await persistTargetDispatchArtifact({
      state: updatedState,
      dependencies: params.dependencies,
      targetDispatch,
    });
  }

  const finalPatch = buildAutomationPatchFromDispatch({
    currentState: updatedState,
    dispatch: targetDispatch,
    recoveryAction: decision.resolvedAction,
    replayAttemptCount,
    replayEligibility: decision.replayEligibility,
    replayBlockReason: null,
    operatorRecoveryRecommendation: decision.recommendedAction,
  });

  updatedState = await saveStateWithAutomationPatch({
    state: updatedState,
    dependencies: params.dependencies,
    patch: finalPatch.patch,
  });

  const result = await writeExternalRecoveryResult({
    outputRoot: recoveryRoot,
    result: buildExternalRecoveryResultPayload({
      state: updatedState,
      requestedAction,
      resolvedAction: decision.resolvedAction,
      outcome: finalPatch.normalizedDispatch.outcome,
      targetDispatch: finalPatch.normalizedDispatch,
      generatedAt: finalPatch.normalizedDispatch.dispatchedAt,
    }),
  });
  updatedState = await persistRecoveryArtifact({
    state: updatedState,
    dependencies: params.dependencies,
    recoveryArtifactPath: result.recoveryArtifactPath,
  });
  return result;
}

export function getExternalSourceEventType(source: GptCodeExternalSourceMetadata) {
  return mapSourceTypeToSourceEventType(source);
}
