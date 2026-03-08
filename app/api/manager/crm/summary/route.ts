import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";

type LeadSummaryRow = {
  id: string;
  source: string;
  status: string;
  owner_staff_id: string | null;
  created_by: string | null;
  trial_status: string | null;
  created_at: string;
  updated_at: string;
  next_action_at: string | null;
  last_followed_up_at: string | null;
};

function toIsoRange(from: string | null, to: string | null) {
  const now = new Date();
  const defaultDate = now.toISOString().slice(0, 10);
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : defaultDate;
  const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : defaultDate;
  return {
    from: `${f}T00:00:00.000Z`,
    to: `${t}T23:59:59.999Z`,
    dateFrom: f,
    dateTo: t,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "sales"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId && auth.context.role !== "platform_admin") {
    return apiError(400, "FORBIDDEN", "Missing tenant scope");
  }

  const permission = requirePermission(auth.context, "crm.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const tenantId = auth.context.role === "platform_admin"
    ? (params.get("tenantId") || auth.context.tenantId)
    : auth.context.tenantId;
  if (!tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const range = toIsoRange(params.get("from"), params.get("to"));
  let query = auth.supabase
    .from("crm_leads")
    .select("id, source, status, owner_staff_id, created_by, trial_status, created_at, updated_at, next_action_at, last_followed_up_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", range.from)
    .lte("created_at", range.to)
    .limit(5000);

  if (auth.context.role === "sales") {
    query = query.or(`owner_staff_id.eq.${auth.context.userId},created_by.eq.${auth.context.userId}`);
  } else if (
    auth.context.branchId &&
    auth.context.role !== "platform_admin" &&
    auth.context.role !== "manager"
  ) {
    query = query.eq("branch_id", auth.context.branchId);
  }

  const result = await query;
  if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);

  const rows = (result.data || []) as LeadSummaryRow[];
  const nowMs = Date.now();
  const staleThresholdMs = 72 * 60 * 60 * 1000;

  const summary = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + 1;
      acc.bySource[row.source] = (acc.bySource[row.source] || 0) + 1;
      const ownerKey = row.owner_staff_id || "unassigned";
      acc.byOwner[ownerKey] = (acc.byOwner[ownerKey] || 0) + 1;
      if (row.status === "new") acc.newCount += 1;
      if (row.status === "trial_booked" || row.trial_status === "scheduled" || row.trial_status === "rescheduled") acc.trialBooked += 1;
      if (row.trial_status === "attended" || row.status === "trial_completed") acc.trialAttended += 1;
      if (row.status === "won") acc.won += 1;
      if (row.status === "lost") acc.lost += 1;

      const touchTs = new Date(row.last_followed_up_at || row.updated_at).getTime();
      if (Number.isFinite(touchTs) && nowMs - touchTs >= staleThresholdMs && row.status !== "won" && row.status !== "lost") {
        acc.staleFollowups += 1;
      }
      if (row.next_action_at) {
        const actionTs = new Date(row.next_action_at).getTime();
        if (Number.isFinite(actionTs) && actionTs >= nowMs) acc.pendingNextActions += 1;
      }
      return acc;
    },
    {
      total: 0,
      newCount: 0,
      trialBooked: 0,
      trialAttended: 0,
      won: 0,
      lost: 0,
      staleFollowups: 0,
      pendingNextActions: 0,
      byStatus: {} as Record<string, number>,
      bySource: {} as Record<string, number>,
      byOwner: {} as Record<string, number>,
    },
  );

  return apiSuccess({
    range: { from: range.dateFrom, to: range.dateTo },
    summary,
  });
}
