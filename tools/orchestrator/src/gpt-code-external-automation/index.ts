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
    number?: number;
    title?: string;
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
    number?: number;
    title?: string;
  };
  comment?: {
    id?: number;
    body?: string | null;
  };
  repository?: {
    full_name?: string;
  };
};

type ExternalGitHubTargetRoute = {
  repository: string;
  targetNumber: number;
  targetDestination: string;
  targetLaneClassification:
    | "github_issue_thread_comment_lane"
    | "github_pull_request_thread_comment_lane"
    | "github_source_thread_fallback_lane";
  routingDecision: "state_thread_target" | "source_thread_fallback";
  fallbackDecision: "not_needed" | "source_thread_fallback";
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
  return source.sourceType === "github_pull_request_review_comment"
    ? "github_pull_request_review_comment"
    : "github_issue_comment";
}

function mapSourceTypeToSourceEventType(source: GptCodeExternalSourceMetadata) {
  return source.sourceType === "github_pull_request_review_comment"
    ? "pull_request_review_comment_report"
    : "issue_comment_report";
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

function resolveExternalGitHubTargetRoute(params: {
  state: OrchestratorState;
  source: GptCodeExternalSourceMetadata;
}): ExternalGitHubTargetRoute | null {
  const threadTarget = resolveGitHubThreadTarget(params.state);
  if (threadTarget) {
    return {
      repository: threadTarget.repository,
      targetNumber: threadTarget.targetNumber,
      targetDestination: `github://${threadTarget.repository}/issues/${threadTarget.targetNumber}/comments`,
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
    targetLaneClassification: "github_source_thread_fallback_lane",
    routingDecision: "source_thread_fallback",
    fallbackDecision: "source_thread_fallback",
    isPullRequest: params.source.prNumber != null,
  };
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

    const body = withInstructionMarker(await readFile(params.nextInstructionPath, "utf8"), params.state.id);
    const bodyPayloadPath = path.join(params.outputRoot, `github-target-body-attempt-${attemptCount}.json`);
    await writeFile(bodyPayloadPath, `${JSON.stringify({ body }, null, 2)}\n`, "utf8");

    if (!this.params.enabled || !this.params.token) {
      const dispatchArtifactPath = path.join(
        params.outputRoot,
        `github-target-dispatch-attempt-${attemptCount}.json`,
      );
      const result = gptCodeExternalTargetDispatchSchema.parse({
        stateId: params.state.id,
        targetType: this.kind,
        targetLaneClassification: route.targetLaneClassification,
        targetDestination: route.targetDestination,
        routingDecision: route.routingDecision,
        fallbackDecision: route.fallbackDecision,
        attemptCount,
        retryCount,
        maxAttempts: this.maxAttempts,
        outcome: "manual_required",
        retryEligible: false,
        failureClass: "auth",
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
    let existingCommentId = params.state.lastGptCodeAutomationState?.targetExternalReferenceId ?? null;
    let existingUrl = params.state.lastGptCodeAutomationState?.targetExternalUrl ?? null;

    try {
      if (!existingCommentId) {
        const { stdout: listStdout } = await execImpl(
          "gh",
          ["api", `repos/${route.repository}/issues/${route.targetNumber}/comments`],
          { windowsHide: true },
        );
        const comments = JSON.parse(listStdout || "[]") as Array<{ id?: number; body?: string; html_url?: string }>;
        const matched = comments.find((comment) => extractInstructionCorrelationId(comment.body ?? "") === correlationId);
        existingCommentId = matched?.id ? String(matched.id) : null;
        existingUrl = matched?.html_url ?? null;
      }

      let responsePayload: { id?: number; html_url?: string } | null = null;
      if (existingCommentId) {
        const { stdout } = await execImpl(
          "gh",
          ["api", `repos/${route.repository}/issues/comments/${existingCommentId}`, "--method", "PATCH", "--input", bodyPayloadPath],
          { windowsHide: true },
        );
        responsePayload = stdout.trim() ? (JSON.parse(stdout) as { id?: number; html_url?: string }) : null;
      } else {
        const { stdout } = await execImpl(
          "gh",
          ["api", `repos/${route.repository}/issues/${route.targetNumber}/comments`, "--method", "POST", "--input", bodyPayloadPath],
          { windowsHide: true },
        );
        responsePayload = stdout.trim() ? (JSON.parse(stdout) as { id?: number; html_url?: string }) : null;
      }

      const dispatchArtifactPath = path.join(
        params.outputRoot,
        `github-target-dispatch-attempt-${attemptCount}.json`,
      );
      const result = gptCodeExternalTargetDispatchSchema.parse({
        stateId: params.state.id,
        targetType: this.kind,
        targetLaneClassification: route.targetLaneClassification,
        targetDestination: route.targetDestination,
        routingDecision: route.routingDecision,
        fallbackDecision: route.fallbackDecision,
        attemptCount,
        retryCount,
        maxAttempts: this.maxAttempts,
        outcome: "success",
        retryEligible: false,
        failureClass: null,
        correlationId,
        externalReferenceId: String(responsePayload?.id ?? existingCommentId ?? ""),
        externalUrl: responsePayload?.html_url ?? existingUrl,
        dispatchArtifactPath,
        dispatchedAt: now,
      });
      await writeFile(dispatchArtifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      return result;
    } catch (error) {
      const classified = classifyGitHubDispatchFailure(error);
      const dispatchArtifactPath = path.join(
        params.outputRoot,
        `github-target-dispatch-attempt-${attemptCount}.json`,
      );
      const result = gptCodeExternalTargetDispatchSchema.parse({
        stateId: params.state.id,
        targetType: this.kind,
        targetLaneClassification: route.targetLaneClassification,
        targetDestination: route.targetDestination,
        routingDecision: route.routingDecision,
        fallbackDecision: route.fallbackDecision,
        attemptCount,
        retryCount,
        maxAttempts: this.maxAttempts,
        outcome: classified.outcome,
        retryEligible: classified.retryEligible,
        failureClass: classified.failureClass,
        correlationId,
        externalReferenceId: existingCommentId,
        externalUrl: existingUrl,
        dispatchArtifactPath,
        dispatchedAt: now,
      });
      await writeFile(dispatchArtifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      return result;
    }
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

  const payload = params.payload as IssueCommentPayload | PullRequestReviewCommentPayload;
  const reportText = (payload.comment?.body ?? "").trim();
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
