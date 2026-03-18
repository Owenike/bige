import { execFile } from "node:child_process";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { OrchestratorDependencies } from "../orchestrator";
import { findLatestStateForThread } from "../github-events";
import { parseGptCodeChineseReport } from "../gpt-code-report";
import {
  gptCodeExternalAutomationResultSchema,
  gptCodeExternalSourceMetadataSchema,
  gptCodeExternalTargetDispatchSchema,
  type GptCodeExternalAutomationResult,
  type GptCodeExternalSourceMetadata,
  type GptCodeExternalTargetDispatch,
} from "../gpt-code-report/schema";
import {
  consumeQueuedGptCodeReportTransport,
  submitGptCodeReportTransportEntry,
} from "../gpt-code-report-transport";
import { resolveGitHubThreadTarget } from "../comment-targeting";
import {
  gptCodeAutomationStateSchema,
  orchestratorStateSchema,
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
  current: GptCodeAutomationState | null | undefined;
  patch: Partial<GptCodeAutomationState>;
}) {
  return gptCodeAutomationStateSchema.parse({
    ...(params.current ?? {}),
    ...params.patch,
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
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("econn") ||
    message.includes("connect") ||
    message.includes("reset by peer") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("rate limit") ||
    message.includes("secondary rate")
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
  if (outcome === "manual_required") {
    return "manual_required" as const;
  }
  if (outcome === "retryable") {
    return "retryable" as const;
  }
  return "failed" as const;
}

function mapTargetOutcomeToRecommendedNextStep(outcome: GptCodeExternalTargetDispatch["outcome"]) {
  if (outcome === "success") {
    return "Wait for the external target response or the next GPT CODE report.";
  }
  if (outcome === "retryable") {
    return "Retry the external target dispatch or inspect the target health before retrying.";
  }
  return "Review the external target dispatch outcome manually.";
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
  result: Omit<GptCodeExternalTargetDispatch, "dispatchArtifactPath">;
}) {
  const dispatchArtifactPath = path.join(params.outputRoot, `github-target-dispatch-attempt-${params.attemptCount}.json`);
  const result = gptCodeExternalTargetDispatchSchema.parse({
    ...params.result,
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
}) {
  const correlationId = buildInstructionCorrelationId(params.state.id);
  const body = withInstructionMarker(await readFile(params.nextInstructionPath, "utf8"), params.state.id);
  const bodyPayloadPath = path.join(params.outputRoot, `github-target-body-attempt-${params.attemptCount}.json`);
  await writeFile(bodyPayloadPath, `${JSON.stringify({ body }, null, 2)}\n`, "utf8");

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
      const dispatchArtifactPath = path.join(
        params.outputRoot,
        `github-target-dispatch-attempt-${attemptCount}.json`,
      );
      const result = gptCodeExternalTargetDispatchSchema.parse({
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
        dispatchArtifactPath,
        dispatchedAt: now,
      });
      await writeFile(dispatchArtifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      return result;
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
        return dispatchInstructionToGitHubRoute({
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
      dispatchReliabilityOutcome: "not_run",
      externalAutomationOutcome: "not_run",
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
    updatedState = await saveStateWithAutomationPatch({
      state: updatedState,
      dependencies: params.dependencies,
      patch: {
        targetAdapterStatus: "manual_required",
        targetType: params.externalTargetAdapter?.kind ?? null,
        targetMaxAttempts,
        routingDecision: "manual_required",
        fallbackDecision: "manual_required",
        dispatchReliabilityOutcome: outcome,
        externalAutomationOutcome: outcome,
        manualReviewReason:
          transportResult.dispatchStatus === "dispatched" && !params.externalTargetAdapter
            ? "External target adapter is not configured."
            : updatedState.lastGptCodeAutomationState?.manualReviewReason,
        recommendedNextStep:
          updatedState.lastGptCodeAutomationState?.manualReviewReason ??
          "Review the transport outcome manually before external dispatch.",
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
    updatedState = await saveStateWithAutomationPatch({
      state: updatedState,
      dependencies: params.dependencies,
      patch: {
        targetAdapterStatus: "retryable",
        targetType: targetDispatch.targetType,
        targetLaneClassification: targetDispatch.targetLaneClassification,
        targetDestination: targetDispatch.targetDestination,
        targetAttemptCount: targetDispatch.attemptCount,
        targetRetryCount: targetDispatch.retryCount + 1,
        targetMaxAttempts: targetDispatch.maxAttempts,
        routingDecision: targetDispatch.routingDecision,
        fallbackDecision: targetDispatch.fallbackDecision,
        dispatchCorrelationId: targetDispatch.correlationId,
        targetExternalReferenceId: targetDispatch.externalReferenceId,
        targetExternalUrl: targetDispatch.externalUrl,
        targetDispatchArtifactPath: targetDispatch.dispatchArtifactPath,
        lastTargetFailureClass: targetDispatch.failureClass,
        dispatchReliabilityOutcome: "retryable",
        externalAutomationOutcome: "retryable",
        lastDispatchedAt: targetDispatch.dispatchedAt,
        recommendedNextStep: "Retrying the external target dispatch after a retryable failure.",
        manualReviewReason: null,
      },
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

  updatedState = await saveStateWithAutomationPatch({
    state: updatedState,
    dependencies: params.dependencies,
    patch: {
      targetAdapterStatus: mapTargetOutcomeToStatus(targetDispatch.outcome),
      targetType: targetDispatch.targetType,
      targetLaneClassification: targetDispatch.targetLaneClassification,
      targetDestination: targetDispatch.targetDestination,
      targetAttemptCount: targetDispatch.attemptCount,
      targetRetryCount: targetDispatch.retryCount,
      targetMaxAttempts: targetDispatch.maxAttempts,
      routingDecision: targetDispatch.routingDecision,
      fallbackDecision: targetDispatch.fallbackDecision,
      dispatchCorrelationId: targetDispatch.correlationId,
      targetExternalReferenceId: targetDispatch.externalReferenceId,
      targetExternalUrl: targetDispatch.externalUrl,
      targetDispatchArtifactPath: targetDispatch.dispatchArtifactPath,
      lastTargetFailureClass: targetDispatch.failureClass,
      dispatchReliabilityOutcome: targetDispatch.outcome,
      externalAutomationOutcome: targetDispatch.outcome,
      lastDispatchedAt: targetDispatch.dispatchedAt,
      recommendedNextStep: mapTargetOutcomeToRecommendedNextStep(targetDispatch.outcome),
      manualReviewReason:
        targetDispatch.outcome === "success"
          ? null
          : targetDispatch.outcome === "retryable"
            ? "External target dispatch remained retryable after the available attempts."
            : updatedState.lastGptCodeAutomationState?.manualReviewReason,
    },
  });

  return gptCodeExternalAutomationResultSchema.parse({
    stateId: updatedState.id,
    source,
    sourceStatus: "linked",
    automaticTriggerStatus: "triggered",
    transportDispatchStatus: transportResult.dispatchStatus,
    targetDispatch,
    outcome: targetDispatch.outcome,
    generatedAt: params.receivedAt,
  });
}

export function getExternalSourceEventType(source: GptCodeExternalSourceMetadata) {
  return mapSourceTypeToSourceEventType(source);
}
