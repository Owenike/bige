import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "../../../../../../lib/auth-context";
import { sendLineScheduledTrialBookingNotification } from "../../../../../../lib/line-push";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

const serviceValues = ["weight_training", "boxing_fitness", "pilates", "sports_massage"] as const;
const dateInputPattern = /^\d{4}-\d{2}-\d{2}$/;
const timeInputPattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const scheduleSchema = z.object({
  appointmentDate: z.string().trim().regex(dateInputPattern),
  appointmentTime: z.string().trim().regex(timeInputPattern),
  service: z.enum(serviceValues),
  name: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(1).max(30),
  bookingCoach: z.string().trim().min(1).max(50),
  executingCoach: z.string().trim().min(1).max(50),
  note: z.string().trim().max(500).optional().default(""),
});

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

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

function serviceLabel(value: string) {
  if (value === "weight_training") return "重量訓練";
  if (value === "boxing_fitness") return "拳擊體能訓練";
  if (value === "pilates") return "器械皮拉提斯";
  if (value === "sports_massage") return "運動按摩";
  return value;
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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const { id } = await context.params;
  const bookingId = typeof id === "string" ? id.trim() : "";
  if (!bookingId || !uuidPattern.test(bookingId)) {
    return NextResponse.json({ ok: false, error: "Invalid booking id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "請確認必填欄位與資料格式是否正確。" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const existingResult = await admin
      .from("trial_bookings")
      .select("id, booking_status, source, line_notification_status")
      .eq("id", bookingId)
      .maybeSingle();

    if (existingResult.error) {
      return NextResponse.json({ ok: false, error: existingResult.error.message }, { status: 500 });
    }
    if (!existingResult.data) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    const data = parsed.data;
    const shouldSendLine =
      existingResult.data.booking_status !== "scheduled" &&
      existingResult.data.line_notification_status !== "sent";

    const updateResult = await admin
      .from("trial_bookings")
      .update({
        name: data.name,
        phone: data.phone,
        service: data.service,
        note: data.note || null,
        source: existingResult.data.source || "website",
        booking_status: "scheduled",
        appointment_date: data.appointmentDate,
        appointment_time: data.appointmentTime,
        booking_coach: data.bookingCoach,
        executing_coach: data.executingCoach,
        line_notification_error: shouldSendLine ? null : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId)
      .select(TRIAL_BOOKING_SELECT)
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json({ ok: false, error: updateResult.error.message }, { status: 500 });
    }
    if (!updateResult.data) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }
    const updatedBooking = updateResult.data as unknown as { source: string | null };

    if (!shouldSendLine) {
      return NextResponse.json({
        ok: true,
        booking: updateResult.data,
        lineNotification: "not_sent",
        message: "預約資料已更新。",
      });
    }

    const lineResult = await sendLineScheduledTrialBookingNotification({
      appointmentDate: data.appointmentDate,
      appointmentTime: data.appointmentTime,
      service: serviceLabel(data.service),
      name: data.name,
      phone: data.phone,
      bookingCoach: data.bookingCoach,
      executingCoach: data.executingCoach,
      source: sourceLabel(updatedBooking.source),
      note: data.note,
    });

    const lineOk = lineResult.ok && !lineResult.skipped;
    const lineUpdateResult = await admin
      .from("trial_bookings")
      .update({
        line_notification_status: lineOk ? "sent" : "failed",
        line_notified_at: lineOk ? new Date().toISOString() : null,
        line_notification_error: lineOk ? null : lineError(lineResult),
      })
      .eq("id", bookingId)
      .select(TRIAL_BOOKING_SELECT)
      .maybeSingle();

    if (lineUpdateResult.error) {
      return NextResponse.json({ ok: false, error: lineUpdateResult.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      booking: lineUpdateResult.data || updateResult.data,
      lineNotification: lineOk ? "sent" : "failed",
      message: lineOk ? "預約資料已更新並發送 LINE 通知。" : "資料已儲存，但 LINE 通知發送失敗。",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "安排體驗預約失敗。" },
      { status: 500 },
    );
  }
}
