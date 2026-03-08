import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../../../lib/auth-context";
import { findOpenShiftForBranch, getShiftReconciliation, insertShiftItem } from "../../../../../lib/shift-reconciliation";

type ShiftRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  status: string;
  opening_cash: number | string | null;
};

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : Number.NaN;
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const direction = body?.direction === "outflow" ? "outflow" : "inflow";
  const amount = toNumber(body?.amount);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const inputShiftId = typeof body?.shiftId === "string" ? body.shiftId.trim() : "";
  const inputTenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";

  if (Number.isNaN(amount) || amount <= 0) return apiError(400, "FORBIDDEN", "amount must be positive");
  if (!reason) return apiError(400, "FORBIDDEN", "reason is required");

  let tenantId = "";
  let shiftId = "";
  if (auth.context.role === "platform_admin") {
    tenantId = inputTenantId;
    shiftId = inputShiftId;
    if (!tenantId || !shiftId) {
      return apiError(400, "FORBIDDEN", "tenantId and shiftId are required for platform_admin");
    }
  } else if (auth.context.role === "frontdesk") {
    if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");
    const guard = await requireOpenShift({
      supabase: auth.supabase,
      context: auth.context,
      enforceRoles: ["frontdesk"],
    });
    if (!guard.ok) return guard.response;
    tenantId = auth.context.tenantId;
    shiftId = String(guard.shift?.id || "");
  } else {
    if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");
    tenantId = auth.context.tenantId;
    if (inputShiftId) {
      shiftId = inputShiftId;
    } else if (auth.context.branchId) {
      const openShift = await findOpenShiftForBranch({
        supabase: auth.supabase,
        tenantId,
        branchId: auth.context.branchId,
      });
      if (!openShift.ok) return apiError(500, "INTERNAL_ERROR", openShift.error);
      shiftId = openShift.shiftId || "";
    }
    if (!shiftId) return apiError(409, "FORBIDDEN", "Open shift is required");
  }

  const shiftResult = await auth.supabase
    .from("frontdesk_shifts")
    .select("id, tenant_id, branch_id, status, opening_cash")
    .eq("tenant_id", tenantId)
    .eq("id", shiftId)
    .maybeSingle();
  if (shiftResult.error) return apiError(500, "INTERNAL_ERROR", shiftResult.error.message);
  const shift = (shiftResult.data || null) as ShiftRow | null;
  if (!shift) return apiError(404, "FORBIDDEN", "Shift not found");
  if (shift.status !== "open") return apiError(409, "FORBIDDEN", "Shift must be open");

  if (auth.context.role !== "platform_admin" && auth.context.branchId && shift.branch_id && auth.context.branchId !== String(shift.branch_id)) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden branch scope");
  }

  const signedAmount = direction === "inflow" ? amount : -Math.abs(amount);
  const itemInsert = await insertShiftItem({
    supabase: auth.supabase,
    tenantId,
    shiftId,
    kind: "adjustment",
    refId: shiftId,
    amount: signedAmount,
    summary: `cash_adjustment:${direction}:${reason}`,
    eventType: "cash_adjustment",
    paymentMethod: "cash",
    metadata: {
      direction,
      reason,
      note: note || null,
      requestedByRole: auth.context.role,
    },
  });
  if (!itemInsert.ok) return apiError(500, "INTERNAL_ERROR", itemInsert.error || "Failed to insert shift item");

  await auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: auth.context.userId,
    action: "shift_cash_adjusted",
    target_type: "frontdesk_shift",
    target_id: shiftId,
    reason,
    payload: {
      direction,
      amount,
      signedAmount,
      note: note || null,
    },
  }).catch(() => null);

  const reconciliation = await getShiftReconciliation({
    supabase: auth.supabase,
    tenantId,
    shiftId,
    openingCash: toNumber(shift.opening_cash),
  });
  if (!reconciliation.ok) return apiError(500, "INTERNAL_ERROR", reconciliation.error);

  return apiSuccess({
    adjustment: {
      shiftId,
      direction,
      amount,
      signedAmount,
      reason,
      note: note || null,
      createdBy: auth.context.userId,
      createdAt: new Date().toISOString(),
    },
    reconciliation: {
      expectedCash: reconciliation.expectedCash,
      summary: reconciliation.summary,
    },
  });
}
