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
  type StatusReportPermissionStatus,
  type StatusReportSummary,
} from "../schemas";
import { classifyGitHubReportingFailure, mapReadinessToPermissionStatus, summarizePermissionStatus } from "../github-report-permissions";
import { applyReportDeliveryAudit, formatReportDeliveryAttempts } from "../reporting-audit";

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

export type GitHubReportPermissionSmokeResult = {
  status: "ready" | "degraded" | "blocked";
  permissionStatus: StatusReportPermissionStatus;
  targetStrategy: "unknown" | "create" | "update" | "skip" | "blocked";
  targetKind: "artifact_only" | "issue_comment" | "pull_request_comment";
  targetId: number | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  providerUsed: "gh" | "payload_only";
};

function buildStatusReportAuditId(correlationId: string | null, ranAt: string, action: string) {
  return `report-delivery:${correlationId ?? "none"}:${ranAt}:${action}`;
}

function mapReadinessActionToSummaryAction(action: GitHubLiveReportReadiness["action"]) {
  if (action === "blocked") {
    return "blocked";
  }
  return "skipped";
}

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

export async function runGitHubReportPermissionSmoke(params: {
  state: OrchestratorState;
  enabled: boolean;
  token: string | null;
  execFileImpl?: ExecFileLike;
}): Promise<GitHubReportPermissionSmokeResult> {
  const execImpl: ExecFileLike = params.execFileImpl ?? defaultExecFileLike;
  const readiness = await evaluateGitHubLiveCommentReadiness({
    state: params.state,
    enabled: params.enabled,
    token: params.token,
    execFileImpl: execImpl,
  });

  if (readiness.status !== "ready") {
    return {
      status: readiness.status,
      permissionStatus: mapReadinessToPermissionStatus(readiness),
      targetStrategy: readiness.action,
      targetKind: readiness.targetKind,
      targetId: readiness.targetId,
      summary: readiness.summary,
      failureReason: readiness.failureReason,
      suggestedNextAction: readiness.suggestedNextAction,
      providerUsed: readiness.action === "skip" ? "payload_only" : "gh",
    };
  }

  const target = resolveStatusReportGitHubTarget(params.state);
  if (!target) {
    return {
      status: "blocked",
      permissionStatus: "blocked",
      targetStrategy: "blocked",
      targetKind: "artifact_only",
      targetId: null,
      summary: "GitHub live reporting is blocked because no issue or pull request target is available.",
      failureReason: "missing_github_thread_target",
      suggestedNextAction: "Run reporting from an issue or pull request sourced task.",
      providerUsed: "payload_only",
    };
  }

  const targetDecision = resolveCommentTargetingDecision({
    state: params.state,
  });

  try {
    if (targetDecision.action === "update" && targetDecision.commentId) {
      await execImpl("gh", ["api", `repos/${target.repository}/issues/comments/${targetDecision.commentId}`], {
        windowsHide: true,
      });
      return {
        status: "ready",
        permissionStatus: "ready",
        targetStrategy: "update",
        targetKind: targetDecision.targetKind,
        targetId: targetDecision.commentId,
        summary: "GitHub live reporting can reach the correlated comment and is ready to update it.",
        failureReason: null,
        suggestedNextAction: "Run the live comment reporting path to patch the correlated comment.",
        providerUsed: "gh",
      };
    }

    await execImpl("gh", ["api", `repos/${target.repository}/issues/${target.targetNumber}`], {
      windowsHide: true,
    });
    return {
      status: "ready",
      permissionStatus: "ready",
      targetStrategy: "create",
      targetKind: targetDecision.targetKind,
      targetId: target.targetNumber,
      summary: "GitHub live reporting can reach the target thread and is ready to create a correlated comment.",
      failureReason: null,
      suggestedNextAction: "Run the live comment reporting path to create the first correlated status comment.",
      providerUsed: "gh",
    };
  } catch (error) {
    const classified =
      targetDecision.action === "update"
        ? classifyGitHubReportingFailure({
            error,
            attemptedAction: "update",
          })
        : classifyGitHubReportingFailure({
            error,
            attemptedAction: "create",
          });

    return {
      status: "degraded",
      permissionStatus: classified.permissionStatus,
      targetStrategy: targetDecision.action === "update" ? "update" : "create",
      targetKind: targetDecision.targetKind,
      targetId: targetDecision.commentId ?? targetDecision.targetNumber,
      summary: summarizePermissionStatus(classified.permissionStatus),
      failureReason: classified.failureReason,
      suggestedNextAction: classified.suggestedNextAction,
      providerUsed: "gh",
    };
  }
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
      const auditId = buildStatusReportAuditId(correlationId, ranAt, "skipped");
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
        permissionStatus: "disabled",
        targetKind: params.isPullRequest ? "pull_request_comment" : "issue_comment",
        targetStrategy: "skip",
        failureReason: "github_live_reporting_disabled",
        action: "skipped",
        auditId,
        nextAction: "Enable live GitHub reporting before retrying comment delivery.",
        ranAt,
      });
    }
    if (!this.params.token) {
      const auditId = buildStatusReportAuditId(correlationId, ranAt, "skipped");
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
        permissionStatus: "missing_token",
        targetKind: params.isPullRequest ? "pull_request_comment" : "issue_comment",
        targetStrategy: "skip",
        failureReason: "missing_github_token",
        action: "skipped",
        auditId,
        nextAction: "Provide GITHUB_TOKEN or GH_TOKEN before retrying live reporting.",
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
      const auditId = buildStatusReportAuditId(correlationId, ranAt, readiness.action);
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
        permissionStatus: mapReadinessToPermissionStatus(readiness),
        targetKind: readiness.targetKind,
        targetStrategy: readiness.action,
        failureReason: readiness.failureReason,
        action: mapReadinessActionToSummaryAction(readiness.action),
        auditId,
        nextAction: readiness.suggestedNextAction,
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
        } catch (error) {
          const classified = classifyGitHubReportingFailure({
            error,
            attemptedAction: "update",
            correlatedTargetVisible: false,
          });
          if (classified.permissionStatus === "target_invalid") {
            existingCommentId = null;
            existingUrl = null;
          } else {
            const auditId = buildStatusReportAuditId(correlationId, ranAt, "failed");
            return statusReportSummarySchema.parse({
              status: "failed",
              provider: this.kind,
              summary: summarizePermissionStatus(classified.permissionStatus),
              markdownPath: params.markdownPath,
              payloadPath: null,
              targetUrl: existingUrl,
              targetNumber: params.targetNumber,
              commentId: params.state.lastStatusReportTarget?.commentId ?? null,
              correlationId,
              readiness: "degraded",
              permissionStatus: classified.permissionStatus,
              targetKind: params.isPullRequest ? "pull_request_comment" : "issue_comment",
              targetStrategy: "update",
              failureReason: classified.failureReason,
              action: "failed",
              auditId,
              nextAction: classified.suggestedNextAction,
              ranAt,
            });
          }
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
        const auditId = buildStatusReportAuditId(correlationId, ranAt, "updated");
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
          permissionStatus: "ready",
          targetKind: targeting.targetKind,
          targetStrategy: "update",
          failureReason: null,
          action: "updated",
          auditId,
          nextAction: "Continue using the correlated comment for subsequent status updates.",
          ranAt,
        });
      }

      const args = ["api", `repos/${params.repository}/issues/${params.targetNumber}/comments`, "--method", "POST", "--input", bodyPayloadPath];
      const { stdout } = await execImpl("gh", args, { windowsHide: true });
      const payload = stdout.trim() ? (JSON.parse(stdout) as { html_url?: string; id?: number }) : null;
      const auditId = buildStatusReportAuditId(correlationId, ranAt, "created");
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
        permissionStatus: "ready",
        targetKind: params.isPullRequest ? "pull_request_comment" : "issue_comment",
        targetStrategy: "create",
        failureReason: null,
        action: "created",
        auditId,
        nextAction: "Reuse the stored correlation target for subsequent status updates.",
        ranAt,
      });
    } catch (error) {
      const classified = classifyGitHubReportingFailure({
        error,
        attemptedAction: params.state.lastStatusReportTarget?.commentId ? "update" : "create",
        correlatedTargetVisible: Boolean(params.state.lastStatusReportTarget?.commentId),
      });
      const auditId = buildStatusReportAuditId(correlationId, ranAt, "failed");
      return statusReportSummarySchema.parse({
        status: "failed",
        provider: this.kind,
        summary: summarizePermissionStatus(classified.permissionStatus),
        markdownPath: params.markdownPath,
        payloadPath: null,
        targetUrl: null,
        targetNumber: params.targetNumber,
        commentId: null,
        correlationId,
        readiness: classified.permissionStatus === "target_invalid" ? "degraded" : "blocked",
        permissionStatus: classified.permissionStatus,
        targetKind: params.isPullRequest ? "pull_request_comment" : "issue_comment",
        targetStrategy: params.state.lastStatusReportTarget?.commentId ? "update" : "create",
        failureReason: classified.failureReason,
        action: "failed",
        auditId,
        nextAction: classified.suggestedNextAction,
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
    `- Live status reporting: status=${state.liveStatusReportStatus} / readiness=${state.liveStatusReportReadiness} / action=${state.lastStatusReportAction} / permission=${state.lastStatusReportPermissionStatus} / strategy=${state.lastStatusReportTargetStrategy}`,
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
    const auditId = buildStatusReportAuditId(payload.correlationId, payload.generatedAt, "payload_only");
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
      permissionStatus: "blocked",
      targetKind: "artifact_only",
      targetStrategy: "blocked",
      failureReason: "missing_github_thread_target",
      action: "payload_only",
      auditId,
      nextAction: "Run status reporting from an issue or pull request sourced task.",
      ranAt: payload.generatedAt,
    });
  }

  if (!params.adapter) {
    const auditId = buildStatusReportAuditId(payload.correlationId, payload.generatedAt, "payload_only");
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
      permissionStatus: "unknown",
      targetKind: target.isPullRequest ? "pull_request_comment" : "issue_comment",
      targetStrategy: "skip",
      failureReason: "github_adapter_not_configured",
      action: "payload_only",
      auditId,
      nextAction: "Configure a GitHub status reporting adapter to post or update live comments.",
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

export async function inspectGitHubReportingOperatorSummary(params: {
  state: OrchestratorState;
  enabled: boolean;
  token: string | null;
  execFileImpl?: ExecFileLike;
}) {
  const permissionSmoke = await runGitHubReportPermissionSmoke({
    state: params.state,
    enabled: params.enabled,
    token: params.token,
    execFileImpl: params.execFileImpl,
  });
  const recentAttempts = params.state.reportDeliveryAttempts.slice(-5);
  const lines = [
    `Live reporting readiness: ${params.state.liveStatusReportReadiness}`,
    `Last live report status: ${params.state.liveStatusReportStatus}`,
    `Last action: ${params.state.lastStatusReportAction}`,
    `Last permission status: ${params.state.lastStatusReportPermissionStatus}`,
    `Target strategy: ${params.state.lastStatusReportTargetStrategy}`,
    `Last auth smoke: ${params.state.authSmokeStatus} / ${params.state.authSmokeSuccessStatus} / ${params.state.authSmokePermissionResult}`,
    `Selected sandbox profile: ${params.state.selectedSandboxProfileId ?? "none"} / mode=${params.state.sandboxProfileSelectionMode} / reason=${params.state.sandboxProfileSelectionReason ?? "none"}`,
    `Sandbox target profile: ${params.state.sandboxProfileId ?? params.state.sandboxTargetProfileId ?? "none"} / status=${params.state.sandboxProfileStatus} / config=${params.state.sandboxTargetConfigVersion ?? "none"}`,
    `Sandbox governance: ${params.state.profileGovernanceStatus} / ${params.state.profileGovernanceReason ?? "none"}`,
    `Sandbox guardrails: ${params.state.lastSandboxGuardrailsStatus} / ${params.state.lastSandboxGuardrailsReason ?? "none"}`,
    `Sandbox audit: ${params.state.lastSandboxAuditId ?? "none"}`,
    `Last auth smoke target: ${params.state.lastAuthSmokeTarget?.repository ?? "none"}:${params.state.lastAuthSmokeTarget?.targetType ?? "none"}:${params.state.lastAuthSmokeTarget?.targetNumber ?? "none"}`,
    `Last auth smoke success at: ${params.state.lastAuthSmokeSuccessAt ?? "none"}`,
    `Last auth smoke summary: ${params.state.lastLiveSmokeSummary ?? "none"}`,
    `Last live smoke target: ${params.state.lastLiveSmokeTarget?.repository ?? "none"}:${params.state.lastLiveSmokeTarget?.targetType ?? "none"}:${params.state.lastLiveSmokeTarget?.targetNumber ?? "none"}`,
    `Last auth smoke evidence: ${params.state.lastAuthSmokeEvidencePath ?? "none"}`,
    `Current permission smoke: ${permissionSmoke.status} / ${permissionSmoke.permissionStatus} / ${permissionSmoke.targetStrategy}`,
    `Current target: ${permissionSmoke.targetKind}:${permissionSmoke.targetId ?? "none"}`,
    `Current summary: ${permissionSmoke.summary}`,
    `Next action: ${permissionSmoke.suggestedNextAction}`,
    `Recent sandbox audit:\n${params.state.recentSandboxAuditSummaries.join("\n") || "none"}`,
    `Recent attempts:\n${formatReportDeliveryAttempts(recentAttempts)}`,
  ];
  return {
    permissionSmoke,
    recentAttempts,
    summaryText: lines.join("\n"),
  };
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
  const audit = applyReportDeliveryAudit(state, summary);
  return orchestratorStateSchema.parse({
    ...state,
    liveStatusReportStatus: mapStatusSummaryToLiveStatus(summary),
    liveStatusReportReadiness: summary.readiness,
    lastStatusReportPermissionStatus: summary.permissionStatus,
    lastStatusReportReadinessStatus: summary.readiness,
    statusReportStatus: summary.status,
    statusReportCorrelationId: target.correlationId,
    lastStatusReportAction: summary.action,
    lastStatusReportTargetStrategy: summary.targetStrategy,
    lastStatusReportTarget: target,
    lastStatusReportFailureReason: summary.failureReason,
    lastStatusReportSummary: summary,
    reportDeliveryAttempts: audit.attempts,
    lastReportDeliveryAuditId: audit.lastAuditId,
    updatedAt: summary.ranAt,
  });
}
