import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import {
  buildSandboxCloseoutCompletionCarryForwardQueue,
  type SandboxCloseoutCompletionCarryForwardQueue,
} from "../sandbox-closeout-completion-carry-forward-queue";
import {
  buildSandboxCloseoutCompletionHistory,
  type SandboxCloseoutCompletionHistory,
} from "../sandbox-closeout-completion-history";
import {
  buildSandboxCloseoutCompletionResolutionSummary,
  type SandboxCloseoutCompletionResolutionSummary,
} from "../sandbox-closeout-completion-resolution-summary";
import { listSandboxCloseoutCompletionAudits } from "../sandbox-closeout-completion-audit";

const COMPLETION_ACTION_SCHEMA = z.object({
  id: z.string(),
  actedAt: z.string(),
  completionAuditId: z.string().nullable().default(null),
  latestCompletionAction: z.enum([
    "confirm_review_complete",
    "confirm_closeout_complete",
    "keep_carry_forward",
    "reopen_completion",
  ]),
  latestCompletionActionStatus: z.enum(["accepted", "blocked", "rejected", "manual_required"]),
  latestCompletionActionReason: z.string().nullable().default(null),
  latestCompletionActionNote: z.string().nullable().default(null),
  reviewCompleteConfirmed: z.boolean().default(false),
  closeoutCompleteConfirmed: z.boolean().default(false),
  carryForwardRetained: z.boolean().default(false),
  completionReopened: z.boolean().default(false),
  actorSource: z.string(),
  commandSource: z.string().nullable().default(null),
  suggestedNextAction: z.string(),
  summaryLine: z.string(),
});

const COMPLETION_ACTION_TRAIL_SCHEMA = z.object({
  updatedAt: z.string(),
  records: z.array(COMPLETION_ACTION_SCHEMA).default([]),
});

const TERMINAL_SEVERITIES = new Set(["critical", "manual_required", "blocked"]);
const COMPLETE_STATUSES = new Set(["review_complete_allowed", "closeout_complete_allowed"]);

export type SandboxCloseoutCompletionAction =
  | "confirm_review_complete"
  | "confirm_closeout_complete"
  | "keep_carry_forward"
  | "reopen_completion";

export type SandboxCloseoutCompletionActionStatus =
  | "accepted"
  | "blocked"
  | "rejected"
  | "manual_required";

export type SandboxCloseoutCompletionActionRecord = z.infer<typeof COMPLETION_ACTION_SCHEMA>;

export type SandboxCloseoutCompletionActionResult = {
  action: SandboxCloseoutCompletionAction;
  status: SandboxCloseoutCompletionActionStatus;
  completionAuditId: string | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  completionAction: SandboxCloseoutCompletionActionRecord;
};

function buildCompletionActionId(
  actedAt: string,
  action: SandboxCloseoutCompletionAction,
  completionAuditId: string | null,
) {
  return `sandbox-closeout-completion-action:${actedAt}:${action}:${completionAuditId ?? "none"}`;
}

function resolveTrailPath(configPath: string) {
  return `${path.resolve(configPath)}.closeout-completion-actions.json`;
}

async function loadCompletionActionTrail(configPath: string) {
  const trailPath = resolveTrailPath(configPath);
  try {
    const raw = await readFile(trailPath, "utf8");
    return {
      trailPath,
      trail: COMPLETION_ACTION_TRAIL_SCHEMA.parse(JSON.parse(raw)),
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return {
        trailPath,
        trail: COMPLETION_ACTION_TRAIL_SCHEMA.parse({
          updatedAt: new Date(0).toISOString(),
          records: [],
        }),
      };
    }
    throw error;
  }
}

async function saveCompletionActionTrail(
  configPath: string,
  trail: z.infer<typeof COMPLETION_ACTION_TRAIL_SCHEMA>,
) {
  const trailPath = resolveTrailPath(configPath);
  await mkdir(path.dirname(trailPath), { recursive: true });
  await writeFile(trailPath, `${JSON.stringify(trail, null, 2)}\n`, "utf8");
  return trailPath;
}

function buildCompletionActionRecord(params: {
  action: SandboxCloseoutCompletionAction;
  status: SandboxCloseoutCompletionActionStatus;
  completionAuditId: string | null;
  actorSource: string;
  commandSource?: string | null;
  reason?: string | null;
  note?: string | null;
  suggestedNextAction: string;
  summaryLine: string;
}) {
  const actedAt = new Date().toISOString();
  return COMPLETION_ACTION_SCHEMA.parse({
    id: buildCompletionActionId(actedAt, params.action, params.completionAuditId),
    actedAt,
    completionAuditId: params.completionAuditId,
    latestCompletionAction: params.action,
    latestCompletionActionStatus: params.status,
    latestCompletionActionReason: params.reason ?? null,
    latestCompletionActionNote: params.note ?? null,
    reviewCompleteConfirmed:
      params.action === "confirm_review_complete" && params.status === "accepted",
    closeoutCompleteConfirmed:
      params.action === "confirm_closeout_complete" && params.status === "accepted",
    carryForwardRetained:
      params.action === "keep_carry_forward" && params.status === "accepted",
    completionReopened:
      params.action === "reopen_completion" && params.status === "accepted",
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    suggestedNextAction: params.suggestedNextAction,
    summaryLine: params.summaryLine,
  });
}

async function appendCloseoutCompletionAction(params: {
  configPath: string;
  action: SandboxCloseoutCompletionAction;
  status: SandboxCloseoutCompletionActionStatus;
  completionAuditId: string | null;
  actorSource: string;
  commandSource?: string | null;
  reason?: string | null;
  note?: string | null;
  suggestedNextAction: string;
  summaryLine: string;
}) {
  const { trail } = await loadCompletionActionTrail(params.configPath);
  const record = buildCompletionActionRecord(params);
  const nextTrail = COMPLETION_ACTION_TRAIL_SCHEMA.parse({
    updatedAt: record.actedAt,
    records: [...trail.records, record].slice(-100),
  });
  await saveCompletionActionTrail(params.configPath, nextTrail);
  return record;
}

function resolveRejectedConfirmationStatus(params: {
  state: OrchestratorState;
  carryForwardQueue: SandboxCloseoutCompletionCarryForwardQueue;
  resolutionSummary: SandboxCloseoutCompletionResolutionSummary;
}) {
  if (TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "")) {
    return "manual_required" satisfies SandboxCloseoutCompletionActionStatus;
  }
  if (
    params.carryForwardQueue.queueStatus !== "empty" ||
    params.carryForwardQueue.followUpOpen ||
    params.resolutionSummary.followUpRemainsOpen
  ) {
    return "blocked" satisfies SandboxCloseoutCompletionActionStatus;
  }
  return "rejected" satisfies SandboxCloseoutCompletionActionStatus;
}

function hasPriorComplete(history: SandboxCloseoutCompletionHistory) {
  return history.entries.some((entry) => COMPLETE_STATUSES.has(entry.completionStatus));
}

function resolveNextActionForCompletionAction(params: {
  action: SandboxCloseoutCompletionAction;
  status: SandboxCloseoutCompletionActionStatus;
  resolutionSummary: SandboxCloseoutCompletionResolutionSummary;
  carryForwardQueue: SandboxCloseoutCompletionCarryForwardQueue;
}) {
  if (params.status !== "accepted") {
    return params.carryForwardQueue.recommendedNextOperatorStep;
  }
  if (params.action === "confirm_closeout_complete") {
    return "completion_complete";
  }
  if (params.action === "confirm_review_complete") {
    return params.resolutionSummary.latestCloseoutCompleteStatus
      ? "sandbox:closeout:completion:confirm-closeout"
      : params.carryForwardQueue.recommendedNextOperatorStep;
  }
  return params.carryForwardQueue.recommendedNextOperatorStep;
}

export async function listSandboxCloseoutCompletionActions(params: {
  configPath: string;
  limit?: number;
}) {
  const { trailPath, trail } = await loadCompletionActionTrail(params.configPath);
  const limit = Math.max(1, params.limit ?? 20);
  return {
    trailPath,
    records: trail.records.slice(-limit).reverse() as SandboxCloseoutCompletionActionRecord[],
  };
}

export async function runSandboxCloseoutCompletionAction(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  action: SandboxCloseoutCompletionAction;
  actorSource: string;
  commandSource?: string | null;
  reason?: string | null;
  note?: string | null;
  completionAuditId?: string | null;
  limit?: number;
}) {
  const limit = Math.max(5, params.limit ?? 10);
  const closeoutCompletionHistory = await buildSandboxCloseoutCompletionHistory({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit,
  });
  const closeoutCompletionResolutionSummary =
    await buildSandboxCloseoutCompletionResolutionSummary({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionHistory,
    });
  const closeoutCompletionCarryForwardQueue =
    await buildSandboxCloseoutCompletionCarryForwardQueue({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      limit,
      closeoutCompletionHistory,
      closeoutCompletionResolutionSummary,
    });
  const completionAuditId =
    params.completionAuditId ??
    (await listSandboxCloseoutCompletionAudits({
      configPath: params.configPath,
      limit: 1,
    })).records[0]?.id ??
    null;

  if (!completionAuditId) {
    const record = await appendCloseoutCompletionAction({
      configPath: params.configPath,
      action: params.action,
      status: "rejected",
      completionAuditId: null,
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? null,
      reason: params.reason ?? "sandbox_closeout_completion_audit_missing",
      note: params.note ?? null,
      suggestedNextAction: "sandbox:closeout:completion:audit",
      summaryLine: `Closeout completion action '${params.action}' rejected because no closeout completion audit entry was available.`,
    });
    return {
      action: params.action,
      status: record.latestCompletionActionStatus,
      completionAuditId: null,
      summary: record.summaryLine,
      failureReason: "sandbox_closeout_completion_audit_missing",
      suggestedNextAction: record.suggestedNextAction,
      completionAction: record,
    } satisfies SandboxCloseoutCompletionActionResult;
  }

  let status: SandboxCloseoutCompletionActionStatus = "accepted";
  let failureReason: string | null = null;

  if (params.action === "confirm_review_complete") {
    if (
      !closeoutCompletionResolutionSummary.latestReviewCompleteStatus ||
      TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "")
    ) {
      status = resolveRejectedConfirmationStatus({
        state: params.state,
        carryForwardQueue: closeoutCompletionCarryForwardQueue,
        resolutionSummary: closeoutCompletionResolutionSummary,
      });
      failureReason = "sandbox_review_complete_not_ready";
    }
  } else if (params.action === "confirm_closeout_complete") {
    if (
      !closeoutCompletionResolutionSummary.latestCloseoutCompleteStatus ||
      !closeoutCompletionResolutionSummary.caseCanBeTreatedAsFullyCompleted ||
      closeoutCompletionCarryForwardQueue.queueStatus !== "empty" ||
      TERMINAL_SEVERITIES.has(params.state.lastIncidentSeverity ?? "")
    ) {
      status = resolveRejectedConfirmationStatus({
        state: params.state,
        carryForwardQueue: closeoutCompletionCarryForwardQueue,
        resolutionSummary: closeoutCompletionResolutionSummary,
      });
      failureReason = "sandbox_closeout_complete_not_ready";
    }
  } else if (params.action === "keep_carry_forward") {
    if (
      closeoutCompletionCarryForwardQueue.queueStatus === "empty" &&
      closeoutCompletionResolutionSummary.caseCanBeTreatedAsFullyCompleted
    ) {
      status = "rejected";
      failureReason = "sandbox_carry_forward_not_required";
    }
  } else if (params.action === "reopen_completion") {
    if (
      !closeoutCompletionResolutionSummary.latestReviewCompleteStatus &&
      !closeoutCompletionResolutionSummary.latestCloseoutCompleteStatus &&
      !closeoutCompletionResolutionSummary.completionThreadSettled &&
      !hasPriorComplete(closeoutCompletionHistory)
    ) {
      status = "rejected";
      failureReason = "sandbox_completion_not_reopenable";
    }
  }

  const suggestedNextAction = resolveNextActionForCompletionAction({
    action: params.action,
    status,
    resolutionSummary: closeoutCompletionResolutionSummary,
    carryForwardQueue: closeoutCompletionCarryForwardQueue,
  });
  const summaryLine =
    status === "accepted"
      ? `Closeout completion action '${params.action}' accepted for completion audit '${completionAuditId}'.`
      : `Closeout completion action '${params.action}' ${status} for completion audit '${completionAuditId}'.`;
  const record = await appendCloseoutCompletionAction({
    configPath: params.configPath,
    action: params.action,
    status,
    completionAuditId,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    reason:
      params.reason ??
      failureReason ??
      (params.action === "confirm_review_complete"
        ? "review_complete_confirmed"
        : params.action === "confirm_closeout_complete"
          ? "closeout_complete_confirmed"
          : params.action === "keep_carry_forward"
            ? "carry_forward_retained"
            : "completion_reopened"),
    note: params.note ?? null,
    suggestedNextAction,
    summaryLine,
  });

  return {
    action: params.action,
    status,
    completionAuditId,
    summary: summaryLine,
    failureReason,
    suggestedNextAction,
    completionAction: record,
  } satisfies SandboxCloseoutCompletionActionResult;
}

export function formatSandboxCloseoutCompletionActionResult(
  result: SandboxCloseoutCompletionActionResult,
) {
  return [
    `Sandbox closeout completion action: ${result.action}`,
    `Status: ${result.status}`,
    `Completion audit: ${result.completionAuditId ?? "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
  ].join("\n");
}

export function formatSandboxCloseoutCompletionActions(params: {
  records: SandboxCloseoutCompletionActionRecord[];
}) {
  return [
    "Sandbox closeout completion actions",
    ...(params.records.length === 0
      ? ["No closeout completion actions have been recorded yet."]
      : params.records.map(
          (record) =>
            `- ${record.actedAt} ${record.latestCompletionAction}/${record.latestCompletionActionStatus} completionAudit=${record.completionAuditId ?? "none"} reason=${record.latestCompletionActionReason ?? "none"} note=${record.latestCompletionActionNote ?? "none"} :: ${record.summaryLine}`,
        )),
  ].join("\n");
}
