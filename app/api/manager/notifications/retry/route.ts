import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import { buildRetryPlan, executeRetryPlan, validateRetryTargets } from "../../../../../lib/notification-retry-operations";
import {
  notificationChannelSchema,
  notificationEventKeySchema,
  isManagerTenantScopeAllowed,
  parseBooleanQuery,
  retryRequestSchema,
  uuidLikeSchema,
} from "../../../../../lib/notification-productization";
import { z } from "zod";

function parseCsv(input: string | null): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const managerRetryGetQuerySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  includeRows: z.boolean().optional(),
  statuses: z.array(z.enum(["failed", "retrying", "pending", "sent", "skipped"])).optional(),
  channels: z.array(notificationChannelSchema).optional(),
  eventType: notificationEventKeySchema.optional(),
  deliveryId: uuidLikeSchema.optional(),
});

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "reports.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = managerRetryGetQuerySchema.safeParse({
    limit: Number(params.get("limit") || 200),
    includeRows: parseBooleanQuery(params.get("includeRows"), false),
    statuses: parseCsv(params.get("statuses")),
    channels: parseCsv(params.get("channels")),
    eventType: params.get("eventType") || undefined,
    deliveryId: params.get("deliveryId") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");
  const { limit = 200, includeRows, statuses, channels, eventType, deliveryId } = parsed.data;
  const plan = await buildRetryPlan({
    tenantId: auth.context.tenantId,
    statuses,
    channels,
    eventType,
    deliveryIds: deliveryId ? [deliveryId] : undefined,
    limit,
  });
  if (!plan.ok) return apiError(500, "INTERNAL_ERROR", plan.error);
  return apiSuccess({
    tenantId: auth.context.tenantId,
    summary: plan.summary,
    deliveryIds: plan.deliveryIds,
    candidates: includeRows ? plan.candidates : undefined,
    filters: {
      statuses: statuses || [],
      channels: channels || [],
      eventType: eventType || null,
      deliveryId: deliveryId || null,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "crm.assign");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const parsed = retryRequestSchema.safeParse(body || {});
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid payload");
  const execute = parsed.data.action === "execute";
  const tenantIdFromBody = parsed.data.tenantId || null;
  if (!isManagerTenantScopeAllowed(auth.context.tenantId, tenantIdFromBody)) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "tenantId mismatch");
  }
  let inputIds = parsed.data.deliveryIds || [];
  const limit = Math.min(500, Math.max(1, Number(parsed.data.limit || inputIds.length || 200)));

  if (inputIds.length === 0) {
    const plan = await buildRetryPlan({
      tenantId: auth.context.tenantId,
      statuses: parsed.data.statuses,
      channels: parsed.data.channels,
      eventType: parsed.data.eventType,
      limit,
    });
    if (!plan.ok) return apiError(500, "INTERNAL_ERROR", plan.error);
    inputIds = plan.deliveryIds;
  }

  const validated = await validateRetryTargets({
    tenantId: auth.context.tenantId,
    deliveryIds: inputIds,
  });
  if (!validated.ok) return apiError(500, "INTERNAL_ERROR", validated.error);

  if (!execute) {
    return apiSuccess({
      mode: "dry_run",
      tenantId: auth.context.tenantId,
      retryableCount: validated.items.length,
      retryableIds: validated.items,
      blockedCount: validated.rejected.length,
      blocked: validated.rejected,
    });
  }

  const run = await executeRetryPlan({
    scope: "tenant",
    tenantId: auth.context.tenantId,
    actorId: auth.context.userId,
    deliveryIds: validated.items,
    limit,
  });
  if (!run.ok) return apiError(500, "INTERNAL_ERROR", run.error);
  return apiSuccess({
    mode: "execute",
    tenantId: auth.context.tenantId,
    summary: run.summary,
    retriedCount: validated.items.length,
    blockedCount: validated.rejected.length,
    blocked: validated.rejected,
  });
}
