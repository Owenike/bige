import { apiError, apiSuccess, requireProfile } from "../../../lib/auth-context";
import { requireAnyPermission } from "../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const permission =
    auth.context.role === "frontdesk"
      ? requireAnyPermission(auth.context, ["refunds.request", "orders.void.request", "pass_adjustments.request"])
      : requireAnyPermission(auth.context, ["refunds.approve", "orders.void.approve", "pass_adjustments.approve"]);
  if (!permission.ok) return permission.response;

  if (!auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "Invalid tenant context");
  }

  const params = new URL(request.url).searchParams;
  const status = params.get("status") || "pending";
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 30)));

  let query = auth.supabase
    .from("high_risk_action_requests")
    .select("id, action, target_type, target_id, owning_department, reason, status, decision_note, requested_by, resolved_by, created_at, resolved_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") query = query.eq("status", status);
  if (auth.context.role === "frontdesk") query = query.eq("requested_by", auth.context.userId);
  if (auth.context.role !== "platform_admin" && auth.context.department) {
    query =
      auth.context.department === "general_affairs"
        ? query.or("owning_department.eq.general_affairs,owning_department.is.null")
        : query.eq("owning_department", auth.context.department);
  }

  const { data, error } = await query;
  if (error) return apiError(500, "INTERNAL_ERROR", error.message);
  return apiSuccess({ items: data ?? [] });
}
