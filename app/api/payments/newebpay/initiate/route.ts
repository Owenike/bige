import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

export async function POST(request: Request) {
  const auth = await requireProfile(["member", "frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";

  if (!orderId || !auth.context.tenantId) {
    return NextResponse.json({ error: "orderId and tenant context are required" }, { status: 400 });
  }

  const { data: order, error: orderError } = await auth.supabase
    .from("orders")
    .select("id, amount, status, member_id, branch_id")
    .eq("id", orderId)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (orderError || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status === "paid") return NextResponse.json({ error: "Order already paid" }, { status: 400 });
  if (auth.context.role === "frontdesk" && auth.context.branchId && String(order.branch_id || "") !== auth.context.branchId) {
    return NextResponse.json({ error: "Forbidden order access for current branch" }, { status: 403 });
  }

  if (auth.context.role === "member") {
    const memberResult = await auth.supabase
      .from("members")
      .select("id")
      .eq("auth_user_id", auth.context.userId)
      .maybeSingle();

    if (memberResult.error || !memberResult.data) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (String(order.member_id || "") !== String(memberResult.data.id)) {
      return NextResponse.json({ error: "Forbidden order access" }, { status: 403 });
    }
  }

  const { data: payment, error: paymentError } = await auth.supabase
    .from("payments")
    .insert({
      tenant_id: auth.context.tenantId,
      order_id: order.id,
      amount: Number(order.amount ?? 0),
      status: "pending",
      method: "newebpay",
    })
    .select("id, order_id, amount, status")
    .maybeSingle();

  if (paymentError || !payment) {
    return NextResponse.json({ error: paymentError?.message || "Unable to create payment" }, { status: 500 });
  }

  const base = process.env.NEWEBPAY_CHECKOUT_URL || "";
  const callback = process.env.NEWEBPAY_WEBHOOK_URL || "";
  if (!base || !callback) {
    return NextResponse.json(
      {
        error: "Missing NEWEBPAY_CHECKOUT_URL or NEWEBPAY_WEBHOOK_URL",
        payment,
      },
      { status: 500 },
    );
  }

  const checkoutUrl = `${base}?paymentId=${encodeURIComponent(payment.id)}&orderId=${encodeURIComponent(order.id)}&amount=${encodeURIComponent(String(payment.amount))}&callback=${encodeURIComponent(callback)}`;

  return NextResponse.json({
    payment,
    checkoutUrl,
  });
}
