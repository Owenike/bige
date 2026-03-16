import { NextResponse } from "next/server";
import { createOrReuseBookingDepositPayment } from "../../../../../lib/booking-deposit-payments";
import { TEMP_DISABLE_ROLE_GUARD, requireProfile } from "../../../../../lib/auth-context";

export async function POST(request: Request) {
  const auth = await requireProfile(["member", "frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : "";

  if ((!orderId && !bookingId) || !auth.context.tenantId) {
    return NextResponse.json({ error: "orderId or bookingId and tenant context are required" }, { status: 400 });
  }

  if (bookingId) {
    const bookingResult = await auth.supabase
      .from("bookings")
      .select("id, tenant_id, branch_id, member_id, status")
      .eq("id", bookingId)
      .eq("tenant_id", auth.context.tenantId)
      .maybeSingle();

    if (bookingResult.error || !bookingResult.data) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (!TEMP_DISABLE_ROLE_GUARD && auth.context.role === "frontdesk" && auth.context.branchId && String(bookingResult.data.branch_id || "") !== auth.context.branchId) {
      return NextResponse.json({ error: "Forbidden booking access for current branch" }, { status: 403 });
    }

    if (!TEMP_DISABLE_ROLE_GUARD && auth.context.role === "member") {
      const memberResult = await auth.supabase
        .from("members")
        .select("id")
        .eq("auth_user_id", auth.context.userId)
        .eq("tenant_id", auth.context.tenantId)
        .maybeSingle();

      if (memberResult.error || !memberResult.data) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }

      if (String(bookingResult.data.member_id || "") !== String(memberResult.data.id)) {
        return NextResponse.json({ error: "Forbidden booking access" }, { status: 403 });
      }
    }

    try {
      const depositPayment = await createOrReuseBookingDepositPayment({
        supabase: auth.supabase,
        tenantId: auth.context.tenantId,
        bookingId,
        actorId: auth.context.userId,
        channel: auth.context.role === "member" ? "online" : "frontdesk",
      });

      return NextResponse.json({
        depositPayment: depositPayment.depositPayment,
        paymentCreated: depositPayment.paymentCreated,
        reusedPendingPayment: depositPayment.reusedPendingPayment,
        voidedStalePendingPayment: depositPayment.voidedStalePendingPayment,
        alreadyPaid: depositPayment.alreadyPaid,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to create booking deposit payment" },
        { status: 400 },
      );
    }
  }

  const { data: order, error: orderError } = await auth.supabase
    .from("orders")
    .select("id, amount, status, member_id, branch_id")
    .eq("id", orderId)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (orderError || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status === "paid") return NextResponse.json({ error: "Order already paid" }, { status: 400 });
  if (!TEMP_DISABLE_ROLE_GUARD && auth.context.role === "frontdesk" && auth.context.branchId && String(order.branch_id || "") !== auth.context.branchId) {
    return NextResponse.json({ error: "Forbidden order access for current branch" }, { status: 403 });
  }

  if (!TEMP_DISABLE_ROLE_GUARD && auth.context.role === "member") {
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
