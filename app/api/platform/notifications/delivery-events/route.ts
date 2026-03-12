import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import {
  ingestNotificationDeliveryEvent,
  listNotificationDeliveryEvents,
} from "../../../../../lib/notification-delivery-events";
import { requirePermission } from "../../../../../lib/permissions";
import { uuidLikeSchema } from "../../../../../lib/notification-productization";

const eventTypeSchema = z.enum(["delivered", "failed", "opened", "clicked", "conversion"]);
const deliveryStatusSchema = z.enum(["pending", "retrying", "sent", "failed", "skipped", "dead_letter"]);
const channelSchema = z.enum(["in_app", "email", "line", "sms", "webhook", "other"]);

const getQuerySchema = z.object({
  tenantId: uuidLikeSchema.optional(),
  deliveryId: uuidLikeSchema.optional(),
  channel: channelSchema.optional(),
  eventTypes: z.array(eventTypeSchema).optional(),
  from: z.string().trim().datetime().optional(),
  to: z.string().trim().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

const postBodySchema = z.object({
  deliveryId: uuidLikeSchema,
  eventType: eventTypeSchema,
  eventAt: z.string().trim().datetime().optional(),
  provider: z.string().trim().max(120).optional().nullable(),
  providerEventId: z.string().trim().max(200).optional().nullable(),
  providerMessageId: z.string().trim().max(200).optional().nullable(),
  channel: channelSchema.optional().nullable(),
  statusAfter: deliveryStatusSchema.optional().nullable(),
  markDeadLetter: z.boolean().optional(),
  errorCode: z.string().trim().max(120).optional().nullable(),
  errorMessage: z.string().trim().max(2000).optional().nullable(),
  providerResponse: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  applyStatusUpdate: z.boolean().optional(),
});

function parseCsvParam(input: string | null) {
  if (!input) return [];
  return input.split(",").map((item) => item.trim()).filter(Boolean);
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "notifications.delivery_events.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = getQuerySchema.safeParse({
    tenantId: params.get("tenantId") || undefined,
    deliveryId: params.get("deliveryId") || undefined,
    channel: params.get("channel") || undefined,
    eventTypes: parseCsvParam(params.get("eventTypes")),
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    limit: params.get("limit") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");

  const listed = await listNotificationDeliveryEvents({
    tenantId: parsed.data.tenantId || null,
    deliveryId: parsed.data.deliveryId || null,
    channel: parsed.data.channel || null,
    eventTypes: parsed.data.eventTypes || [],
    from: parsed.data.from || null,
    to: parsed.data.to || null,
    limit: parsed.data.limit || 200,
  });
  if (!listed.ok) return apiError(500, "INTERNAL_ERROR", listed.error);

  return apiSuccess({
    tenantId: parsed.data.tenantId || null,
    deliveryId: parsed.data.deliveryId || null,
    count: listed.items.length,
    items: listed.items,
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "notifications.delivery_events.write");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const parsed = postBodySchema.safeParse(body || {});
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid payload");

  const ingested = await ingestNotificationDeliveryEvent({
    deliveryId: parsed.data.deliveryId,
    eventType: parsed.data.eventType,
    eventAt: parsed.data.eventAt || null,
    provider: parsed.data.provider || null,
    providerEventId: parsed.data.providerEventId || null,
    providerMessageId: parsed.data.providerMessageId || null,
    channel: parsed.data.channel || null,
    statusAfter: parsed.data.statusAfter || null,
    markDeadLetter: parsed.data.markDeadLetter || false,
    errorCode: parsed.data.errorCode || null,
    errorMessage: parsed.data.errorMessage || null,
    providerResponse: parsed.data.providerResponse || null,
    metadata: parsed.data.metadata || {},
    actorId: auth.context.userId,
    applyStatusUpdate: parsed.data.applyStatusUpdate !== false,
  });
  if (!ingested.ok) return apiError(500, "INTERNAL_ERROR", ingested.error);

  return apiSuccess({
    item: ingested.item,
    deduped: ingested.deduped || false,
  });
}
