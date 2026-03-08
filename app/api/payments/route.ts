import { NextResponse } from "next/server";
import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../lib/auth-context";
import { writeOperationalAudit } from "../../../lib/contracts-audit";
import { claimIdempotency, finalizeIdempotency } from "../../../lib/idempotency";
import { requirePermission } from "../../../lib/permissions";
import { fulfillOrderEntitlements } from "../../../lib/order-fulfillment";
import { insertShiftItem } from "../../../lib/shift-reconciliation";

function ok<TData extends Record<string, unknown>>(data: TData) {
  return apiSuccess(data);
}

function fail(
  status: number,
  code: "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_ERROR" | "BRANCH_SCOPE_DENIED",
  message: string,
) {
  return apiError(status, code, message);
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "payments.read");
  if (!permission.ok) return permission.response;

  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) return fail(400, "FORBIDDEN", "orderId is required");
  if (!auth.context.tenantId) return fail(400, "FORBIDDEN", "Invalid tenant context");
  if (auth.context.role === "frontdesk" && !auth.context.branchId) {
    return fail(403, "BRANCH_SCOPE_DENIED", "Missing branch context for frontdesk");
  }

  const orderResult = await auth.supabase
    .from("orders")
    .select("id, branch_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (orderResult.error || !orderResult.data) return fail(404, "FORBIDDEN", "Order not found");
  if (auth.context.role === "frontdesk" && auth.context.branchId && String(orderResult.data.branch_id || "") !== auth.context.branchId) {
    return fail(403, "BRANCH_SCOPE_DENIED", "Forbidden order access for current branch");
  }

  const { data, error } = await auth.supabase
    .from("payments")
    .select("id, order_id, amount, status, method, gateway_ref, paid_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  if (error) return fail(500, "INTERNAL_ERROR", error.message);
  return ok({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "payments.write");
  if (!permission.ok) return permission.response;
  if (auth.context.role === "frontdesk" && !auth.context.branchId) {
    return fail(403, "BRANCH_SCOPE_DENIED", "Missing branch context for frontdesk");
  }

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  const amount = Number(body?.amount ?? 0);
  const method = ["cash", "card", "transfer", "newebpay", "manual"].includes(body?.method)
    ? body.method
    : "manual";
  const gatewayRef = typeof body?.gatewayRef === "string" ? body.gatewayRef : null;
  const idempotencyKeyInput = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!auth.context.tenantId || !orderId || Number.isNaN(amount) || amount <= 0) {
    return fail(400, "FORBIDDEN", "Missing or invalid payment fields");
  }

  const { data: order, error: orderError } = await auth.supabase
    .from("orders")
    .select("id, amount, status, member_id, branch_id")
    .eq("id", orderId)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (orderError || !order) return fail(404, "FORBIDDEN", "Order not found");
  if (auth.context.role === "frontdesk" && auth.context.branchId && String(order.branch_id || "") !== auth.context.branchId) {
    return fail(403, "BRANCH_SCOPE_DENIED", "Forbidden order access for current branch");
  }
  if (order.status === "cancelled" || order.status === "refunded") {
    return fail(400, "FORBIDDEN", "Order is closed");
  }
  if (order.status === "paid") {
    return fail(400, "FORBIDDEN", "Order already paid");
  }

  const orderAmount = Number(order.amount ?? 0);
  const paidRows = await auth.supabase
    .from("payments")
    .select("amount")
    .eq("tenant_id", auth.context.tenantId)
    .eq("order_id", orderId)
    .eq("status", "paid");

  const paidTotal = ((paidRows.data || []) as Array<{ amount: number | string | null }>).reduce(
    (sum: number, row) => sum + Number(row.amount ?? 0),
    0,
  );
  const remainingBefore = Math.max(0, orderAmount - paidTotal);

  if (amount > remainingBefore) {
    return fail(400, "FORBIDDEN", "Payment amount exceeds remaining balance");
  }

  const operationKey =
    idempotencyKeyInput ||
    [
      "payment_record",
      auth.context.tenantId,
      orderId,
      amount.toFixed(2),
      method,
      gatewayRef || "na",
    ].join(":");
  const operationClaim = await claimIdempotency({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    operationKey,
    actorId: auth.context.userId,
    ttlMinutes: 60,
  });
  if (!operationClaim.ok) {
    return fail(500, "INTERNAL_ERROR", operationClaim.error);
  }
  if (!operationClaim.claimed) {
    if (operationClaim.existing?.status === "succeeded" && operationClaim.existing.response) {
      return ok({ replayed: true, ...operationClaim.existing.response });
    }
    return fail(409, "FORBIDDEN", "Duplicate payment request in progress");
  }

  const { data, error } = await auth.supabase
    .from("payments")
    .insert({
      tenant_id: auth.context.tenantId,
      order_id: orderId,
      amount,
      status: "paid",
      method,
      gateway_ref: gatewayRef,
      paid_at: new Date().toISOString(),
    })
    .select("id, order_id, amount, status, method, paid_at")
    .maybeSingle();

  if (error) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      operationKey,
      status: "failed",
      errorCode: "PAYMENT_INSERT_FAILED",
    });
    return fail(500, "INTERNAL_ERROR", error.message);
  }

  const remainingAfter = Math.max(0, remainingBefore - amount);
  const nextOrderStatus = remainingAfter <= 0 ? "paid" : "confirmed";

  const orderUpdateResult = await auth.supabase
    .from("orders")
    .update({ status: nextOrderStatus, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("tenant_id", auth.context.tenantId);
  if (orderUpdateResult.error) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      operationKey,
      status: "failed",
      errorCode: "ORDER_UPDATE_FAILED",
    });
    return fail(500, "INTERNAL_ERROR", orderUpdateResult.error.message);
  }

  let fulfillmentResult:
    | {
        ok: boolean;
        fulfilled?: boolean;
        reason?: string | null;
      }
    | null = null;
  if (nextOrderStatus === "paid") {
    fulfillmentResult = await fulfillOrderEntitlements({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      orderId,
      actorId: auth.context.userId,
      memberId: String(order.member_id || ""),
      paymentId: String(data?.id || ""),
    });
    if (!fulfillmentResult.ok) {
      await writeOperationalAudit({
        supabase: auth.supabase,
        tenantId: auth.context.tenantId,
        actorId: auth.context.userId,
        action: "entitlement_fulfillment_failed",
        targetType: "order",
        targetId: orderId,
        reason: "payment_recorded_but_fulfillment_failed",
        payload: {
          paymentId: String(data?.id || ""),
          reason: fulfillmentResult.reason || null,
        },
      });
    }
  }

  await insertShiftItem({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    shiftId: shiftGuard.shift?.id ? String(shiftGuard.shift.id) : null,
    kind: "payment",
    refId: String(data?.id || ""),
    amount,
    summary: `payment:${orderId}:${method}`,
    eventType: "payment_recorded",
    paymentMethod: method,
    metadata: {
      orderId,
      paymentId: String(data?.id || ""),
      method,
    },
  }).catch(() => null);

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "payment_recorded",
    target_type: "payment",
    target_id: data?.id ? String(data.id) : null,
    reason: null,
    payload: {
      orderId,
      amount,
      method,
      remainingBefore,
      remainingAfter,
      nextOrderStatus,
      fulfillmentResult,
    },
  });

  const successPayload = {
    payment: data,
    fulfillment: fulfillmentResult,
  };
  await finalizeIdempotency({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    operationKey,
    status: "succeeded",
    response: successPayload as Record<string, unknown>,
  });

  return NextResponse.json(
    {
      ok: true,
      data: successPayload,
      payment: data,
      fulfillment: fulfillmentResult,
    },
    { status: 201 },
  );
}
