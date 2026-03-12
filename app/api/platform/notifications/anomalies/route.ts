import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { getNotificationAnomalyInsights } from "../../../../../lib/notification-anomaly-insights";
import { requirePermission } from "../../../../../lib/permissions";
import { uuidLikeSchema } from "../../../../../lib/notification-productization";

const channelSchema = z.enum(["in_app", "email", "line", "sms", "webhook", "other"]);

const querySchema = z.object({
  tenantId: uuidLikeSchema.optional(),
  channel: channelSchema.optional(),
  from: z.string().trim().datetime().optional(),
  to: z.string().trim().datetime().optional(),
  limit: z.coerce.number().int().min(200).max(60000).optional(),
  topReasonLimit: z.coerce.number().int().min(5).max(30).optional(),
  topTenantLimit: z.coerce.number().int().min(5).max(50).optional(),
});

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "notifications.anomalies.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    tenantId: params.get("tenantId") || undefined,
    channel: params.get("channel") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    limit: params.get("limit") || undefined,
    topReasonLimit: params.get("topReasonLimit") || undefined,
    topTenantLimit: params.get("topTenantLimit") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");

  const insights = await getNotificationAnomalyInsights({
    tenantId: parsed.data.tenantId || null,
    channel: parsed.data.channel || null,
    from: parsed.data.from || null,
    to: parsed.data.to || null,
    limit: parsed.data.limit || 12000,
    topReasonLimit: parsed.data.topReasonLimit || 12,
    topTenantLimit: parsed.data.topTenantLimit || 15,
  });
  if (!insights.ok) return apiError(500, "INTERNAL_ERROR", insights.error);

  return apiSuccess({
    snapshot: insights.snapshot,
  });
}
