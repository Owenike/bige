import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeBigeScheduleEndAt } from "../../../../../../lib/bige-fitness";
import { requireTrialBookingAdmin } from "../../../../../../lib/trial-booking-admin-auth";
import {
  trialBookingCoachLabel,
  type TrialBookingCoachProfile,
} from "../../../../../../lib/trial-booking-coaches";
import { sendLineScheduledTrialBookingNotification } from "../../../../../../lib/line-push";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";
import {
  createTrialBookingScheduleNotePatch,
  TRIAL_BOOKING_SCHEDULE_NOTE_MAX_LENGTH,
} from "../../../../../../lib/trial-booking-schedule-note";
import { trialBookingSourceLabel } from "../../../../../../lib/trial-booking-sources";

const serviceValues = [
  "weight_training",
  "boxing_fitness",
  "pilates",
  "sports_massage",
  "onsite_assessment",
] as const;
const dateInputPattern = /^\d{4}-\d{2}-\d{2}$/;
const timeInputPattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const appointmentTimeValues = new Set(
  Array.from({ length: 27 }, (_, index) => {
    const totalMinutes = 9 * 60 + index * 30;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }),
);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const scheduleSchema = z.object({
  appointmentDate: z.string().trim().regex(dateInputPattern),
  appointmentTime: z.string().trim().regex(timeInputPattern).refine((value) => appointmentTimeValues.has(value)),
  service: z.enum(serviceValues),
  name: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(1).max(30),
  bookingCoach: z.string().trim().min(1).max(50),
  executingCoachId: z.string().uuid(),
  executingCoach: z.string().trim().max(50).optional().default(""),
  scheduleNote: z.string().trim().max(TRIAL_BOOKING_SCHEDULE_NOTE_MAX_LENGTH).optional().default(""),
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
  "schedule_note",
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
  if (value === "onsite_assessment") return "現場評估";
  return value;
}

function lineError(result: { error?: string; skipped?: boolean; status?: number }) {
  if (result.skipped) return "missing_line_env";
  if (result.status) return `line_push_failed_${result.status}`;
  return (result.error || "line_push_failed").slice(0, 220);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTrialBookingAdmin(request);
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

    const tenantId = auth.context.tenantId;
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Missing tenant context" }, { status: 400 });
    }
    const coachResult = await admin
      .from("profiles")
      .select("id, branch_id, display_name, english_name")
      .eq("tenant_id", tenantId)
      .eq("id", data.executingCoachId)
      .or("role.in.(coach,therapist),department.eq.coaching")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (coachResult.error) {
      return NextResponse.json({ ok: false, error: coachResult.error.message }, { status: 500 });
    }
    if (!coachResult.data) {
      return NextResponse.json(
        { ok: false, error: "找不到所選教練帳號，請重新選擇執行教練。" },
        { status: 400 },
      );
    }
    const selectedCoach = coachResult.data as TrialBookingCoachProfile;
    const executingCoachLabel = trialBookingCoachLabel(selectedCoach);

    const startsAt = `${data.appointmentDate}T${data.appointmentTime}:00+08:00`;
    const endsAt = normalizeBigeScheduleEndAt("trial", startsAt, startsAt);
    const courseType =
      data.service === "pilates"
        ? "reformer_pilates"
        : data.service === "sports_massage"
          ? "relaxation"
          : data.service === "onsite_assessment"
            ? "onsite_assessment"
            : "weight_training";
    const existingSchedule = await auth.supabase
      .from("bookings")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("trial_booking_id", bookingId)
      .eq("is_bige_schedule", true)
      .in("status", ["pending", "confirmed", "booked", "checked_in"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingSchedule.error) {
      return NextResponse.json({ ok: false, error: existingSchedule.error.message }, { status: 500 });
    }

    const scheduleResult = existingSchedule.data
      ? await auth.supabase.rpc("bige_reschedule_schedule_booking_v2", {
          p_booking_id: existingSchedule.data.id,
          p_branch_id: coachResult.data.branch_id || auth.context.branchId,
          p_coach_id: coachResult.data.id,
          p_course_type: courseType,
          p_starts_at: startsAt,
          p_ends_at: endsAt,
          p_note: data.scheduleNote || null,
        })
      : await auth.supabase.rpc("bige_create_schedule_booking_v2", {
          p_tenant_id: tenantId,
          p_branch_id: coachResult.data.branch_id || auth.context.branchId,
          p_member_id: null,
          p_trial_booking_id: bookingId,
          p_coach_id: coachResult.data.id,
          p_operation_kind: "trial",
          p_course_type: courseType,
          p_starts_at: startsAt,
          p_ends_at: endsAt,
          p_note: data.scheduleNote || null,
          p_group_id: null,
          p_idempotency_key: `trial-admin-schedule:${bookingId}`,
        });
    if (scheduleResult.error) {
      return NextResponse.json(
        { ok: false, error: scheduleResult.error.message.split("\n")[0] || "無法加入教練日表" },
        { status: 409 },
      );
    }
    const scheduleWarnings = Array.isArray(
      (scheduleResult.data as { warnings?: unknown } | null)?.warnings,
    )
      ? ((scheduleResult.data as { warnings: Array<{ code?: string }> }).warnings || [])
      : [];
    const hasClassroomConflict = scheduleWarnings.some(
      (warning) => warning?.code === "classroom_conflict",
    );

    const updateResult = await admin
      .from("trial_bookings")
      .update({
        name: data.name,
        phone: data.phone,
        service: data.service,
        ...createTrialBookingScheduleNotePatch(data.scheduleNote),
        source: existingResult.data.source || "website",
        booking_status: "scheduled",
        appointment_date: data.appointmentDate,
        appointment_time: data.appointmentTime,
        booking_coach: data.bookingCoach,
        executing_coach: executingCoachLabel,
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
        warnings: scheduleWarnings,
        message: hasClassroomConflict
          ? "預約資料已更新；此時段有教室衝突，請到課表確認。"
          : "預約資料已更新。",
      });
    }

    const lineResult = await sendLineScheduledTrialBookingNotification({
      appointmentDate: data.appointmentDate,
      appointmentTime: data.appointmentTime,
      service: serviceLabel(data.service),
      name: data.name,
      phone: data.phone,
      bookingCoach: data.bookingCoach,
      executingCoach: executingCoachLabel,
      source: trialBookingSourceLabel(updatedBooking.source),
      note: data.scheduleNote,
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
      warnings: scheduleWarnings,
      message: hasClassroomConflict
        ? lineOk
          ? "預約資料已更新並發送 LINE 通知；此時段有教室衝突，請到課表確認。"
          : "資料已儲存；此時段有教室衝突，且 LINE 通知發送失敗。"
        : lineOk
          ? "預約資料已更新並發送 LINE 通知。"
          : "資料已儲存，但 LINE 通知發送失敗。",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "安排體驗預約失敗。" },
      { status: 500 },
    );
  }
}
