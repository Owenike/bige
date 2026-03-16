import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { getManagerNotificationDetail } from "../../../../../lib/manager-notifications";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.overview.read");
  if (!permission.ok) return permission.response;

  const params = await context.params;
  const result = await getManagerNotificationDetail({
    supabase: auth.supabase,
    context: auth.context,
    id: params.id,
  });
  if (!result.ok) return apiError(404, "FORBIDDEN", result.error);

  return apiSuccess({
    detail: result.detail,
  });
}
