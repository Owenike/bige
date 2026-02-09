import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

function mapRefundRpcError(message: string) {
  if (message.includes("reason_required")) return { status: 400, error: "reason is required" };
  if (message.includes("payment_not_found")) return { status: 404, error: "Payment not found" };
  if (message.includes("payment_not_refundable")) {
    return { status: 400, error: "Only paid payments can be refunded" };
  }
  return { status: 500, error: message };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const { id } = await context.params;

  const rpcResult = await auth.supabase.rpc("refund_payment", {
    p_tenant_id: auth.context.tenantId,
    p_payment_id: id,
    p_reason: reason,
    p_actor_id: auth.context.userId,
  });

  if (rpcResult.error) {
    const mapped = mapRefundRpcError(rpcResult.error.message || "Refund failed");
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
  if (!row?.payment_id) return NextResponse.json({ error: "Refund failed" }, { status: 500 });

  return NextResponse.json({
    payment: {
      id: row.payment_id,
      order_id: row.order_id,
      status: row.payment_status,
      updated_at: row.updated_at,
    },
  });
}
