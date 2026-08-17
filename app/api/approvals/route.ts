import { apiError, apiSuccess, requireProfile } from "../../../lib/auth-context";
import { isBigeContractRiskRequester, isTenantManager } from "../../../lib/staff-organization";

type ApprovalListRow = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  owning_department: string | null;
  reason: string;
  status: string;
  decision_note: string | null;
  requested_by: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
};

type RequesterProfile = {
  id: string;
  display_name: string | null;
  employee_number: string | null;
};

export async function GET(request: Request) {
  const auth = await requireProfile(
    ["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk"],
    request,
  );
  if (!auth.ok) return auth.response;

  const canResolve = isTenantManager(auth.context);
  const canReadOwn =
    auth.context.role === "frontdesk" || isBigeContractRiskRequester(auth.context);
  if (!canResolve && !canReadOwn) {
    return apiError(403, "FORBIDDEN", "您沒有覆核事項的查看權限");
  }

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
  if (!canResolve) query = query.eq("requested_by", auth.context.userId);
  if (auth.context.role !== "platform_admin" && auth.context.department) {
    query =
      auth.context.department === "general_affairs"
        ? query.or("owning_department.eq.general_affairs,owning_department.is.null")
        : query.eq("owning_department", auth.context.department);
  }

  const { data, error } = await query;
  if (error) return apiError(500, "INTERNAL_ERROR", error.message);
  const items = (data || []) as ApprovalListRow[];
  const requesterIds = [...new Set(
    items
      .map((item) => item.requested_by)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )];
  const requesterResult = requesterIds.length
    ? await auth.supabase
        .from("profiles")
        .select("id, display_name, employee_number")
        .in("id", requesterIds)
    : { data: [], error: null };
  if (requesterResult.error) return apiError(500, "INTERNAL_ERROR", requesterResult.error.message);
  const requesterMap = new Map<string, RequesterProfile>(
    ((requesterResult.data || []) as RequesterProfile[]).map((profile) => [String(profile.id), profile]),
  );
  return apiSuccess({
    canResolve,
    items: items.map((item) => ({
      ...item,
      requester: item.requested_by ? requesterMap.get(String(item.requested_by)) || null : null,
    })),
  });
}
