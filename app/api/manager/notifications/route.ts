import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { listManagerNotifications } from "../../../../lib/manager-notifications";
import { requirePermission } from "../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.overview.read");
  if (!permission.ok) return permission.response;

  const searchParams = new URL(request.url).searchParams;
  const result = await listManagerNotifications({
    supabase: auth.supabase,
    context: auth.context,
    dateFrom: searchParams.get("date_from"),
    dateTo: searchParams.get("date_to"),
    branchId: searchParams.get("branch_id"),
    channel: searchParams.get("channel"),
    eventType: searchParams.get("event_type"),
    templateKey: searchParams.get("template_key"),
    status: searchParams.get("status"),
    search: searchParams.get("search"),
    limit: Number(searchParams.get("limit") || 120),
  });
  if (!result.ok) return apiError(500, "INTERNAL_ERROR", result.error);

  return apiSuccess({
    summary: result.summary,
    recentRuns: result.recentRuns,
    items: result.items,
  });
}
