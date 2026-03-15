import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { buildSandboxCloseoutOperatorChecklist } from "../sandbox-closeout-checklist";
import { buildSandboxCloseoutSummary } from "../sandbox-closeout-summary";
import { buildSandboxResolutionAuditHistory } from "../sandbox-resolution-audit-history";

const closeoutReviewActionSchema = z.object({
  id: z.string(),
  actedAt: z.string(),
  auditId: z.string().nullable().default(null),
  latestReviewAction: z.enum([
    "approve_closeout",
    "reject_closeout",
    "request_followup",
    "defer_review",
    "reopen_review",
  ]),
  latestReviewActionStatus: z.enum(["accepted", "blocked", "rejected", "manual_required"]),
  latestReviewActionReason: z.string().nullable().default(null),
  latestReviewActionNote: z.string().nullable().default(null),
  closeoutApproved: z.boolean().default(false),
  closeoutRejected: z.boolean().default(false),
  followUpRequested: z.boolean().default(false),
  reviewDeferred: z.boolean().default(false),
  reviewQueueReopened: z.boolean().default(false),
  actorSource: z.string(),
  commandSource: z.string().nullable().default(null),
  suggestedNextAction: z.string(),
  summaryLine: z.string(),
});

const closeoutReviewActionTrailSchema = z.object({
  updatedAt: z.string(),
  records: z.array(closeoutReviewActionSchema).default([]),
});

export type SandboxCloseoutReviewAction =
  | "approve_closeout"
  | "reject_closeout"
  | "request_followup"
  | "defer_review"
  | "reopen_review";

export type SandboxCloseoutReviewActionStatus = "accepted" | "blocked" | "rejected" | "manual_required";
export type SandboxCloseoutReviewActionRecord = z.infer<typeof closeoutReviewActionSchema>;

export type SandboxCloseoutReviewActionResult = {
  action: SandboxCloseoutReviewAction;
  status: SandboxCloseoutReviewActionStatus;
  auditId: string | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  reviewAction: SandboxCloseoutReviewActionRecord;
};

function buildActionId(
  actedAt: string,
  action: SandboxCloseoutReviewAction,
  auditId: string | null,
) {
  return `sandbox-closeout-review:${actedAt}:${action}:${auditId ?? "none"}`;
}

function resolveTrailPath(configPath: string) {
  return `${path.resolve(configPath)}.closeout-review-actions.json`;
}

async function loadActionTrail(configPath: string) {
  const trailPath = resolveTrailPath(configPath);
  try {
    const raw = await readFile(trailPath, "utf8");
    return {
      trailPath,
      trail: closeoutReviewActionTrailSchema.parse(JSON.parse(raw)),
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return {
        trailPath,
        trail: closeoutReviewActionTrailSchema.parse({
          updatedAt: new Date(0).toISOString(),
          records: [],
        }),
      };
    }
    throw error;
  }
}

async function saveActionTrail(
  configPath: string,
  trail: z.infer<typeof closeoutReviewActionTrailSchema>,
) {
  const trailPath = resolveTrailPath(configPath);
  await mkdir(path.dirname(trailPath), { recursive: true });
  await writeFile(trailPath, `${JSON.stringify(trail, null, 2)}\n`, "utf8");
  return trailPath;
}

function buildReviewActionRecord(params: {
  action: SandboxCloseoutReviewAction;
  status: SandboxCloseoutReviewActionStatus;
  auditId: string | null;
  actorSource: string;
  commandSource?: string | null;
  reason?: string | null;
  note?: string | null;
  suggestedNextAction: string;
  summaryLine: string;
}) {
  const actedAt = new Date().toISOString();
  return closeoutReviewActionSchema.parse({
    id: buildActionId(actedAt, params.action, params.auditId),
    actedAt,
    auditId: params.auditId,
    latestReviewAction: params.action,
    latestReviewActionStatus: params.status,
    latestReviewActionReason: params.reason ?? null,
    latestReviewActionNote: params.note ?? null,
    closeoutApproved: params.action === "approve_closeout" && params.status === "accepted",
    closeoutRejected: params.action === "reject_closeout" && params.status === "accepted",
    followUpRequested: params.action === "request_followup" && params.status === "accepted",
    reviewDeferred: params.action === "defer_review" && params.status === "accepted",
    reviewQueueReopened: params.action === "reopen_review" && params.status === "accepted",
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    suggestedNextAction: params.suggestedNextAction,
    summaryLine: params.summaryLine,
  });
}

async function appendCloseoutReviewAction(params: {
  configPath: string;
  action: SandboxCloseoutReviewAction;
  status: SandboxCloseoutReviewActionStatus;
  auditId: string | null;
  actorSource: string;
  commandSource?: string | null;
  reason?: string | null;
  note?: string | null;
  suggestedNextAction: string;
  summaryLine: string;
}) {
  const { trail } = await loadActionTrail(params.configPath);
  const record = buildReviewActionRecord(params);
  const nextTrail = closeoutReviewActionTrailSchema.parse({
    updatedAt: record.actedAt,
    records: [...trail.records, record].slice(-100),
  });
  await saveActionTrail(params.configPath, nextTrail);
  return record;
}

export async function listSandboxCloseoutReviewActions(params: {
  configPath: string;
  limit?: number;
}) {
  const { trailPath, trail } = await loadActionTrail(params.configPath);
  const limit = Math.max(1, params.limit ?? 20);
  return {
    trailPath,
    records: trail.records.slice(-limit).reverse() as SandboxCloseoutReviewActionRecord[],
  };
}

function resolveNextActionForReviewAction(params: {
  action: SandboxCloseoutReviewAction;
  status: SandboxCloseoutReviewActionStatus;
  checklist: Awaited<ReturnType<typeof buildSandboxCloseoutOperatorChecklist>>;
  closeoutSummary: Awaited<ReturnType<typeof buildSandboxCloseoutSummary>>;
}) {
  if (params.action === "approve_closeout" && params.status === "accepted") {
    return "closeout_complete";
  }
  if (params.action === "approve_closeout") {
    return params.closeoutSummary.recommendedNextStepAfterCloseoutCheck;
  }
  if (params.action === "reject_closeout") {
    return params.checklist.recommendedNextStep;
  }
  if (params.action === "request_followup") {
    return params.checklist.recommendedNextStep;
  }
  if (params.action === "defer_review") {
    return "request_review";
  }
  return params.checklist.recommendedNextStep;
}

export async function runSandboxCloseoutReviewAction(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  action: SandboxCloseoutReviewAction;
  actorSource: string;
  commandSource?: string | null;
  reason?: string | null;
  note?: string | null;
  auditId?: string | null;
  limit?: number;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const closeoutSummary = await buildSandboxCloseoutSummary({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const closeoutChecklist = await buildSandboxCloseoutOperatorChecklist({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const auditHistory = await buildSandboxResolutionAuditHistory({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const auditId = params.auditId ?? auditHistory.latestEntry?.id ?? null;
  if (!auditId) {
    const record = await appendCloseoutReviewAction({
      configPath: params.configPath,
      action: params.action,
      status: "rejected",
      auditId: null,
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? null,
      reason: params.reason ?? "sandbox_closeout_audit_missing",
      note: params.note ?? null,
      suggestedNextAction: "sandbox:resolution:audit",
      summaryLine: `Closeout review action '${params.action}' rejected because no closeout audit entry was available.`,
    });
    return {
      action: params.action,
      status: record.latestReviewActionStatus,
      auditId: null,
      summary: record.summaryLine,
      failureReason: "sandbox_closeout_audit_missing",
      suggestedNextAction: record.suggestedNextAction,
      reviewAction: record,
    } satisfies SandboxCloseoutReviewActionResult;
  }

  let status: SandboxCloseoutReviewActionStatus = "accepted";
  let failureReason: string | null = null;

  if (params.action === "approve_closeout") {
    if (
      !closeoutChecklist.safeToCloseout ||
      closeoutSummary.latestCloseoutDecision !== "closure_ready"
    ) {
      status =
        closeoutChecklist.blockedReasonCodes.length > 0 || !closeoutChecklist.noBlockedTerminalState
          ? "blocked"
          : !closeoutChecklist.noManualRequiredTerminalState ||
              !closeoutChecklist.requestReviewSatisfied ||
              !closeoutChecklist.escalationSatisfied
            ? "manual_required"
            : "rejected";
      failureReason = "sandbox_closeout_not_ready";
    }
  }

  const suggestedNextAction = resolveNextActionForReviewAction({
    action: params.action,
    status,
    checklist: closeoutChecklist,
    closeoutSummary,
  });
  const summaryLine =
    status === "accepted"
      ? `Closeout review action '${params.action}' accepted for audit '${auditId}'.`
      : `Closeout review action '${params.action}' ${status} for audit '${auditId}'.`;
  const record = await appendCloseoutReviewAction({
    configPath: params.configPath,
    action: params.action,
    status,
    auditId,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    reason:
      params.reason ??
      failureReason ??
      (params.action === "approve_closeout"
        ? "closeout_approved"
        : params.action === "reject_closeout"
          ? "closeout_rejected"
          : params.action === "request_followup"
            ? "closeout_followup_requested"
            : params.action === "defer_review"
              ? "closeout_review_deferred"
              : "closeout_review_reopened"),
    note: params.note ?? null,
    suggestedNextAction,
    summaryLine,
  });

  return {
    action: params.action,
    status,
    auditId,
    summary: summaryLine,
    failureReason,
    suggestedNextAction,
    reviewAction: record,
  } satisfies SandboxCloseoutReviewActionResult;
}

export function formatSandboxCloseoutReviewActionResult(result: SandboxCloseoutReviewActionResult) {
  return [
    `Sandbox closeout review action: ${result.action}`,
    `Status: ${result.status}`,
    `Audit: ${result.auditId ?? "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
  ].join("\n");
}

export function formatSandboxCloseoutReviewActions(params: {
  records: SandboxCloseoutReviewActionRecord[];
}) {
  return [
    "Sandbox closeout review actions",
    ...(params.records.length === 0
      ? ["No closeout review actions have been recorded yet."]
      : params.records.map(
          (record) =>
            `- ${record.actedAt} ${record.latestReviewAction}/${record.latestReviewActionStatus} audit=${record.auditId ?? "none"} reason=${record.latestReviewActionReason ?? "none"} note=${record.latestReviewActionNote ?? "none"} :: ${record.summaryLine}`,
        )),
  ].join("\n");
}
