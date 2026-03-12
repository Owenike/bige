import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { getNotificationDeliveryAnalytics } from "../../../../../lib/notification-delivery-analytics";
import { requirePermission } from "../../../../../lib/permissions";
import { uuidLikeSchema } from "../../../../../lib/notification-productization";

const querySchema = z.object({
  tenantId: uuidLikeSchema.optional(),
  from: z.string().trim().datetime().optional(),
  to: z.string().trim().datetime().optional(),
  limit: z.coerce.number().int().min(200).max(50000).optional(),
});

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "notifications.analytics.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    tenantId: params.get("tenantId") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    limit: params.get("limit") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");

  const snapshot = await getNotificationDeliveryAnalytics({
    tenantId: parsed.data.tenantId || null,
    from: parsed.data.from || null,
    to: parsed.data.to || null,
    limit: parsed.data.limit || 10000,
  });
  if (!snapshot.ok) return apiError(500, "INTERNAL_ERROR", snapshot.error);

  return apiSuccess({
    snapshot: snapshot.snapshot,
  });
}
