import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildStatusReportCorrelationId,
  deriveStatusReportTarget,
  extractCommentIdFromUrl,
  extractCorrelationIdFromBody,
  withStatusReportMarker,
} from "../comment-sync";
import { resolveCommentTargetingDecision, resolveGitHubThreadTarget } from "../comment-targeting";
import { buildDiagnosticsSummary, formatDiagnosticsSummary } from "../diagnostics";
import {
  orchestratorStateSchema,
  statusReportSummarySchema,
  statusReportTargetSchema,
  type OrchestratorState,
  type StatusReportSummary,
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

export interface StatusReportingAdapter {
  readonly kind: string;
  postSummary(params: {
    state: OrchestratorState;
    markdownPath: string;
    targetNumber: number;
    repository: string;
    isPullRequest: boolean;
  }): Promise<StatusReportSummary>;
}

export type GitHubLiveReportReadiness = {
  status: "ready" | "degraded" | "blocked";
  summary: string;
  missingPrerequisites: string[];
  action: "create" | "update" | "skip" | "blocked";
  targetKind: OrchestratorState["lastStatusReportTarget"] extends infer T
    ? T extends { kind: infer K }
      ? K
      : "artifact_only"
    : "artifact_only";
  targetId: number | null;
  failureReason: string | null;
  suggestedNextAction: string;
};

function mapStatusSummaryToLiveStatus(summary: StatusReportSummary): OrchestratorState["liveStatusReportStatus"] {
  if (summary.status === "comment_created" || summary.status === "comment_updated" || summary.status === "comment_posted") {
    return "ready";
  }
  if (summary.status === "blocked") {
    return "blocked";
  }
  if (summary.readiness === "degraded") {
    return "degraded";
  }
  if (summary.status === "skipped") {
    return "skipped";
  }
  if (summary.status === "failed") {
    return "failed";
  }
  return "unknown";
}

export async function assessGitHubLiveReporting(params: {
  enabled: boolean;
  token: string | null;
  execFileImpl?: ExecFileLike;
}): Promise<GitHubLiveReportReadiness> {
  if (!params.enabled) {
    return {
      status: "degraded",
      summary: "GitHub live status reporting is disabled; payload-only reporting remains available.",
      missingPrerequisites: ["status-reporting.enabled"],
      action: "skip",
      targetKind: "artifact_only",
      targetId: null,
      failureReason: "github_live_reporting_disabled",
      suggestedNextAction: "Enable live status reporting to allow GitHub comment create or update.",
    };
  }
  if (!params.token) {
    return {
      status: "degraded",
      summary: "GitHub live status reporting is unavailable because GITHUB_TOKEN/GH_TOKEN is missing.",
      missingPrerequisites: ["GITHUB_TOKEN or GH_TOKEN"],
      action: "skip",
      targetKind: "artifact_only",
      targetId: null,
      failureReason: "missing_github_token",
      suggestedNextAction: "Provide GITHUB_TOKEN or GH_TOKEN to enable live GitHub comment reporting.",
    };
  }
  const execImpl: ExecFileLike = params.execFileImpl ?? defaultExecFileLike;
  try {
    await execImpl("gh", ["--version"], { windowsHide: true });
    return {
      status: "ready",
      summary: "GitHub live status reporting is ready.",
      missingPrerequisites: [],
      action: "create",
      targetKind: "artifact_only",
      targetId: null,
      failureReason: null,
      suggestedNextAction: "Run the GitHub live reporting path against an issue or pull request target.",
    };
  } catch (error) {
    return {
      status: "degraded",
      summary: error instanceof Error ? `GitHub live status reporting degraded: ${error.message}` : "GitHub live status reporting degraded because gh is unavailable.",
      missingPrerequisites: ["gh"],
      action: "skip",
      targetKind: "artifact_only",
      targetId: null,
      failureReason: "missing_gh_cli",
      suggestedNextAction: "Install gh and ensure it is available on PATH.",
    };
  }
}

export async function evaluateGitHubLiveCommentReadiness(params: {
  state: OrchestratorState;
  enabled: boolean;
  token: string | null;
  execFileImpl?: ExecFileLike;
}): Promise<GitHubLiveReportReadiness> {
  const baseReadiness = await assessGitHubLiveReporting({
    enabled: params.enabled,
    token: params.token,
    execFileImpl: params.execFileImpl,
  });
  const targeting = resolveCommentTargetingDecision({
    state: params.state,
  });
  if (baseReadiness.status !== "ready") {
    return {
      ...baseReadiness,
      action: "skip",
      targetKind: targeting.targetKind,
      targetId: targeting.commentId ?? targeting.targetNumber,
    };
  }
  if (targeting.status === "blocked") {
    return {
      status: "blocked",
      summary: targeting.summary,
      missingPrerequisites: ["GitHub issue or pull request target"],
      action: "blocked",
      targetKind: targeting.targetKind,
      targetId: null,
      failureReason: targeting.failureReason,
      suggestedNextAction: targeting.suggestedNextAction,
    };
  }
  return {
    status: "ready",
    summary: targeting.summary,
    missingPrerequisites: [],
    action: targeting.action,
    targetKind: targeting.targetKind,
    targetId: targeting.commentId ?? targeting.targetNumber,
    failureReason: null,
    suggestedNextAction: targeting.suggestedNextAction,
  };
}

export function resolveStatusReportGitHubTarget(state: OrchestratorState) {
  const target = resolveGitHubThreadTarget(state);
  if (!target) {
    return null;
  }
  return {
    repository: target.repository,
    targetNumber: target.targetNumber,
    isPullRequest: target.isPullRequest,
  };
}

export class GhCliStatusReportingAdapter implements StatusReportingAdapter {
  readonly kind = "github_comment";

  constructor(
    private readonly params: {
      enabled: boolean;
      token: string | null;
      execFileImpl?: ExecFileLike;
    },
  ) {}

  async postSummary(params: {
    state: OrchestratorState;
    markdownPath: string;
    targetNumber: number;
    repository: string;
    isPullRequest: boolean;
  }) {
    const ranAt = new Date().toISOString();
    const correlationId = buildStatusReportCorrelationId(params.state);
    if (!this.params.enabled) {
      return statusReportSummarySchema.parse({
        status: "skipped",
        provider: this.kind,
        summary: "GitHub status reporting is disabled.",
        markdownPath: params.markdownPath,
        payloadPath: null,
        targetUrl: null,
        targetNumber: params.targetNumber,
        commentId: null,
        correlationId,
        readiness: "degraded",
        targetKind: params.isPullRequest ? "pull_request_comment" : "issue_comment",
        failureReason: "github_live_reporting_disabled",
        action: "skipped",
        ranAt,
      });
    }
    if (!this.params.token) {
      return statusReportSummarySchema.parse({
        status: "skipped",
        provider: this.kind,
        summary: "GitHub status reporting skipped because GITHUB_TOKEN/GH_TOKEN is missing.",
        markdownPath: params.markdownPath,
        payloadPath: null,
        targetUrl: null,
        targetNumber: params.targetNumber,
        commentId: null,
        correlationId,
        readiness: "degraded",
        targetKind: params.isPullRequest ? "pull_request_comment" : "issue_comment",
        failureReason: "missing_github_token",
        action: "skipped",
        ranAt,
      });
    }
    const execImpl: ExecFileLike = this.params.execFileImpl ?? defaultExecFileLike;
    const readiness = await evaluateGitHubLiveCommentReadiness({
      state: params.state,
      enabled: this.params.enabled,
      token: this.params.token,
      execFileImpl: execImpl,
    });
    if (readiness.status !== "ready") {
      return statusReportSummarySchema.parse({
        status: readiness.status === "blocked" ? "blocked" : "skipped",
        provider: this.kind,
        summary: readiness.summary,
        markdownPath: params.markdownPath,
        payloadPath: null,
        targetUrl: null,
        targetNumber: params.targetNumber,
        commentId: null,
        correlationId,
        readiness: readiness.status,
        targetKind: readiness.targetKind,
        failureReason: readiness.failureReason,
        action: readiness.action === "blocked" ? "blocked" : "skipped",
        ranAt,
      });
    }
    const markdown = withStatusReportMarker(await readFile(params.markdownPath, "utf8"), correlationId);
    const bodyPayloadPath = path.join(path.dirname(params.markdownPath), `${params.state.id}-status-report-gh.json`);
    await writeFile(bodyPayloadPath, `${JSON.stringify({ body: markdown }, null, 2)}\n`, "utf8");
    try {
      let existingCommentId = params.state.lastStatusReportTarget?.commentId ?? null;
      let existingUrl = params.state.lastStatusReportTarget?.targetUrl ?? null;

      if (existingCommentId) {
        try {
          const { stdout } = await execImpl("gh", ["api", `repos/${params.repository}/issues/comments/${existingCommentId}`], {
            windowsHide: true,
          });
          const payload = stdout.trim() ? (JSON.parse(stdout) as { id?: number; html_url?: string }) : null;
          existingCommentId = payload?.id ?? existingCommentId;
          existingUrl = payload?.html_url ?? existingUrl;
        } catch {
          existingCommentId = null;
          existingUrl = null;
        }
      }

      if (!existingCommentId) {
        const listArgs = ["api", `repos/${params.repository}/issues/${params.targetNumber}/comments`];
        const { stdout: listStdout } = await execImpl("gh", listArgs, { windowsHide: true });
        const comments = JSON.parse(listStdout || "[]") as Array<{ id?: number; body?: string; html_url?: string }>;
        const matched = comments.find((comment) => extractCorrelationIdFromBody(comment.body ?? "") === correlationId);
        existingCommentId = matched?.id ?? null;
        existingUrl = matched?.html_url ?? null;
      }

      const targeting = resolveCommentTargetingDecision({
        state: params.state,
        discoveredComment:
          existingCommentId || existingUrl
            ? {
                id: existingCommentId,
                url: existingUrl,
              }
            : null,
      });

      if (targeting.action === "update" && targeting.commentId) {
        const args = ["api", `repos/${params.repository}/issues/comments/${existingCommentId}`, "--method", "PATCH", "--input", bodyPayloadPath];
        const { stdout } = await execImpl("gh", args, { windowsHide: true });
        const payload = stdout.trim() ? (JSON.parse(stdout) as { html_url?: string; id?: number }) : null;
        return statusReportSummarySchema.parse({
          status: "comment_updated",
          provider: this.kind,
          summary: "GitHub status comment was updated successfully.",
          markdownPath: params.markdownPath,
          payloadPath: null,
          targetUrl: payload?.html_url ?? existingUrl,
          targetNumber: params.targetNumber,
          commentId: payload?.id ?? targeting.commentId,
          correlationId,
          readiness: "ready",
          targetKind: targeting.targetKind,
          failureReason: null,
          action: "updated",
          ranAt,
        });
      }

      const args = ["api", `repos/${params.repository}/issues/${params.targetNumber}/comments`, "--method", "POST", "--input", bodyPayloadPath];
      const { stdout } = await execImpl("gh", args, { windowsHide: true });
      const payload = stdout.trim() ? (JSON.parse(stdout) as { html_url?: string; id?: number }) : null;
      return statusReportSummarySchema.parse({
        status: "comment_created",
        provider: this.kind,
        summary: "GitHub comment summary was posted successfully.",
        markdownPath: params.markdownPath,
        payloadPath: null,
        targetUrl: payload?.html_url ?? null,
        targetNumber: params.targetNumber,
        commentId: payload?.id ?? extractCommentIdFromUrl(payload?.html_url),
        correlationId,
        readiness: "ready",
        targetKind: params.isPullRequest ? "pull_request_comment" : "issue_comment",
        failureReason: null,
        action: "created",
        ranAt,
      });
    } catch (error) {
      return statusReportSummarySchema.parse({
        status: "failed",
        provider: this.kind,
        summary: error instanceof Error ? error.message : "GitHub comment reporting failed.",
        markdownPath: params.markdownPath,
        payloadPath: null,
        targetUrl: null,
        targetNumber: params.targetNumber,
        commentId: null,
        correlationId,
        readiness: "blocked",
        targetKind: params.isPullRequest ? "pull_request_comment" : "issue_comment",
        failureReason: error instanceof Error ? error.message : "github_live_comment_failed",
        action: "failed",
        ranAt,
      });
    }
  }
}

export function buildStatusReportPayload(state: OrchestratorState) {
  const diagnostics = buildDiagnosticsSummary(state);
  const correlationId = buildStatusReportCorrelationId(state);
  const lines = [
    `## Orchestrator Status`,
    ``,
    `- State: ${state.status}`,
    `- Iteration: ${state.iterationNumber}`,
    `- Profile: ${state.task.profileId}`,
    `- Planner: ${diagnostics.plannerSummary}`,
    `- Reviewer: ${diagnostics.reviewerSummary}`,
    `- Next action: ${diagnostics.nextSuggestedAction}`,
    `- Blockers: ${diagnostics.blockers.join(" | ") || "none"}`,
    `- Missing prerequisites: ${diagnostics.missingPrerequisites.join(", ") || "none"}`,
    `- Handoff: ${state.handoffStatus}`,
    `- Promotion: ${state.promotionStatus}`,
    `- Workspace: ${state.workspaceStatus}`,
  ];
  if (state.commandRoutingDecision) {
    lines.push(`- Command routing: ${state.commandRoutingDecision.status} / ${state.commandRoutingDecision.action}`);
  }
  if (state.sourceEventId || state.webhookDeliveryId) {
    lines.push(`- Source event: ${state.sourceEventType} / ${state.sourceEventId ?? "none"} / delivery=${state.webhookDeliveryId ?? "none"}`);
  }
  if (state.inboundEventId || state.actorIdentity?.login) {
    lines.push(
      `- Inbound audit: ${state.inboundEventId ?? "none"} / actor=${state.actorIdentity?.login ?? "none"} / auth=${state.actorAuthorizationStatus} / actorPolicy=${state.actorPolicyConfigVersion ?? "none"} / replay=${state.replayProtectionStatus}`,
    );
  }
  lines.push(`- Runtime: health=${state.runtimeHealthStatus} / readiness=${state.runtimeReadinessStatus}`);
  lines.push(
    `- Live status reporting: status=${state.liveStatusReportStatus} / readiness=${state.liveStatusReportReadiness} / action=${state.lastStatusReportAction}`,
  );
  if (state.lastHandoffPackagePath) {
    lines.push(`- Handoff package: ${state.lastHandoffPackagePath}`);
  }
  if (state.lastPrDraftMetadata?.payloadPath) {
    lines.push(`- PR draft payload: ${state.lastPrDraftMetadata.payloadPath}`);
  }
  return {
    stateId: state.id,
    sourceEventType: state.sourceEventType,
    sourceEventId: state.sourceEventId,
    triggerPolicyId: state.triggerPolicyId,
    idempotencyKey: state.idempotencyKey,
    correlationId,
    diagnostics,
    markdown: withStatusReportMarker(lines.join("\n"), correlationId),
    generatedAt: new Date().toISOString(),
  };
}

export async function reportStateStatus(params: {
  state: OrchestratorState;
  outputRoot: string;
  adapter?: StatusReportingAdapter | null;
}) {
  const payload = buildStatusReportPayload(params.state);
  await mkdir(params.outputRoot, { recursive: true });
  const markdownPath = path.join(params.outputRoot, `${params.state.id}-status-report.md`);
  const payloadPath = path.join(params.outputRoot, `${params.state.id}-status-report.json`);
  await writeFile(markdownPath, `${payload.markdown}\n`, "utf8");
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const target = resolveStatusReportGitHubTarget(params.state);
  if (!target) {
    return statusReportSummarySchema.parse({
      status: "payload_ready",
      provider: "payload_only",
      summary: "Status report payload was generated without a GitHub target.",
      markdownPath,
      payloadPath,
      targetUrl: null,
      targetNumber: null,
      commentId: null,
      correlationId: payload.correlationId,
      readiness: "blocked",
      targetKind: "artifact_only",
      failureReason: "missing_github_thread_target",
      action: "payload_only",
      ranAt: payload.generatedAt,
    });
  }

  if (!params.adapter) {
    return statusReportSummarySchema.parse({
      status: "payload_ready",
      provider: "payload_only",
      summary: "Status report payload was generated; no GitHub adapter is configured.",
      markdownPath,
      payloadPath,
      targetUrl: null,
      targetNumber: target.targetNumber,
      commentId: null,
      correlationId: payload.correlationId,
      readiness: "degraded",
      targetKind: target.isPullRequest ? "pull_request_comment" : "issue_comment",
      failureReason: "github_adapter_not_configured",
      action: "payload_only",
      ranAt: payload.generatedAt,
    });
  }

  const result = await params.adapter.postSummary({
    state: params.state,
    markdownPath,
    targetNumber: target.targetNumber,
    repository: target.repository,
    isPullRequest: target.isPullRequest,
  });
  return statusReportSummarySchema.parse({
    ...result,
    markdownPath,
    payloadPath,
  });
}

export async function runGitHubLiveCommentSmoke(params: {
  state: OrchestratorState;
  outputRoot: string;
  adapter: StatusReportingAdapter;
}) {
  const first = await reportStateStatus(params);
  const firstState = applyStatusReportToState(params.state, first);
  if (first.status !== "comment_created" && first.status !== "comment_updated") {
    return {
      first,
      second: null,
      final: first,
      state: firstState,
    };
  }
  const second = await reportStateStatus({
    ...params,
    state: firstState,
  });
  return {
    first,
    second,
    final: second,
    state: applyStatusReportToState(firstState, second),
  };
}

export function applyStatusReportToState(state: OrchestratorState, summary: StatusReportSummary) {
  const target = statusReportTargetSchema.parse(
    deriveStatusReportTarget({
      state,
      correlationId: summary.correlationId ?? buildStatusReportCorrelationId(state),
      targetUrl: summary.targetUrl,
      targetNumber: summary.targetNumber,
      commentId: summary.commentId,
      targetKind: summary.targetKind,
      updatedAt: summary.ranAt,
    }),
  );
  return orchestratorStateSchema.parse({
    ...state,
    liveStatusReportStatus: mapStatusSummaryToLiveStatus(summary),
    liveStatusReportReadiness: summary.readiness,
    statusReportStatus: summary.status,
    statusReportCorrelationId: target.correlationId,
    lastStatusReportAction: summary.action,
    lastStatusReportTarget: target,
    lastStatusReportFailureReason: summary.failureReason,
    lastStatusReportSummary: summary,
    updatedAt: summary.ranAt,
  });
}
