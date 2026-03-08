import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { buildRetryPlan, executeRetryPlan, validateRetryTargets } from "../../../../../lib/notification-retry-operations";
import {
  notificationChannelSchema,
  notificationEventKeySchema,
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

const retryGetQuerySchema = z.object({
  tenantId: uuidLikeSchema.nullable().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  includeRows: z.boolean().optional(),
  statuses: z.array(z.enum(["failed", "retrying", "pending", "sent", "skipped"])).optional(),
  channels: z.array(notificationChannelSchema).optional(),
  eventType: notificationEventKeySchema.optional(),
  deliveryId: uuidLikeSchema.optional(),
});

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const parsed = retryGetQuerySchema.safeParse({
    tenantId: params.get("tenantId"),
    limit: Number(params.get("limit") || 200),
    includeRows: parseBooleanQuery(params.get("includeRows"), false),
    statuses: parseCsv(params.get("statuses")),
    channels: parseCsv(params.get("channels")),
    eventType: params.get("eventType") || undefined,
    deliveryId: params.get("deliveryId") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");
  const { tenantId, limit, includeRows, statuses, channels, eventType, deliveryId } = parsed.data;
  const plan = await buildRetryPlan({
    tenantId,
    statuses,
    channels,
    eventType,
    deliveryIds: deliveryId ? [deliveryId] : undefined,
    limit,
  });
  if (!plan.ok) return apiError(500, "INTERNAL_ERROR", plan.error);
  return apiSuccess({
    tenantId: tenantId || null,
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
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = retryRequestSchema.safeParse(body || {});
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid payload");
  const tenantId = parsed.data.tenantId || null;
  const execute = parsed.data.action === "execute";
  const inputIds = parsed.data.deliveryIds || [];
  const limit = Math.min(500, Math.max(1, Number(parsed.data.limit || inputIds.length || 200)));

  let targetIds = inputIds;
  if (targetIds.length === 0) {
    const plan = await buildRetryPlan({
      tenantId,
      statuses: parsed.data.statuses,
      channels: parsed.data.channels,
      eventType: parsed.data.eventType,
      limit,
    });
    if (!plan.ok) return apiError(500, "INTERNAL_ERROR", plan.error);
    targetIds = plan.deliveryIds;
  }

  const validated = await validateRetryTargets({
    tenantId,
    deliveryIds: targetIds,
  });
  if (!validated.ok) return apiError(500, "INTERNAL_ERROR", validated.error);

  if (!execute) {
    return apiSuccess({
      mode: "dry_run",
      tenantId,
      retryableCount: validated.items.length,
      retryableIds: validated.items,
      blockedCount: validated.rejected.length,
      blocked: validated.rejected,
    });
  }

  const run = await executeRetryPlan({
    scope: "platform",
    tenantId,
    actorId: auth.context.userId,
    deliveryIds: validated.items,
    limit,
  });
  if (!run.ok) return apiError(500, "INTERNAL_ERROR", run.error);
  return apiSuccess({
    mode: "execute",
    tenantId,
    summary: run.summary,
    retriedCount: validated.items.length,
    blockedCount: validated.rejected.length,
    blocked: validated.rejected,
  });
}
