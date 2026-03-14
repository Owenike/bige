import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildDiagnosticsSummary, formatDiagnosticsSummary } from "../diagnostics";
import {
  orchestratorStateSchema,
  statusReportSummarySchema,
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
    if (!this.params.enabled) {
      return statusReportSummarySchema.parse({
        status: "skipped",
        provider: this.kind,
        summary: "GitHub status reporting is disabled.",
        markdownPath: params.markdownPath,
        payloadPath: null,
        targetUrl: null,
        targetNumber: params.targetNumber,
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
        ranAt,
      });
    }
    const execImpl: ExecFileLike = this.params.execFileImpl ?? defaultExecFileLike;
    try {
      const args = params.isPullRequest
        ? ["pr", "comment", String(params.targetNumber), "--repo", params.repository, "--body-file", params.markdownPath]
        : ["issue", "comment", String(params.targetNumber), "--repo", params.repository, "--body-file", params.markdownPath];
      const { stdout } = await execImpl("gh", args, { windowsHide: true });
      return statusReportSummarySchema.parse({
        status: "comment_posted",
        provider: this.kind,
        summary: "GitHub comment summary was posted successfully.",
        markdownPath: params.markdownPath,
        payloadPath: null,
        targetUrl: stdout.trim() || null,
        targetNumber: params.targetNumber,
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
        ranAt,
      });
    }
  }
}

export function buildStatusReportPayload(state: OrchestratorState) {
  const diagnostics = buildDiagnosticsSummary(state);
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
    diagnostics,
    markdown: lines.join("\n"),
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

  const source = params.state.sourceEventSummary;
  if (!source || (!source.issueNumber && !source.prNumber)) {
    return statusReportSummarySchema.parse({
      status: "payload_ready",
      provider: "payload_only",
      summary: "Status report payload was generated without a GitHub target.",
      markdownPath,
      payloadPath,
      targetUrl: null,
      targetNumber: null,
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
      targetNumber: source.prNumber ?? source.issueNumber,
      ranAt: payload.generatedAt,
    });
  }

  const result = await params.adapter.postSummary({
    state: params.state,
    markdownPath,
    targetNumber: source.prNumber ?? source.issueNumber!,
    repository: source.repository,
    isPullRequest: Boolean(source.prNumber),
  });
  return statusReportSummarySchema.parse({
    ...result,
    markdownPath,
    payloadPath,
  });
}

export function applyStatusReportToState(state: OrchestratorState, summary: StatusReportSummary) {
  return orchestratorStateSchema.parse({
    ...state,
    statusReportStatus: summary.status,
    lastStatusReportSummary: summary,
    updatedAt: summary.ranAt,
  });
}
