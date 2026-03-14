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
};

function mapStatusSummaryToLiveStatus(summary: StatusReportSummary): OrchestratorState["liveStatusReportStatus"] {
  if (summary.status === "comment_created" || summary.status === "comment_updated" || summary.status === "comment_posted") {
    return "ready";
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
    };
  }
  if (!params.token) {
    return {
      status: "degraded",
      summary: "GitHub live status reporting is unavailable because GITHUB_TOKEN/GH_TOKEN is missing.",
      missingPrerequisites: ["GITHUB_TOKEN or GH_TOKEN"],
    };
  }
  const execImpl: ExecFileLike = params.execFileImpl ?? defaultExecFileLike;
  try {
    await execImpl("gh", ["--version"], { windowsHide: true });
    return {
      status: "ready",
      summary: "GitHub live status reporting is ready.",
      missingPrerequisites: [],
    };
  } catch (error) {
    return {
      status: "degraded",
      summary: error instanceof Error ? `GitHub live status reporting degraded: ${error.message}` : "GitHub live status reporting degraded because gh is unavailable.",
      missingPrerequisites: ["gh"],
    };
  }
}

export function resolveStatusReportGitHubTarget(state: OrchestratorState) {
  const source = state.sourceEventSummary;
  if (!source || (!source.issueNumber && !source.prNumber)) {
    return null;
  }
  return {
    repository: source.repository,
    targetNumber: source.prNumber ?? source.issueNumber!,
    isPullRequest: Boolean(source.prNumber),
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
        action: "skipped",
        ranAt,
      });
    }
    const execImpl: ExecFileLike = this.params.execFileImpl ?? defaultExecFileLike;
    const readiness = await assessGitHubLiveReporting({
      enabled: this.params.enabled,
      token: this.params.token,
      execFileImpl: execImpl,
    });
    if (readiness.status !== "ready") {
      return statusReportSummarySchema.parse({
        status: "skipped",
        provider: this.kind,
        summary: readiness.summary,
        markdownPath: params.markdownPath,
        payloadPath: null,
        targetUrl: null,
        targetNumber: params.targetNumber,
        commentId: null,
        correlationId,
        action: "skipped",
        ranAt,
      });
    }
    const markdown = withStatusReportMarker(await readFile(params.markdownPath, "utf8"), correlationId);
    const bodyPayloadPath = path.join(path.dirname(params.markdownPath), `${params.state.id}-status-report-gh.json`);
    await writeFile(bodyPayloadPath, `${JSON.stringify({ body: markdown }, null, 2)}\n`, "utf8");
    try {
      let existingCommentId = params.state.lastStatusReportTarget?.commentId ?? null;
      let existingUrl = params.state.lastStatusReportTarget?.targetUrl ?? null;

      if (!existingCommentId) {
        const listArgs = ["api", `repos/${params.repository}/issues/${params.targetNumber}/comments`];
        const { stdout: listStdout } = await execImpl("gh", listArgs, { windowsHide: true });
        const comments = JSON.parse(listStdout || "[]") as Array<{ id?: number; body?: string; html_url?: string }>;
        const matched = comments.find((comment) => extractCorrelationIdFromBody(comment.body ?? "") === correlationId);
        existingCommentId = matched?.id ?? null;
        existingUrl = matched?.html_url ?? null;
      }

      if (existingCommentId) {
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
          commentId: payload?.id ?? existingCommentId,
          correlationId,
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
  lines.push(`- Live status reporting: ${state.liveStatusReportStatus}`);
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

export function applyStatusReportToState(state: OrchestratorState, summary: StatusReportSummary) {
  const target = statusReportTargetSchema.parse(
    deriveStatusReportTarget({
      state,
      correlationId: summary.correlationId ?? buildStatusReportCorrelationId(state),
      targetUrl: summary.targetUrl,
      targetNumber: summary.targetNumber,
      commentId: summary.commentId,
      updatedAt: summary.ranAt,
    }),
  );
  return orchestratorStateSchema.parse({
    ...state,
    liveStatusReportStatus: mapStatusSummaryToLiveStatus(summary),
    statusReportStatus: summary.status,
    statusReportCorrelationId: target.correlationId,
    lastStatusReportTarget: target,
    lastStatusReportSummary: summary,
    updatedAt: summary.ranAt,
  });
}
