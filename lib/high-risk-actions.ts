import { SupabaseClient } from "@supabase/supabase-js";
import { TEMP_DISABLE_ROLE_GUARD } from "./auth-context";

function mapRefundRpcError(message: string) {
  if (message.includes("reason_required")) return { status: 400, error: "reason is required" };
  if (message.includes("payment_not_found")) return { status: 404, error: "Payment not found" };
  if (message.includes("payment_not_refundable")) {
    return { status: 400, error: "Only paid payments can be refunded" };
  }
  return { status: 500, error: message };
}

export async function executeOrderVoid(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorId: string;
  role: "manager" | "frontdesk";
  branchId: string | null;
  orderId: string;
  reason: string;
}) {
  const { supabase, tenantId, actorId, role, branchId, orderId, reason } = params;
  const trimmedReason = reason.trim();
  if (!trimmedReason) return { ok: false as const, status: 400, error: "reason is required" };

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, status, branch_id")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fetchError || !order) return { ok: false as const, status: 404, error: "Order not found" };
  if (!TEMP_DISABLE_ROLE_GUARD && role === "frontdesk" && branchId && String(order.branch_id || "") !== branchId) {
    return { ok: false as const, status: 403, error: "Forbidden order access for current branch" };
  }
  if (order.status === "cancelled" || order.status === "refunded") {
    return { ok: false as const, status: 400, error: "Order already closed" };
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .select("id, status, updated_at")
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: error.message };

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "order_void",
    target_type: "order",
    target_id: orderId,
    reason: trimmedReason,
    payload: { previousStatus: order.status },
  });

  return { ok: true as const, order: data };
}

export async function executePaymentRefund(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorId: string;
  paymentId: string;
  reason: string;
}) {
  const { supabase, tenantId, actorId, paymentId, reason } = params;

  const rpcResult = await supabase.rpc("refund_payment", {
    p_tenant_id: tenantId,
    p_payment_id: paymentId,
    p_reason: reason.trim(),
    p_actor_id: actorId,
  });

  if (rpcResult.error) {
    const mapped = mapRefundRpcError(rpcResult.error.message || "Refund failed");
    return { ok: false as const, status: mapped.status, error: mapped.error };
  }

  const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
  if (!row?.payment_id) return { ok: false as const, status: 500, error: "Refund failed" };

  return {
    ok: true as const,
    payment: {
      id: row.payment_id as string,
      order_id: row.order_id as string,
      status: row.payment_status as string,
      updated_at: row.updated_at as string,
    },
  };
}
