import { NextResponse } from "next/server";
import { requireTrialBookingAdmin } from "../../../../../../lib/trial-booking-admin-auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TrialBookingPaymentRow = {
  booking_status: string;
  payment_method: string;
  payment_status: string;
};

const TRIAL_BOOKING_SELECT = [
  "id",
  "created_at",
  "name",
  "phone",
  "birthday",
  "line_name",
  "service",
  "preferred_time",
  "payment_method",
  "payment_status",
  "amount",
  "currency",
  "merchant_trade_no",
  "acpay_trade_no",
  "paid_at",
  "appointment_date",
  "appointment_time",
  "booking_coach",
  "executing_coach",
  "source",
  "booking_status",
  "line_notification_status",
  "line_notified_at",
  "line_notification_error",
  "note",
  "schedule_note",
  "updated_at",
].join(", ");

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTrialBookingAdmin(request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const { id } = await context.params;
  const bookingId = typeof id === "string" ? id.trim() : "";
  if (!bookingId || !uuidPattern.test(bookingId)) {
    return NextResponse.json({ ok: false, error: "Invalid booking id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "confirm_cash_paid") {
    return NextResponse.json({ ok: false, error: "Invalid payment action" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const existingResult = await admin
      .from("trial_bookings")
      .select(TRIAL_BOOKING_SELECT)
      .eq("id", bookingId)
      .maybeSingle();

    if (existingResult.error) {
      return NextResponse.json({ ok: false, error: existingResult.error.message }, { status: 500 });
    }
    if (!existingResult.data) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }
    const existingBooking = existingResult.data as unknown as TrialBookingPaymentRow;
    if (existingBooking.payment_method !== "cash_on_site") {
      return NextResponse.json({ ok: false, error: "此預約不是現場付款，無法人工確認收款。" }, { status: 409 });
    }
    if (existingBooking.booking_status === "cancelled") {
      return NextResponse.json({ ok: false, error: "已隱藏的預約無法確認現場收款。" }, { status: 409 });
    }
    if (existingBooking.payment_status === "paid") {
      return NextResponse.json({ ok: true, booking: existingResult.data, message: "此筆付款已確認。" });
    }
    if (existingBooking.payment_status !== "pending_cash") {
      return NextResponse.json({ ok: false, error: "此筆付款目前不在待確認狀態。" }, { status: 409 });
    }

    const now = new Date().toISOString();
    const updateResult = await admin
      .from("trial_bookings")
      .update({
        payment_status: "paid",
        paid_at: now,
        updated_at: now,
      })
      .eq("id", bookingId)
      .eq("payment_method", "cash_on_site")
      .eq("payment_status", "pending_cash")
      .select(TRIAL_BOOKING_SELECT)
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json({ ok: false, error: updateResult.error.message }, { status: 500 });
    }
    if (updateResult.data) {
      return NextResponse.json({ ok: true, booking: updateResult.data, message: "現場收款已確認。" });
    }

    const latestResult = await admin
      .from("trial_bookings")
      .select(TRIAL_BOOKING_SELECT)
      .eq("id", bookingId)
      .maybeSingle();
    if (latestResult.error) {
      return NextResponse.json({ ok: false, error: latestResult.error.message }, { status: 500 });
    }
    const latestBooking = latestResult.data as unknown as TrialBookingPaymentRow | null;
    if (latestBooking?.payment_status === "paid") {
      return NextResponse.json({ ok: true, booking: latestResult.data, message: "此筆付款已確認。" });
    }

    return NextResponse.json({ ok: false, error: "付款狀態已由其他操作更新，請重新整理後確認。" }, { status: 409 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "確認現場收款失敗。" },
      { status: 500 },
    );
  }
}
