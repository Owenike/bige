import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { retryManagerNotification } from "../../../../../../lib/manager-notifications";
import { requirePermission } from "../../../../../../lib/permissions";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.delivery_events.write");
  if (!permission.ok) return permission.response;

  const params = await context.params;
  const result = await retryManagerNotification({
    supabase: auth.supabase,
    context: auth.context,
    id: params.id,
  });
  if (!result.ok) return apiError(400, "FORBIDDEN", result.error);

  return apiSuccess({
    summary: result.summary,
  });
}
