import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState } from "../schemas";
import { resolveSandboxIncidentPolicy } from "../sandbox-incident-policy";
import { runSandboxRollback } from "../sandbox-rollback";
import {
  classifySandboxRecoveryIncidents,
  type SandboxRecoveryIncident,
} from "../sandbox-incident-governance";

const operatorActionRecordSchema = z.object({
  id: z.string(),
  actedAt: z.string(),
  incidentId: z.string(),
  incidentType: z.string(),
  incidentSeverity: z.string(),
  action: z.enum(["acknowledge", "mark_resolved", "escalate", "request_review", "rerun_preview", "rerun_validate", "rerun_apply"]),
  status: z.enum(["accepted", "blocked", "rejected", "manual_required"]),
  restorePointId: z.string().nullable().default(null),
  actorSource: z.string(),
  commandSource: z.string().nullable().default(null),
  summary: z.string(),
  failureReason: z.string().nullable().default(null),
  suggestedNextAction: z.string(),
});

const operatorActionTrailSchema = z.object({
  updatedAt: z.string(),
  records: z.array(operatorActionRecordSchema).default([]),
});

export type SandboxOperatorAction =
  | "acknowledge"
  | "mark_resolved"
  | "escalate"
  | "request_review"
  | "rerun_preview"
  | "rerun_validate"
  | "rerun_apply";

export type SandboxOperatorActionStatus = "accepted" | "blocked" | "rejected" | "manual_required";
export type SandboxOperatorActionRecord = z.infer<typeof operatorActionRecordSchema>;

export type SandboxOperatorActionResult = {
  action: SandboxOperatorAction;
  status: SandboxOperatorActionStatus;
  incident: SandboxRecoveryIncident | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  auditId: string;
  rerunResult: Awaited<ReturnType<typeof runSandboxRollback>> | null;
};

function buildActionId(actedAt: string, incidentId: string, action: SandboxOperatorAction) {
  return `sandbox-operator-action:${actedAt}:${incidentId}:${action}`;
}

function resolveTrailPath(configPath: string) {
  return `${path.resolve(configPath)}.incident-actions.json`;
}

async function loadActionTrail(configPath: string) {
  const trailPath = resolveTrailPath(configPath);
  try {
    const raw = await readFile(trailPath, "utf8");
    return {
      trailPath,
      trail: operatorActionTrailSchema.parse(JSON.parse(raw)),
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return {
        trailPath,
        trail: operatorActionTrailSchema.parse({
          updatedAt: new Date(0).toISOString(),
          records: [],
        }),
      };
    }
    throw error;
  }
}

async function saveActionTrail(configPath: string, trail: z.infer<typeof operatorActionTrailSchema>) {
  const trailPath = resolveTrailPath(configPath);
  await mkdir(path.dirname(trailPath), { recursive: true });
  await writeFile(trailPath, `${JSON.stringify(trail, null, 2)}\n`, "utf8");
  return trailPath;
}

export async function listSandboxOperatorActions(params: {
  configPath: string;
  limit?: number;
}) {
  const { trailPath, trail } = await loadActionTrail(params.configPath);
  const limit = Math.max(1, params.limit ?? 20);
  return {
    trailPath,
    records: trail.records.slice(-limit).reverse(),
  };
}

async function appendSandboxOperatorAction(params: {
  configPath: string;
  incident: SandboxRecoveryIncident;
  action: SandboxOperatorAction;
  status: SandboxOperatorActionStatus;
  actorSource: string;
  commandSource?: string | null;
  summary: string;
  failureReason?: string | null;
  suggestedNextAction: string;
}) {
  const actedAt = new Date().toISOString();
  const { trail } = await loadActionTrail(params.configPath);
  const record = operatorActionRecordSchema.parse({
    id: buildActionId(actedAt, params.incident.id, params.action),
    actedAt,
    incidentId: params.incident.id,
    incidentType: params.incident.type,
    incidentSeverity: params.incident.severity,
    action: params.action,
    status: params.status,
    restorePointId: params.incident.restorePointId,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    summary: params.summary,
    failureReason: params.failureReason ?? null,
    suggestedNextAction: params.suggestedNextAction,
  });
  const nextTrail = operatorActionTrailSchema.parse({
    updatedAt: actedAt,
    records: [...trail.records, record].slice(-100),
  });
  await saveActionTrail(params.configPath, nextTrail);
  return record;
}

function actionAllowedForIncident(incident: SandboxRecoveryIncident, action: SandboxOperatorAction) {
  const policy = resolveSandboxIncidentPolicy(incident);
  switch (action) {
    case "escalate":
      return policy.requireEscalate || policy.blockedTerminalState || policy.manualRequiredTerminalState;
    case "request_review":
      return true;
    case "rerun_preview":
      return policy.allowRerunPreview && Boolean(incident.restorePointId);
    case "rerun_validate":
      return policy.allowRerunValidate && Boolean(incident.restorePointId);
    case "rerun_apply":
      return policy.allowRerunApply && Boolean(incident.restorePointId);
    default:
      return true;
  }
}

export async function runSandboxOperatorAction(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  incidentId: string;
  action: SandboxOperatorAction;
  actorSource: string;
  commandSource?: string | null;
}) {
  const incidents = await classifySandboxRecoveryIncidents({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    limit: 25,
  });
  const incident = incidents.incidents.find((item) => item.id === params.incidentId) ?? null;
  if (!incident) {
    return {
      action: params.action,
      status: "rejected",
      incident: null,
      summary: `Sandbox operator action '${params.action}' could not find incident '${params.incidentId}'.`,
      failureReason: "sandbox_incident_missing",
      suggestedNextAction: "List sandbox incidents again and choose a valid incident id before acting.",
      auditId: `sandbox-operator-action:missing:${params.incidentId}:${params.action}`,
      rerunResult: null,
    } satisfies SandboxOperatorActionResult;
  }

  if (!actionAllowedForIncident(incident, params.action)) {
    const policy = resolveSandboxIncidentPolicy(incident);
    const audit = await appendSandboxOperatorAction({
      configPath: params.configPath,
      incident,
      action: params.action,
      status:
        params.action === "escalate"
          ? "rejected"
          : policy.manualRequiredTerminalState || policy.requireRequestReview
            ? "manual_required"
            : "blocked",
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? null,
      summary: `Sandbox operator action '${params.action}' is not allowed for incident '${incident.id}'.`,
      failureReason:
        params.action === "escalate"
          ? "sandbox_escalation_not_required"
          : policy.manualRequiredTerminalState
            ? "sandbox_manual_review_required"
            : "sandbox_restore_point_missing",
      suggestedNextAction: policy.suggestedNextAction,
    });
    return {
      action: params.action,
      status: audit.status,
      incident,
      summary: audit.summary,
      failureReason: audit.failureReason,
      suggestedNextAction: audit.suggestedNextAction,
      auditId: audit.id,
      rerunResult: null,
    } satisfies SandboxOperatorActionResult;
  }

  if (params.action === "rerun_preview" || params.action === "rerun_validate" || params.action === "rerun_apply") {
    const rerunResult = await runSandboxRollback({
      configPath: params.configPath,
      state: params.state,
      loadedRegistry: params.loadedRegistry,
      restorePointId: incident.restorePointId,
      mode:
        params.action === "rerun_preview"
          ? "preview"
          : params.action === "rerun_validate"
            ? "validate"
            : "apply",
      actorSource: `sandbox-operator:${params.action}`,
      commandSource: params.commandSource ?? null,
    });
    const status: SandboxOperatorActionStatus =
      rerunResult.status === "previewed" ||
      rerunResult.status === "validated" ||
      rerunResult.status === "restored" ||
      rerunResult.status === "no_op"
        ? "accepted"
        : rerunResult.status === "blocked"
          ? "blocked"
          : rerunResult.status === "manual_required"
            ? "manual_required"
            : "rejected";
    const audit = await appendSandboxOperatorAction({
      configPath: params.configPath,
      incident,
      action: params.action,
      status,
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? null,
      summary: rerunResult.summary,
      failureReason: rerunResult.failureReason,
      suggestedNextAction: rerunResult.suggestedNextAction,
    });
    return {
      action: params.action,
      status,
      incident,
      summary: rerunResult.summary,
      failureReason: rerunResult.failureReason,
      suggestedNextAction: rerunResult.suggestedNextAction,
      auditId: audit.id,
      rerunResult,
    } satisfies SandboxOperatorActionResult;
  }

  const summary =
    params.action === "acknowledge"
      ? `Incident '${incident.id}' acknowledged.`
      : params.action === "mark_resolved"
        ? `Incident '${incident.id}' marked as resolved by operator action.`
        : params.action === "escalate"
          ? `Incident '${incident.id}' escalated for operator attention.`
          : `Incident '${incident.id}' marked for additional review.`;
  const suggestedNextAction =
    params.action === "mark_resolved"
      ? "Re-run sandbox recovery diagnostics to confirm the incident no longer appears."
      : params.action === "escalate"
        ? "Handle the escalation before any further rollback/apply attempts."
        : params.action === "request_review"
          ? "Have another operator review the governance, guardrails, or restore point state."
          : "Use request_review, escalate, or rerun a safer recovery step if the incident remains active.";
  const audit = await appendSandboxOperatorAction({
    configPath: params.configPath,
    incident,
    action: params.action,
    status: "accepted",
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    summary,
    suggestedNextAction,
  });
  return {
    action: params.action,
    status: "accepted",
    incident,
    summary,
    failureReason: null,
    suggestedNextAction,
    auditId: audit.id,
    rerunResult: null,
  } satisfies SandboxOperatorActionResult;
}

export function formatSandboxOperatorActionResult(result: SandboxOperatorActionResult) {
  return [
    `Sandbox operator action: ${result.action}`,
    `Status: ${result.status}`,
    `Incident: ${result.incident?.id ?? "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
    `Audit: ${result.auditId}`,
  ].join("\n");
}
