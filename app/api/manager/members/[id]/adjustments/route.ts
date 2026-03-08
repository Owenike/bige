import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { requirePermission } from "../../../../../../lib/permissions";

function isMissingTableError(message: string | undefined, table: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = table.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target))
  );
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "member_plans.read");
  if (!permission.ok) return permission.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const { id } = await context.params;
  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (!memberResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");
  if (auth.context.branchId && memberResult.data.store_id && auth.context.branchId !== memberResult.data.store_id) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Member is outside branch scope");
  }

  const ledgerResult = await auth.supabase
    .from("member_plan_ledger")
    .select(
      "id, contract_id, source_type, delta_uses, delta_sessions, balance_uses, balance_sessions, reference_type, reference_id, reason, payload, created_by, created_at",
    )
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (ledgerResult.error && !isMissingTableError(ledgerResult.error.message, "member_plan_ledger")) {
    return apiError(500, "INTERNAL_ERROR", ledgerResult.error.message);
  }

  return apiSuccess({
    items: (ledgerResult.data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id || ""),
      contractId: row.contract_id ? String(row.contract_id) : null,
      sourceType: typeof row.source_type === "string" ? row.source_type : null,
      deltaUses: typeof row.delta_uses === "number" ? row.delta_uses : 0,
      deltaSessions: typeof row.delta_sessions === "number" ? row.delta_sessions : 0,
      balanceUses: typeof row.balance_uses === "number" ? row.balance_uses : null,
      balanceSessions: typeof row.balance_sessions === "number" ? row.balance_sessions : null,
      referenceType: typeof row.reference_type === "string" ? row.reference_type : null,
      referenceId: typeof row.reference_id === "string" ? row.reference_id : null,
      reason: typeof row.reason === "string" ? row.reason : null,
      payload: typeof row.payload === "object" && row.payload ? row.payload : {},
      createdBy: row.created_by ? String(row.created_by) : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
    })),
  });
}
