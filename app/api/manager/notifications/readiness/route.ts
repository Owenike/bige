import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { getManagerNotificationReadiness } from "../../../../../lib/manager-notifications";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.overview.read");
  if (!permission.ok) return permission.response;

  const channelParam = new URL(request.url).searchParams.get("channel");
  const channel =
    channelParam === "email" || channelParam === "line" || channelParam === "sms" || channelParam === "webhook"
      ? channelParam
      : "email";

  const result = await getManagerNotificationReadiness({
    supabase: auth.supabase,
    context: auth.context,
    channel,
  });
  if (!result.ok) return apiError(500, "INTERNAL_ERROR", result.error);

  return apiSuccess({
    readiness: result.readiness,
  });
}
