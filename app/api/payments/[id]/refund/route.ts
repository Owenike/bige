import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../../../lib/auth-context";
import { executePaymentRefund } from "../../../../../lib/high-risk-actions";
import { notifyHighRiskRequestCreated } from "../../../../../lib/in-app-notifications";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "Invalid tenant context");
  }

  const shiftGuard = await requireOpenShift({
    supabase: auth.supabase,
    context: auth.context,
    enforceRoles: ["frontdesk"],
  });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const { id } = await context.params;

  if (!reason) return apiError(400, "FORBIDDEN", "reason is required");

  if (auth.context.role === "frontdesk") {
    const { data, error } = await auth.supabase
      .from("high_risk_action_requests")
      .insert({
        tenant_id: auth.context.tenantId,
        branch_id: auth.context.branchId,
        requested_by: auth.context.userId,
        action: "payment_refund",
        target_type: "payment",
        target_id: id,
        reason,
        payload: {},
      })
      .select("id, status, created_at")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return apiError(409, "FORBIDDEN", "A pending approval request already exists for this payment");
      }
      return apiError(500, "INTERNAL_ERROR", error.message);
    }

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "high_risk_request_created",
      target_type: "payment",
      target_id: id,
      reason,
      payload: { requestId: data?.id, action: "payment_refund" },
    });

    if (data?.id) {
      await notifyHighRiskRequestCreated({
        tenantId: auth.context.tenantId,
        branchId: auth.context.branchId,
        requestId: String(data.id),
        action: "payment_refund",
        targetType: "payment",
        targetId: id,
        requestedBy: auth.context.userId,
      }).catch(() => null);
    }

    return apiSuccess({
      request: data,
      pendingApproval: true,
      message: "Refund request submitted for manager approval",
    });
  }

  const result = await executePaymentRefund({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    actorId: auth.context.userId,
    paymentId: id,
    reason,
  });

  if (!result.ok) return apiError(result.status, "FORBIDDEN", result.error);
  return apiSuccess({ payment: result.payment || null });
}
