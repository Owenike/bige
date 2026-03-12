import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../../../../../lib/auth-context";
import { getNotificationTenantPerformanceDrilldown } from "../../../../../../../lib/notification-overview-query";
import { requirePermission } from "../../../../../../../lib/permissions";
import { uuidLikeSchema } from "../../../../../../../lib/notification-productization";

const channelSchema = z.enum(["in_app", "email", "line", "sms", "webhook", "other"]);

const querySchema = z.object({
  channel: channelSchema.optional(),
  from: z.string().trim().datetime().optional(),
  to: z.string().trim().datetime().optional(),
  limit: z.coerce.number().int().min(200).max(50000).optional(),
  anomalyLimit: z.coerce.number().int().min(10).max(120).optional(),
  aggregationMode: z.enum(["auto", "raw", "rollup"]).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "notifications.overview.read");
  if (!permission.ok) return permission.response;

  const { tenantId: rawTenantId } = await context.params;
  const tenantIdParsed = uuidLikeSchema.safeParse(rawTenantId);
  if (!tenantIdParsed.success) return apiError(400, "FORBIDDEN", "Invalid tenantId");

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    channel: params.get("channel") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    limit: params.get("limit") || undefined,
    anomalyLimit: params.get("anomalyLimit") || undefined,
    aggregationMode: params.get("aggregationMode") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");

  const drilldown = await getNotificationTenantPerformanceDrilldown({
    tenantId: tenantIdParsed.data,
    channel: parsed.data.channel || null,
    from: parsed.data.from || null,
    to: parsed.data.to || null,
    limit: parsed.data.limit || 10000,
    anomalyLimit: parsed.data.anomalyLimit || 40,
    aggregationMode: parsed.data.aggregationMode || "auto",
  });
  if (!drilldown.ok) return apiError(500, "INTERNAL_ERROR", drilldown.error);

  return apiSuccess({
    snapshot: drilldown.snapshot,
  });
}
