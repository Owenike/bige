import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";
import { executeOrderVoid, executePaymentRefund } from "../../../../../lib/high-risk-actions";

type Decision = "approve" | "reject";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Invalid tenant context" }, { status: 400 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const decision: Decision = body?.decision === "reject" ? "reject" : "approve";
  const decisionNote = typeof body?.decisionNote === "string" ? body.decisionNote.trim() : "";

  const { data: reqRow, error: reqError } = await auth.supabase
    .from("high_risk_action_requests")
    .select("id, action, target_type, target_id, reason, status")
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (reqError || !reqRow) return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
  if (reqRow.status !== "pending") {
    return NextResponse.json({ error: "This request is already resolved" }, { status: 409 });
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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "high_risk_request_rejected",
      target_type: reqRow.target_type,
      target_id: reqRow.target_id,
      reason: reqRow.reason,
      payload: { requestId: id, action: reqRow.action, decisionNote: decisionNote || null },
    });

    return NextResponse.json({ request: data, decision: "rejected" });
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
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  } else if (reqRow.action === "payment_refund") {
    const result = await executePaymentRefund({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      paymentId: reqRow.target_id,
      reason: reqRow.reason,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  } else {
    return NextResponse.json({ error: "Unsupported action type" }, { status: 400 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "high_risk_request_approved",
    target_type: reqRow.target_type,
    target_id: reqRow.target_id,
    reason: reqRow.reason,
    payload: { requestId: id, action: reqRow.action, decisionNote: decisionNote || null },
  });

  return NextResponse.json({ request: data, decision: "approved" });
}
