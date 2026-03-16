import { apiError, apiSuccess, requireProfile } from "../../../../../../../lib/auth-context";
import { getManagerNotificationRemediationHistoryDetail } from "../../../../../../../lib/notification-coverage";
import { requirePermission } from "../../../../../../../lib/permissions";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.overview.read");
  if (!permission.ok) return permission.response;

  const { id } = await context.params;
  const detail = await getManagerNotificationRemediationHistoryDetail({
    supabase: auth.supabase,
    context: auth.context,
    runId: id,
  });
  if (!detail.ok) return apiError(404, "FORBIDDEN", detail.error);

  return apiSuccess({
    detail: detail.detail,
  });
}
