import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { cancelManagerNotificationsBatch } from "../../../../../lib/manager-notifications";
import { requirePermission } from "../../../../../lib/permissions";

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.delivery_events.write");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const deliveryIds = Array.isArray(body?.deliveryIds)
    ? body.deliveryIds.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (deliveryIds.length === 0) {
    return apiError(400, "FORBIDDEN", "deliveryIds is required");
  }

  const result = await cancelManagerNotificationsBatch({
    supabase: auth.supabase,
    context: auth.context,
    ids: deliveryIds,
  });

  return apiSuccess({
    summary: result.summary,
  });
}
