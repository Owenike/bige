import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { getManagerNotificationCoverageSummary } from "../../../../../lib/notification-coverage";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.overview.read");
  if (!permission.ok) return permission.response;

  const searchParams = new URL(request.url).searchParams;
  const bucketParam = searchParams.get("bucket");
  const result = await getManagerNotificationCoverageSummary({
    supabase: auth.supabase,
    context: auth.context,
    branchId: searchParams.get("branch_id"),
    dateFrom: searchParams.get("date_from"),
    dateTo: searchParams.get("date_to"),
    bucket:
      bucketParam === "recipient_missing:email" ||
      bucketParam === "recipient_missing:line_user_id" ||
      bucketParam === "channel_disabled" ||
      bucketParam === "provider_unconfigured" ||
      bucketParam === "preference_opt_out" ||
      bucketParam === "invalid_recipient" ||
      bucketParam === "template_missing" ||
      bucketParam === "other"
        ? bucketParam
        : null,
  });
  if (!result.ok) return apiError(500, "INTERNAL_ERROR", result.error);

  return apiSuccess({
    summary: result.summary,
  });
}
