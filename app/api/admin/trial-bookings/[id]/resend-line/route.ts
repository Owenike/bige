import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../../lib/auth-context";
import { sendLineScheduledTrialBookingNotification } from "../../../../../../lib/line-push";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  "updated_at",
].join(", ");

type TrialBookingRow = {
  id: string;
  name: string | null;
  phone: string | null;
  service: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  booking_coach: string | null;
  executing_coach: string | null;
  source: string | null;
  note: string | null;
};

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

function serviceLabel(value: string | null | undefined) {
  if (value === "weight_training") return "重量訓練";
  if (value === "boxing_fitness") return "拳擊體能訓練";
  if (value === "pilates") return "器械皮拉提斯";
  if (value === "sports_massage") return "運動按摩";
  return value || "-";
}

function sourceLabel(value: string | null | undefined) {
  if (value === "official_line") return "官方 LINE";
  if (value === "walk_in") return "現場";
  return "網站";
}

function lineError(result: { error?: string; skipped?: boolean; status?: number }) {
  if (result.skipped) return "missing_line_env";
  if (result.status) return `line_push_failed_${result.status}`;
  return (result.error || "line_push_failed").slice(0, 220);
}

function isReadyForLine(row: TrialBookingRow) {
  return Boolean(
    row.appointment_date &&
      row.appointment_time &&
      row.name &&
      row.phone &&
      row.booking_coach &&
      row.executing_coach,
  );
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const { id } = await context.params;
  const bookingId = typeof id === "string" ? id.trim() : "";
  if (!bookingId || !uuidPattern.test(bookingId)) {
    return NextResponse.json({ ok: false, error: "Invalid booking id" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const existingResult = await admin.from("trial_bookings").select(TRIAL_BOOKING_SELECT).eq("id", bookingId).maybeSingle();
    if (existingResult.error) {
      return NextResponse.json({ ok: false, error: existingResult.error.message }, { status: 500 });
    }
    if (!existingResult.data) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    const booking = existingResult.data as unknown as TrialBookingRow;
    if (!isReadyForLine(booking)) {
      return NextResponse.json({ ok: false, error: "請先完成預約日期、時間、姓名、電話與教練欄位。" }, { status: 400 });
    }

    const lineResult = await sendLineScheduledTrialBookingNotification({
      appointmentDate: booking.appointment_date!,
      appointmentTime: booking.appointment_time!,
      service: serviceLabel(booking.service),
      name: booking.name!,
      phone: booking.phone!,
      bookingCoach: booking.booking_coach!,
      executingCoach: booking.executing_coach!,
      source: sourceLabel(booking.source),
      note: booking.note,
    });

    const lineOk = lineResult.ok && !lineResult.skipped;
    const updateResult = await admin
      .from("trial_bookings")
      .update({
        line_notification_status: lineOk ? "sent" : "failed",
        line_notified_at: lineOk ? new Date().toISOString() : null,
        line_notification_error: lineOk ? null : lineError(lineResult),
      })
      .eq("id", bookingId)
      .select(TRIAL_BOOKING_SELECT)
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json({ ok: false, error: updateResult.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      booking: updateResult.data || existingResult.data,
      lineNotification: lineOk ? "sent" : "failed",
      message: lineOk ? "LINE 通知已重新發送。" : "LINE 通知發送失敗，預約資料未受影響。",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "重新發送 LINE 通知失敗。" },
      { status: 500 },
    );
  }
}
