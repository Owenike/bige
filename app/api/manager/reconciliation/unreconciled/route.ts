import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { listUnreconciledShiftEvents } from "../../../../../lib/shift-reconciliation";

type ShiftCandidate = {
  id: string;
  branch_id: string | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
};

function resolveTenantAndBranch(params: {
  role: string;
  contextTenantId: string | null;
  contextBranchId: string | null;
  queryTenantId: string | null;
  queryBranchId: string | null;
}) {
  if (params.role === "platform_admin") {
    if (!params.queryTenantId) {
      return { ok: false as const, response: apiError(400, "FORBIDDEN", "tenantId is required") };
    }
    return {
      ok: true as const,
      tenantId: params.queryTenantId,
      branchId: params.queryBranchId,
    };
  }

  if (!params.contextTenantId) {
    return { ok: false as const, response: apiError(403, "FORBIDDEN", "Missing tenant context") };
  }
  if (params.contextBranchId && params.queryBranchId && params.contextBranchId !== params.queryBranchId) {
    return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden branch scope") };
  }

  return {
    ok: true as const,
    tenantId: params.contextTenantId,
    branchId: params.contextBranchId || params.queryBranchId,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const scope = resolveTenantAndBranch({
    role: auth.context.role,
    contextTenantId: auth.context.tenantId,
    contextBranchId: auth.context.branchId,
    queryTenantId: params.get("tenantId"),
    queryBranchId: params.get("branchId"),
  });
  if (!scope.ok) return scope.response;

  const limit = Math.min(200, Math.max(1, Number(params.get("limit") || 100)));
  const from = params.get("from");
  const to = params.get("to");

  const unreconciled = await listUnreconciledShiftEvents({
    supabase: auth.supabase,
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    from,
    to,
    limit,
  });
  if (!unreconciled.ok) return apiError(500, "INTERNAL_ERROR", unreconciled.error);

  let shiftsQuery = auth.supabase
    .from("frontdesk_shifts")
    .select("id, branch_id, status, opened_at, closed_at")
    .eq("tenant_id", scope.tenantId)
    .order("opened_at", { ascending: false })
    .limit(50);
  if (scope.branchId) {
    shiftsQuery = shiftsQuery.eq("branch_id", scope.branchId);
  }
  const shiftsResult = await shiftsQuery;
  if (shiftsResult.error) return apiError(500, "INTERNAL_ERROR", shiftsResult.error.message);

  const items = unreconciled.items;
  const byEventType = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.eventType] = (acc[item.eventType] || 0) + 1;
    return acc;
  }, {});

  return apiSuccess({
    tenantId: scope.tenantId,
    branchId: scope.branchId || null,
    summary: {
      total: items.length,
      byEventType,
    },
    items,
    candidateShifts: ((shiftsResult.data || []) as ShiftCandidate[]).map((row) => ({
      id: row.id,
      branchId: row.branch_id ? String(row.branch_id) : null,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
    })),
  });
}
