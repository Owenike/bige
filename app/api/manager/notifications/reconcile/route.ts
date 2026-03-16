import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { reconcileManagerNotificationsBatch } from "../../../../../lib/manager-notifications";
import { requirePermission } from "../../../../../lib/permissions";

function parseProviderStatus(input: unknown) {
  return typeof input === "string" && input.trim().length > 0 ? input.trim().toLowerCase() : null;
}

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
  const providerStatus = parseProviderStatus(body?.providerStatus);
  if (deliveryIds.length === 0 || !providerStatus) {
    return apiError(400, "FORBIDDEN", "deliveryIds and providerStatus are required");
  }

  const result = await reconcileManagerNotificationsBatch({
    supabase: auth.supabase,
    context: auth.context,
    ids: deliveryIds,
    providerStatus,
  });

  return apiSuccess({
    summary: result.summary,
  });
}
