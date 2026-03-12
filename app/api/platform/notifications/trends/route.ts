import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { getNotificationAlertTrendComparison } from "../../../../../lib/notification-alert-trends";
import { requirePermission } from "../../../../../lib/permissions";
import { uuidLikeSchema } from "../../../../../lib/notification-productization";

const channelSchema = z.enum(["in_app", "email", "line", "sms", "webhook", "other"]);

const querySchema = z.object({
  tenantId: uuidLikeSchema.optional(),
  channel: channelSchema.optional(),
  from: z.string().trim().datetime().optional(),
  to: z.string().trim().datetime().optional(),
  limit: z.coerce.number().int().min(200).max(80000).optional(),
  topLimit: z.coerce.number().int().min(3).max(30).optional(),
  aggregationMode: z.enum(["auto", "raw", "rollup"]).optional(),
});

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "notifications.trends.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    tenantId: params.get("tenantId") || undefined,
    channel: params.get("channel") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    limit: params.get("limit") || undefined,
    topLimit: params.get("topLimit") || undefined,
    aggregationMode: params.get("aggregationMode") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");

  const compared = await getNotificationAlertTrendComparison({
    tenantId: parsed.data.tenantId || null,
    channel: parsed.data.channel || null,
    from: parsed.data.from || null,
    to: parsed.data.to || null,
    limit: parsed.data.limit || 12000,
    topLimit: parsed.data.topLimit || 10,
    aggregationMode: parsed.data.aggregationMode || "auto",
  });
  if (!compared.ok) return apiError(500, "INTERNAL_ERROR", compared.error);

  return apiSuccess({
    snapshot: compared.snapshot,
  });
}
