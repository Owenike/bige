import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";
import { executePaymentRefund } from "../../../../../lib/high-risk-actions";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Invalid tenant context" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const { id } = await context.params;

  if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });

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
        return NextResponse.json({ error: "A pending approval request already exists for this payment" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
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

    return NextResponse.json(
      {
        request: data,
        pendingApproval: true,
        message: "Refund request submitted for manager approval",
      },
      { status: 202 },
    );
  }

  const result = await executePaymentRefund({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    actorId: auth.context.userId,
    paymentId: id,
    reason,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ payment: result.payment });
}
