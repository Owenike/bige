import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { executeOrderVoid, executePaymentRefund } from "../../../../../lib/high-risk-actions";
import { notifyApprovalDecision } from "../../../../../lib/in-app-notifications";

type Decision = "approve" | "reject";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "Invalid tenant context");
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const decision: Decision = body?.decision === "reject" ? "reject" : "approve";
  const decisionNote = typeof body?.decisionNote === "string" ? body.decisionNote.trim() : "";

  const { data: reqRow, error: reqError } = await auth.supabase
    .from("high_risk_action_requests")
    .select("id, action, target_type, target_id, reason, status, requested_by")
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (reqError || !reqRow) return apiError(404, "FORBIDDEN", "Approval request not found");
  if (reqRow.status !== "pending") {
    return apiError(409, "FORBIDDEN", "This request is already resolved");
  }

  if (decision === "reject") {
    const { data, error } = await auth.supabase
      .from("high_risk_action_requests")
      .update({
        status: "rejected",
        decision_note: decisionNote || null,
        resolved_by: auth.context.userId,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", auth.context.tenantId)
      .select("id, status, decision_note, resolved_at")
      .maybeSingle();

    if (error) return apiError(500, "INTERNAL_ERROR", error.message);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "high_risk_request_rejected",
      target_type: reqRow.target_type,
      target_id: reqRow.target_id,
      reason: reqRow.reason,
      payload: { requestId: id, action: reqRow.action, decisionNote: decisionNote || null },
    });

    await notifyApprovalDecision({
      tenantId: auth.context.tenantId,
      requestId: id,
      decision: "rejected",
      action: reqRow.action,
      targetType: reqRow.target_type,
      targetId: reqRow.target_id,
      requestedBy: typeof reqRow.requested_by === "string" ? reqRow.requested_by : null,
      resolvedBy: auth.context.userId,
    }).catch(() => null);

    return apiSuccess({ request: data, decision: "rejected" });
  }

  if (reqRow.action === "order_void") {
    const result = await executeOrderVoid({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      role: "manager",
      branchId: auth.context.branchId,
      orderId: reqRow.target_id,
      reason: reqRow.reason,
    });
    if (!result.ok) return apiError(result.status, "FORBIDDEN", result.error);
  } else if (reqRow.action === "payment_refund") {
    const result = await executePaymentRefund({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      paymentId: reqRow.target_id,
      reason: reqRow.reason,
    });
    if (!result.ok) return apiError(result.status, "FORBIDDEN", result.error);
  } else {
    return apiError(400, "FORBIDDEN", "Unsupported action type");
  }

  const { data, error } = await auth.supabase
    .from("high_risk_action_requests")
    .update({
      status: "approved",
      decision_note: decisionNote || null,
      resolved_by: auth.context.userId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .select("id, status, decision_note, resolved_at")
    .maybeSingle();

  if (error) return apiError(500, "INTERNAL_ERROR", error.message);

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "high_risk_request_approved",
    target_type: reqRow.target_type,
    target_id: reqRow.target_id,
    reason: reqRow.reason,
    payload: { requestId: id, action: reqRow.action, decisionNote: decisionNote || null },
  });

  await notifyApprovalDecision({
    tenantId: auth.context.tenantId,
    requestId: id,
    decision: "approved",
    action: reqRow.action,
    targetType: reqRow.target_type,
    targetId: reqRow.target_id,
    requestedBy: typeof reqRow.requested_by === "string" ? reqRow.requested_by : null,
    resolvedBy: auth.context.userId,
  }).catch(() => null);

  return apiSuccess({ request: data, decision: "approved" });
}
