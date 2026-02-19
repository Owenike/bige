import { NextResponse } from "next/server";
import { TEMP_DISABLE_ROLE_GUARD, requireOpenShift, requireProfile } from "../../../lib/auth-context";
import { fulfillOrderEntitlements } from "../../../lib/order-fulfillment";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  if (!auth.context.tenantId) return NextResponse.json({ error: "Invalid tenant context" }, { status: 400 });

  const orderResult = await auth.supabase
    .from("orders")
    .select("id, branch_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (orderResult.error || !orderResult.data) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!TEMP_DISABLE_ROLE_GUARD && auth.context.role === "frontdesk" && auth.context.branchId && String(orderResult.data.branch_id || "") !== auth.context.branchId) {
    return NextResponse.json({ error: "Forbidden order access for current branch" }, { status: 403 });
  }

  const { data, error } = await auth.supabase
    .from("payments")
    .select("id, order_id, amount, status, method, gateway_ref, paid_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  const amount = Number(body?.amount ?? 0);
  const method = ["cash", "card", "transfer", "newebpay", "manual"].includes(body?.method)
    ? body.method
    : "manual";
  const gatewayRef = typeof body?.gatewayRef === "string" ? body.gatewayRef : null;

  if (!auth.context.tenantId || !orderId || Number.isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: "Missing or invalid payment fields" }, { status: 400 });
  }

  const { data: order, error: orderError } = await auth.supabase
    .from("orders")
    .select("id, amount, status, member_id, branch_id")
    .eq("id", orderId)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (orderError || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!TEMP_DISABLE_ROLE_GUARD && auth.context.role === "frontdesk" && auth.context.branchId && String(order.branch_id || "") !== auth.context.branchId) {
    return NextResponse.json({ error: "Forbidden order access for current branch" }, { status: 403 });
  }
  if (order.status === "cancelled" || order.status === "refunded") {
    return NextResponse.json({ error: "Order is closed" }, { status: 400 });
  }
  if (order.status === "paid") {
    return NextResponse.json({ error: "Order already paid" }, { status: 400 });
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
    return NextResponse.json({ error: "Payment amount exceeds remaining balance" }, { status: 400 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const remainingAfter = Math.max(0, remainingBefore - amount);
  const nextOrderStatus = remainingAfter <= 0 ? "paid" : "confirmed";

  await auth.supabase
    .from("orders")
    .update({ status: nextOrderStatus, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("tenant_id", auth.context.tenantId);

  if (nextOrderStatus === "paid") {
    await fulfillOrderEntitlements({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      orderId,
      actorId: auth.context.userId,
      memberId: String(order.member_id || ""),
    });
  }

  if (shiftGuard.shift?.id) {
    await auth.supabase.from("frontdesk_shift_items").insert({
      tenant_id: auth.context.tenantId,
      shift_id: shiftGuard.shift.id,
      kind: "payment",
      ref_id: String(data?.id || ""),
      amount,
      summary: `payment:${orderId}:${method}`,
    });
  }

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
    },
  });

  return NextResponse.json({ payment: data }, { status: 201 });
}
