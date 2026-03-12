import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import {
  listNotificationAlerts,
  upsertNotificationAlertFromAnomaly,
  updateNotificationAlert,
} from "../../../../../lib/notification-alert-workflow";
import { requirePermission } from "../../../../../lib/permissions";
import { uuidLikeSchema } from "../../../../../lib/notification-productization";

const statusSchema = z.enum(["open", "acknowledged", "investigating", "resolved", "dismissed"]);
const prioritySchema = z.enum(["P1", "P2", "P3", "P4"]);
const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const anomalyTypeSchema = z.enum(["tenant_priority", "reason_cluster", "delivery_error", "manual"]);

const querySchema = z.object({
  tenantId: uuidLikeSchema.optional(),
  statuses: z.array(statusSchema).optional(),
  priorities: z.array(prioritySchema).optional(),
  severities: z.array(severitySchema).optional(),
  from: z.string().trim().datetime().optional(),
  to: z.string().trim().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const upsertBodySchema = z.object({
  action: z.literal("upsert_from_anomaly"),
  tenantId: uuidLikeSchema,
  anomalyKey: z.string().trim().min(1).max(240),
  anomalyType: anomalyTypeSchema,
  priority: prioritySchema,
  severity: severitySchema,
  summary: z.string().trim().min(1).max(1000),
  ownerUserId: uuidLikeSchema.optional().nullable(),
  assigneeUserId: uuidLikeSchema.optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable(),
  sourceData: z.record(z.string(), z.unknown()).optional(),
});

const updateBodySchema = z.object({
  action: z.literal("update_alert"),
  id: uuidLikeSchema,
  status: statusSchema.optional(),
  summary: z.string().trim().max(1000).optional(),
  ownerUserId: uuidLikeSchema.optional().nullable(),
  assigneeUserId: uuidLikeSchema.optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable(),
  resolutionNote: z.string().trim().max(4000).optional().nullable(),
  sourceDataPatch: z.record(z.string(), z.unknown()).optional(),
});

const putBodySchema = z.discriminatedUnion("action", [upsertBodySchema, updateBodySchema]);

function parseCsvParam(input: string | null) {
  if (!input) return [];
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "notifications.alerts.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    tenantId: params.get("tenantId") || undefined,
    statuses: parseCsvParam(params.get("statuses")),
    priorities: parseCsvParam(params.get("priorities")),
    severities: parseCsvParam(params.get("severities")),
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    limit: params.get("limit") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");

  const listed = await listNotificationAlerts({
    tenantId: parsed.data.tenantId || null,
    statuses: parsed.data.statuses || [],
    priorities: parsed.data.priorities || [],
    severities: parsed.data.severities || [],
    from: parsed.data.from || null,
    to: parsed.data.to || null,
    limit: parsed.data.limit || 120,
  });
  if (!listed.ok) return apiError(500, "INTERNAL_ERROR", listed.error);

  return apiSuccess({
    count: listed.items.length,
    items: listed.items,
  });
}

export async function PUT(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "notifications.alerts.write");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const parsed = putBodySchema.safeParse(body || {});
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid payload");

  if (parsed.data.action === "upsert_from_anomaly") {
    const upserted = await upsertNotificationAlertFromAnomaly({
      tenantId: parsed.data.tenantId,
      anomalyKey: parsed.data.anomalyKey,
      anomalyType: parsed.data.anomalyType,
      priority: parsed.data.priority,
      severity: parsed.data.severity,
      summary: parsed.data.summary,
      ownerUserId: parsed.data.ownerUserId || null,
      assigneeUserId: parsed.data.assigneeUserId || null,
      note: parsed.data.note || null,
      sourceData: parsed.data.sourceData || {},
      actorId: auth.context.userId,
    });
    if (!upserted.ok) return apiError(500, "INTERNAL_ERROR", upserted.error);

    return apiSuccess({
      item: upserted.item,
      before: upserted.before,
      diffSummary: upserted.diffSummary,
      created: upserted.created,
    });
  }

  const updated = await updateNotificationAlert({
    id: parsed.data.id,
    status: parsed.data.status,
    summary: parsed.data.summary,
    ownerUserId: parsed.data.ownerUserId,
    assigneeUserId: parsed.data.assigneeUserId,
    note: parsed.data.note,
    resolutionNote: parsed.data.resolutionNote,
    sourceDataPatch: parsed.data.sourceDataPatch,
    actorId: auth.context.userId,
  });
  if (!updated.ok) {
    const message = updated.error || "Update alert failed";
    if (message.toLowerCase().includes("invalid status transition")) {
      return apiError(409, "FORBIDDEN", message);
    }
    return apiError(500, "INTERNAL_ERROR", message);
  }

  return apiSuccess({
    item: updated.item,
    before: updated.before,
    diffSummary: updated.diffSummary,
    transition: updated.transition,
  });
}
