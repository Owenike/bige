import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { claimIdempotency, finalizeIdempotency } from "../../../../../lib/idempotency";
import { attachUnreconciledEventToShift, getShiftReconciliation } from "../../../../../lib/shift-reconciliation";

type ShiftRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  opening_cash: number | string | null;
  status: string;
};

function toNumber(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const shiftId = typeof body?.shiftId === "string" ? body.shiftId.trim() : "";
  const auditId = typeof body?.auditId === "string" ? body.auditId.trim() : "";
  const tenantIdInput = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  if (!shiftId || !auditId) return apiError(400, "FORBIDDEN", "shiftId and auditId are required");

  const tenantId =
    auth.context.role === "platform_admin"
      ? tenantIdInput
      : (auth.context.tenantId || "");
  if (!tenantId) return apiError(400, "FORBIDDEN", "tenantId is required");

  const shiftResult = await auth.supabase
    .from("frontdesk_shifts")
    .select("id, tenant_id, branch_id, opening_cash, status")
    .eq("tenant_id", tenantId)
    .eq("id", shiftId)
    .maybeSingle();
  if (shiftResult.error) return apiError(500, "INTERNAL_ERROR", shiftResult.error.message);
  const shift = (shiftResult.data || null) as ShiftRow | null;
  if (!shift) return apiError(404, "FORBIDDEN", "Shift not found");

  if (auth.context.role !== "platform_admin") {
    if (!auth.context.tenantId || auth.context.tenantId !== shift.tenant_id) {
      return apiError(403, "FORBIDDEN", "Forbidden tenant scope");
    }
    if (auth.context.branchId && auth.context.branchId !== String(shift.branch_id || "")) {
      return apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden branch scope");
    }
  }

  const operationKey = `shift_attach:${tenantId}:${auditId}:${shiftId}`;
  const claim = await claimIdempotency({
    supabase: auth.supabase,
    tenantId,
    operationKey,
    actorId: auth.context.userId,
    ttlMinutes: 30,
  });
  if (!claim.ok) return apiError(500, "INTERNAL_ERROR", claim.error);
  if (!claim.claimed) {
    if (claim.existing?.status === "succeeded") {
      return apiSuccess({
        duplicated: true,
        message: "Already attached",
      });
    }
    return apiError(409, "FORBIDDEN", "Duplicate attach request in progress");
  }

  const attached = await attachUnreconciledEventToShift({
    supabase: auth.supabase,
    tenantId,
    shiftId,
    auditId,
    actorId: auth.context.userId,
    expectedBranchId: auth.context.role === "platform_admin" ? null : auth.context.branchId,
  });

  if (!attached.ok) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: attached.code,
    });
    if (attached.code === "BRANCH_SCOPE_DENIED") {
      return apiError(403, "BRANCH_SCOPE_DENIED", attached.error);
    }
    if (attached.error.includes("already attached")) {
      return apiError(409, "FORBIDDEN", attached.error);
    }
    return apiError(400, "FORBIDDEN", attached.error);
  }

  const reconciliation = await getShiftReconciliation({
    supabase: auth.supabase,
    tenantId,
    shiftId,
    openingCash: toNumber(shift.opening_cash),
  });
  if (!reconciliation.ok) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "INTERNAL_ERROR",
    });
    return apiError(500, "INTERNAL_ERROR", reconciliation.error);
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: auth.context.userId,
    action: "shift_event_attached",
    target_type: "frontdesk_shift",
    target_id: shiftId,
    reason: "manager_reconciliation_attach",
    payload: {
      auditId,
      eventType: attached.attached.eventType,
      refId: attached.attached.refId,
      amount: attached.attached.amount,
      shiftId,
    },
  }).catch(() => null);

  await finalizeIdempotency({
    supabase: auth.supabase,
    tenantId,
    operationKey,
    status: "succeeded",
    response: {
      auditId,
      shiftId,
    },
  });

  return apiSuccess({
    attached: attached.attached,
    reconciliation: {
      expectedCash: reconciliation.expectedCash,
      summary: reconciliation.summary,
    },
  });
}
