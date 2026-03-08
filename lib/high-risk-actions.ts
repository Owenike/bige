import { SupabaseClient } from "@supabase/supabase-js";
import { TEMP_DISABLE_ROLE_GUARD } from "./auth-context";
import { writeOperationalAudit } from "./contracts-audit";
import { claimIdempotency, finalizeIdempotency } from "./idempotency";
import { notifyUnreconciledEvent } from "./in-app-notifications";
import { findOpenShiftForBranch, insertShiftItem } from "./shift-reconciliation";

function mapRefundRpcError(message: string) {
  if (message.includes("reason_required")) return { status: 400, error: "reason is required" };
  if (message.includes("payment_not_found")) return { status: 404, error: "Payment not found" };
  if (message.includes("payment_not_refundable")) {
    return { status: 400, error: "Only paid payments can be refunded" };
  }
  return { status: 500, error: message };
}

function isMissingTableError(message: string | undefined, table: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = table.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target))
  );
}

async function revokeOrderEntitlements(params: {
  supabase: SupabaseClient;
  tenantId: string;
  orderId: string;
  actorId: string;
  reason: string;
  referenceType: "order_void" | "payment_refund";
}) {
  const contractsResult = await params.supabase
    .from("member_plan_contracts")
    .select("id, member_id, branch_id, remaining_uses, remaining_sessions, status")
    .eq("tenant_id", params.tenantId)
    .eq("source_order_id", params.orderId);

  if (contractsResult.error) {
    if (isMissingTableError(contractsResult.error.message, "member_plan_contracts")) return;
    throw new Error(contractsResult.error.message);
  }

  const contracts = contractsResult.data || [];
  for (const contract of contracts) {
    const currentUses = Number(contract.remaining_uses ?? 0);
    const currentSessions = Number(contract.remaining_sessions ?? 0);
    await params.supabase
      .from("member_plan_contracts")
      .update({
        status: "canceled",
        remaining_uses: 0,
        remaining_sessions: 0,
        note: `${params.referenceType}:${params.reason}`,
        updated_by: params.actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", params.tenantId)
      .eq("id", contract.id);

    const ledgerInsert = await params.supabase.from("member_plan_ledger").insert({
      tenant_id: params.tenantId,
      branch_id: contract.branch_id || null,
      member_id: contract.member_id,
      contract_id: contract.id,
      source_type: "refund_reversal",
      delta_uses: -currentUses,
      delta_sessions: -currentSessions,
      balance_uses: 0,
      balance_sessions: 0,
      reference_type: params.referenceType,
      reference_id: params.orderId,
      reason: params.reason,
      payload: {
        previousStatus: contract.status,
        previousRemainingUses: currentUses,
        previousRemainingSessions: currentSessions,
      },
      created_by: params.actorId,
    });
    if (ledgerInsert.error && !isMissingTableError(ledgerInsert.error.message, "member_plan_ledger")) {
      throw new Error(ledgerInsert.error.message);
    }
  }

  const subUpdate = await params.supabase
    .from("subscriptions")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("source_order_id", params.orderId)
    .neq("status", "cancelled");
  if (subUpdate.error && !isMissingTableError(subUpdate.error.message, "source_order_id")) {
    throw new Error(subUpdate.error.message);
  }

  const passUpdate = await params.supabase
    .from("entry_passes")
    .update({
      status: "cancelled",
      remaining: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("source_order_id", params.orderId)
    .neq("status", "cancelled");
  if (passUpdate.error && !isMissingTableError(passUpdate.error.message, "source_order_id")) {
    throw new Error(passUpdate.error.message);
  }

  await params.supabase.from("audit_logs").insert({
    tenant_id: params.tenantId,
    actor_id: params.actorId,
    action: "member_entitlements_reversed",
    target_type: "order",
    target_id: params.orderId,
    reason: params.reason,
    payload: { referenceType: params.referenceType, contractCount: contracts.length },
  });
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

  const voidClaim = await claimIdempotency({
    supabase,
    tenantId,
    operationKey: `order_void:${tenantId}:${orderId}:${trimmedReason}`,
    actorId,
    ttlMinutes: 60,
  });
  if (!voidClaim.ok) {
    return { ok: false as const, status: 500, error: voidClaim.error };
  }
  if (!voidClaim.claimed) {
    if (voidClaim.existing?.status === "succeeded") {
      return { ok: true as const, order: null };
    }
    return { ok: false as const, status: 409, error: "Duplicate void request in progress" };
  }

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

  try {
    await revokeOrderEntitlements({
      supabase,
      tenantId,
      orderId,
      actorId,
      reason: trimmedReason,
      referenceType: "order_void",
    });
  } catch (entitlementError) {
    await finalizeIdempotency({
      supabase,
      tenantId,
      operationKey: `order_void:${tenantId}:${orderId}:${trimmedReason}`,
      status: "failed",
      errorCode: "ORDER_VOID_REVERSE_FAILED",
    });
    await writeOperationalAudit({
      supabase,
      tenantId,
      actorId,
      action: "member_entitlements_reversal_failed",
      targetType: "order",
      targetId: orderId,
      reason: trimmedReason,
      payload: {
        referenceType: "order_void",
        error: entitlementError instanceof Error ? entitlementError.message : "unknown",
      },
    });
    return {
      ok: false as const,
      status: 500,
      error: entitlementError instanceof Error ? entitlementError.message : "Failed to reverse entitlements",
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "order_void",
    target_type: "order",
    target_id: orderId,
    reason: trimmedReason,
    payload: { previousStatus: order.status },
  });

  const openShift = await findOpenShiftForBranch({
    supabase,
    tenantId,
    branchId: typeof order.branch_id === "string" ? order.branch_id : null,
  });
  if (openShift.ok) {
    if (openShift.shiftId) {
      await insertShiftItem({
        supabase,
        tenantId,
        shiftId: openShift.shiftId,
        kind: "adjustment",
        refId: orderId,
        amount: 0,
        summary: `order_void:${orderId}`,
        eventType: "order_voided",
        metadata: {
          reason: trimmedReason,
          previousStatus: order.status,
        },
      }).catch(() => null);
    } else {
      await notifyUnreconciledEvent({
        tenantId,
        branchId: typeof order.branch_id === "string" ? order.branch_id : null,
        eventType: "order_voided",
        refId: orderId,
        actorId,
      }).catch(() => null);
    }
  }

  await finalizeIdempotency({
    supabase,
    tenantId,
    operationKey: `order_void:${tenantId}:${orderId}:${trimmedReason}`,
    status: "succeeded",
    response: {
      order: data as Record<string, unknown>,
    },
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
  const normalizedReason = reason.trim();

  const paymentContextResult = await supabase
    .from("payments")
    .select("id, order_id, amount, method, status")
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();
  if (paymentContextResult.error) {
    return { ok: false as const, status: 500, error: paymentContextResult.error.message };
  }
  if (!paymentContextResult.data) {
    return { ok: false as const, status: 404, error: "Payment not found" };
  }
  const paymentContext = paymentContextResult.data as {
    id: string;
    order_id: string;
    amount: number | string | null;
    method: string | null;
    status: string | null;
  };

  const refundClaim = await claimIdempotency({
    supabase,
    tenantId,
    operationKey: `payment_refund:${tenantId}:${paymentId}:${normalizedReason}`,
    actorId,
    ttlMinutes: 60,
  });
  if (!refundClaim.ok) {
    return { ok: false as const, status: 500, error: refundClaim.error };
  }
  if (!refundClaim.claimed) {
    if (refundClaim.existing?.status === "succeeded") {
      return { ok: true as const, payment: null };
    }
    return { ok: false as const, status: 409, error: "Duplicate refund request in progress" };
  }

  const rpcResult = await supabase.rpc("refund_payment", {
    p_tenant_id: tenantId,
    p_payment_id: paymentId,
    p_reason: normalizedReason,
    p_actor_id: actorId,
  });

  if (rpcResult.error) {
    const mapped = mapRefundRpcError(rpcResult.error.message || "Refund failed");
    await finalizeIdempotency({
      supabase,
      tenantId,
      operationKey: `payment_refund:${tenantId}:${paymentId}:${normalizedReason}`,
      status: "failed",
      errorCode: "REFUND_RPC_FAILED",
    });
    return { ok: false as const, status: mapped.status, error: mapped.error };
  }

  const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
  if (!row?.payment_id) return { ok: false as const, status: 500, error: "Refund failed" };

  try {
    await revokeOrderEntitlements({
      supabase,
      tenantId,
      orderId: String(row.order_id),
      actorId,
      reason: normalizedReason,
      referenceType: "payment_refund",
    });
  } catch (entitlementError) {
    await finalizeIdempotency({
      supabase,
      tenantId,
      operationKey: `payment_refund:${tenantId}:${paymentId}:${normalizedReason}`,
      status: "failed",
      errorCode: "REFUND_REVERSE_FAILED",
    });
    await writeOperationalAudit({
      supabase,
      tenantId,
      actorId,
      action: "member_entitlements_reversal_failed",
      targetType: "payment",
      targetId: paymentId,
      reason: normalizedReason,
      payload: {
        referenceType: "payment_refund",
        error: entitlementError instanceof Error ? entitlementError.message : "unknown",
      },
    });
    return {
      ok: false as const,
      status: 500,
      error: entitlementError instanceof Error ? entitlementError.message : "Failed to reverse entitlements",
    };
  }

  await finalizeIdempotency({
    supabase,
    tenantId,
    operationKey: `payment_refund:${tenantId}:${paymentId}:${normalizedReason}`,
    status: "succeeded",
    response: {
      payment: {
        id: row.payment_id as string,
        order_id: row.order_id as string,
        status: row.payment_status as string,
        updated_at: row.updated_at as string,
      },
    },
  });

  const orderBranchResult = await supabase
    .from("orders")
    .select("branch_id")
    .eq("tenant_id", tenantId)
    .eq("id", String(row.order_id))
    .maybeSingle();
  if (!orderBranchResult.error) {
    const openShift = await findOpenShiftForBranch({
      supabase,
      tenantId,
      branchId: typeof orderBranchResult.data?.branch_id === "string" ? orderBranchResult.data.branch_id : null,
    });
    if (openShift.ok) {
      const method = paymentContext.method;
      const normalizedMethod =
        method === "cash" || method === "card" || method === "transfer" || method === "manual" || method === "newebpay"
          ? method
          : null;
      if (openShift.shiftId) {
        await insertShiftItem({
          supabase,
          tenantId,
          shiftId: openShift.shiftId,
          kind: "refund",
          refId: paymentId,
          amount: Number(paymentContext.amount ?? 0),
          summary: `refund:${String(row.order_id)}:${normalizedMethod || "manual"}`,
          eventType: "payment_refunded",
          paymentMethod: normalizedMethod,
          metadata: {
            orderId: String(row.order_id),
            paymentId,
            reason: normalizedReason,
          },
        }).catch(() => null);
      } else {
        await notifyUnreconciledEvent({
          tenantId,
          branchId: typeof orderBranchResult.data?.branch_id === "string" ? orderBranchResult.data.branch_id : null,
          eventType: "payment_refunded",
          refId: paymentId,
          actorId,
        }).catch(() => null);
      }
    }
  }

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
