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
import { extractCommentIdFromUrl } from "../comment-sync";
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
  return parsed.suggestionLevel !== null || parsed.modifiedFiles.length > 0 || parsed.acceptanceResults.length > 0 || parsed.ciRuns.length > 0;
}

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

export function extractGptCodeReportFromGitHubComment(params: {
  payload: unknown;
  deliveryId: string | null;
  payloadPath: string | null;
  headersPath: string | null;
  receivedAt: string;
}) {
  const payload = params.payload as IssueCommentPayload;
  if (payload.action !== "created" || !payload.issue?.number || !payload.comment?.id || !payload.repository?.full_name) {
    return null;
  }
  const body = (payload.comment.body ?? "").trim();
  if (!body || !looksLikeGptCodeChineseReport(body)) {
    return null;
  }

  return gptCodeExternalSourceMetadataSchema.parse({
    sourceType: "github_issue_comment",
    sourceId: `github-comment:${payload.comment.id}`,
    sourceCorrelationId: `inbound:${params.deliveryId ?? payload.comment.id}`,
    repository: payload.repository.full_name,
    issueNumber: payload.issue.pull_request ? null : payload.issue.number,
    prNumber: payload.issue.pull_request ? payload.issue.number : null,
    commentId: payload.comment.id,
    payloadPath: params.payloadPath,
    headersPath: params.headersPath,
    receivedAt: params.receivedAt,
  });
}

export interface GptCodeExternalTargetAdapter {
  readonly kind: string;
  dispatchNextInstruction(params: {
    state: OrchestratorState;
    nextInstructionPath: string;
    outputPayloadPath: string;
    outputRoot: string;
  }): Promise<GptCodeExternalTargetDispatch>;
}

export class GhCliGptCodeGitHubCommentTargetAdapter implements GptCodeExternalTargetAdapter {
  readonly kind = "github_issue_comment";

  constructor(
    private readonly params: {
      enabled: boolean;
      token: string | null;
      execFileImpl?: ExecFileLike;
    },
  ) {}

  async dispatchNextInstruction(params: {
    state: OrchestratorState;
    nextInstructionPath: string;
    outputPayloadPath: string;
    outputRoot: string;
  }) {
    const now = new Date().toISOString();
    const threadTarget = resolveGitHubThreadTarget(params.state);
    const attemptCount = (params.state.lastGptCodeAutomationState?.targetAttemptCount ?? 0) + 1;
    await mkdir(params.outputRoot, { recursive: true });

    if (!threadTarget) {
      const result = gptCodeExternalTargetDispatchSchema.parse({
        stateId: params.state.id,
        targetType: this.kind,
        targetDestination: "github://missing-thread-target",
        attemptCount,
        outcome: "manual_required",
        externalReferenceId: null,
        externalUrl: null,
        dispatchArtifactPath: null,
        dispatchedAt: now,
      });
      return result;
    }

    const targetDestination = `github://${threadTarget.repository}/issues/${threadTarget.targetNumber}/comments`;
    const body = withInstructionMarker(await readFile(params.nextInstructionPath, "utf8"), params.state.id);
    const bodyPayloadPath = path.join(params.outputRoot, "github-target-body.json");
    await writeFile(bodyPayloadPath, `${JSON.stringify({ body }, null, 2)}\n`, "utf8");

    if (!this.params.enabled || !this.params.token) {
      const dispatchArtifactPath = path.join(params.outputRoot, "github-target-dispatch.json");
      const manualRequired = gptCodeExternalTargetDispatchSchema.parse({
        stateId: params.state.id,
        targetType: this.kind,
        targetDestination,
        attemptCount,
        outcome: "manual_required",
        externalReferenceId: null,
        externalUrl: null,
        dispatchArtifactPath,
        dispatchedAt: now,
      });
      await writeFile(dispatchArtifactPath, `${JSON.stringify(manualRequired, null, 2)}\n`, "utf8");
      return manualRequired;
    }

    const execImpl: ExecFileLike = this.params.execFileImpl ?? defaultExecFileLike;
    const correlationId = buildInstructionCorrelationId(params.state.id);
    let existingCommentId = params.state.lastGptCodeAutomationState?.targetExternalReferenceId ?? null;
    let existingUrl = params.state.lastGptCodeAutomationState?.targetExternalUrl ?? null;

    try {
      if (!existingCommentId) {
        const { stdout: listStdout } = await execImpl(
          "gh",
          ["api", `repos/${threadTarget.repository}/issues/${threadTarget.targetNumber}/comments`],
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
          ["api", `repos/${threadTarget.repository}/issues/comments/${existingCommentId}`, "--method", "PATCH", "--input", bodyPayloadPath],
          { windowsHide: true },
        );
        responsePayload = stdout.trim() ? (JSON.parse(stdout) as { id?: number; html_url?: string }) : null;
      } else {
        const { stdout } = await execImpl(
          "gh",
          ["api", `repos/${threadTarget.repository}/issues/${threadTarget.targetNumber}/comments`, "--method", "POST", "--input", bodyPayloadPath],
          { windowsHide: true },
        );
        responsePayload = stdout.trim() ? (JSON.parse(stdout) as { id?: number; html_url?: string }) : null;
      }

      const dispatchArtifactPath = path.join(params.outputRoot, "github-target-dispatch.json");
      const result = gptCodeExternalTargetDispatchSchema.parse({
        stateId: params.state.id,
        targetType: this.kind,
        targetDestination,
        attemptCount,
        outcome: "success",
        externalReferenceId: String(responsePayload?.id ?? existingCommentId ?? ""),
        externalUrl: responsePayload?.html_url ?? existingUrl,
        dispatchArtifactPath,
        dispatchedAt: now,
      });
      await writeFile(dispatchArtifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      return result;
    } catch {
      const dispatchArtifactPath = path.join(params.outputRoot, "github-target-dispatch.json");
      const result = gptCodeExternalTargetDispatchSchema.parse({
        stateId: params.state.id,
        targetType: this.kind,
        targetDestination,
        attemptCount,
        outcome: "failed",
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

  const payload = params.payload as IssueCommentPayload;
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

  const sourceRoot =
    path.join(state.task.repoPath, ".tmp", "orchestrator-external-source", state.id, "latest");
  await mkdir(sourceRoot, { recursive: true });
  const sourceMetadataPath = path.join(sourceRoot, "source-metadata.json");
  await writeFile(sourceMetadataPath, `${JSON.stringify(source, null, 2)}\n`, "utf8");

  let updatedState = await saveStateWithAutomationPatch({
    state,
    dependencies: params.dependencies,
    patch: {
      sourceAdapterStatus: "linked",
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceCorrelationId: source.sourceCorrelationId,
      sourcePayloadPath: source.payloadPath,
      sourceHeadersPath: source.headersPath,
      sourceReceivedAt: source.receivedAt,
      transportSource: "github_issue_comment",
      automaticTriggerStatus: "triggered",
      targetAdapterStatus: "not_attempted",
      targetType: params.externalTargetAdapter?.kind ?? null,
      targetDestination: null,
      targetAttemptCount: state.lastGptCodeAutomationState?.targetAttemptCount ?? 0,
      targetExternalReferenceId: null,
      targetExternalUrl: null,
      targetDispatchArtifactPath: null,
      externalAutomationOutcome: "not_run",
      recommendedNextStep: "Run transport and external target dispatch for the received GPT CODE report.",
      manualReviewReason: null,
    },
  });

  await submitGptCodeReportTransportEntry({
    stateId: updatedState.id,
    reportText,
    source: "github_issue_comment",
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
      transportResult.dispatchStatus === "dispatched" && !params.externalTargetAdapter ? "manual_required" : transportResult.dispatchStatus === "failed" ? "failed" : "manual_required";
    updatedState = await saveStateWithAutomationPatch({
      state: updatedState,
      dependencies: params.dependencies,
      patch: {
        targetAdapterStatus: params.externalTargetAdapter ? "manual_required" : "manual_required",
        targetType: params.externalTargetAdapter?.kind ?? null,
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
  const targetDispatch = await params.externalTargetAdapter.dispatchNextInstruction({
    state: updatedState,
    nextInstructionPath: updatedState.lastGptCodeAutomationState.nextInstructionPath,
    outputPayloadPath: updatedState.lastGptCodeAutomationState.outputPayloadPath,
    outputRoot: targetRoot,
  });

  updatedState = appendArtifacts(updatedState, [
    {
      kind: "gpt_code_external_target_dispatch",
      label: "GPT CODE external target dispatch result",
      path: targetDispatch.dispatchArtifactPath,
      value: null,
    },
  ]);
  await params.dependencies.storage.saveState(updatedState);

  updatedState = await saveStateWithAutomationPatch({
    state: updatedState,
    dependencies: params.dependencies,
    patch: {
      targetAdapterStatus:
        targetDispatch.outcome === "success"
          ? "dispatched"
          : targetDispatch.outcome === "manual_required"
            ? "manual_required"
            : "failed",
      targetType: targetDispatch.targetType,
      targetDestination: targetDispatch.targetDestination,
      targetAttemptCount: targetDispatch.attemptCount,
      targetExternalReferenceId: targetDispatch.externalReferenceId,
      targetExternalUrl: targetDispatch.externalUrl,
      targetDispatchArtifactPath: targetDispatch.dispatchArtifactPath,
      externalAutomationOutcome:
        targetDispatch.outcome === "success"
          ? "success"
          : targetDispatch.outcome === "manual_required"
            ? "manual_required"
            : "failed",
      lastDispatchedAt: targetDispatch.dispatchedAt,
      recommendedNextStep:
        targetDispatch.outcome === "success"
          ? "Wait for the external target response or the next GPT CODE report."
          : "Review the external target dispatch outcome manually.",
      manualReviewReason: targetDispatch.outcome === "success" ? null : updatedState.lastGptCodeAutomationState?.manualReviewReason,
    },
  });

  return gptCodeExternalAutomationResultSchema.parse({
    stateId: updatedState.id,
    source,
    sourceStatus: "linked",
    automaticTriggerStatus: "triggered",
    transportDispatchStatus: transportResult.dispatchStatus,
    targetDispatch,
    outcome:
      targetDispatch.outcome === "success"
        ? "success"
        : targetDispatch.outcome === "manual_required"
          ? "manual_required"
          : "failed",
    generatedAt: params.receivedAt,
  });
}
