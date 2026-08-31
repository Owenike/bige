import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { isCoachDayStatusNote } from "../../../../lib/bige-coach-day-status";
import {
  bigePersonalMonthRange,
  collectBigePersonalMonthDayStatuses,
  isBigePersonalMonth,
} from "../../../../lib/bige-personal-month-schedule";
import { shouldShowBigeScheduleBookingOnDailyBoard } from "../../../../lib/bige-fitness";
import { isScheduleTrashDeletedBooking } from "../../../../lib/bige-schedule-drag";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type PersonalMonthBookingRow = {
  id: string;
  branch_id: string | null;
  member_id: string | null;
  coach_id: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  status_reason: string | null;
  cancelled_at: string | null;
  note: string | null;
  operation_kind: string | null;
  course_type: string | null;
  trial_stage: string | null;
  operation_result: string | null;
  trial_conversion_outcome: string | null;
  bb_conversion_outcome: string | null;
  trial_booking_id: string | null;
  reminder_status: string | null;
  converted_at: string | null;
  operation_idempotency_key: string | null;
};

type PersonalMonthNoteRow = {
  id: string;
  branch_id: string | null;
  coach_id: string;
  starts_at: string;
  ends_at: string;
  content: string;
  source: string | null;
};

export async function GET(request: Request) {
  const auth = await requireProfile(["coach"], request);
  if (!auth.ok) return auth.response;
  if (auth.context.role !== "coach" && auth.context.role !== "therapist") {
    return apiError(403, "FORBIDDEN", "此頁只提供教練查看自己的整月課表");
  }
  if (!auth.context.tenantId) {
    return apiError(403, "FORBIDDEN", "找不到所屬場館");
  }

  const month = new URL(request.url).searchParams.get("month");
  if (!isBigePersonalMonth(month)) {
    return apiError(400, "FORBIDDEN", "月份格式錯誤");
  }

  const tenantId = auth.context.tenantId;
  const coachId = auth.context.userId;
  const range = bigePersonalMonthRange(month);
  let bookingsQuery = auth.supabase
    .from("bookings")
    .select(
      "id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, status_reason, cancelled_at, note, operation_kind, course_type, trial_stage, operation_result, trial_conversion_outcome, bb_conversion_outcome, trial_booking_id, reminder_status, converted_at, operation_idempotency_key",
    )
    .eq("tenant_id", tenantId)
    .eq("coach_id", coachId)
    .eq("is_bige_schedule", true)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at", { ascending: true });
  let notesQuery = auth.supabase
    .from("bige_schedule_notes")
    .select("id, branch_id, coach_id, starts_at, ends_at, content, source")
    .eq("tenant_id", tenantId)
    .eq("coach_id", coachId)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at", { ascending: true });

  if (auth.context.branchId) {
    bookingsQuery = bookingsQuery.eq("branch_id", auth.context.branchId);
    notesQuery = notesQuery.eq("branch_id", auth.context.branchId);
  }

  const [coachResult, bookingsResult, notesResult] = await Promise.all([
    auth.supabase
      .from("profiles")
      .select("id, display_name, english_name, employee_number, department, position")
      .eq("tenant_id", tenantId)
      .eq("id", coachId)
      .maybeSingle(),
    bookingsQuery,
    notesQuery,
  ]);

  if (coachResult.error || bookingsResult.error || notesResult.error) {
    console.error("[bige-personal-month] primary read failed", {
      coachId,
      month,
      coachError: coachResult.error?.message,
      bookingError: bookingsResult.error?.message,
      noteError: notesResult.error?.message,
    });
    return apiError(500, "INTERNAL_ERROR", "讀取個人整月課表失敗");
  }
  if (!coachResult.data) {
    return apiError(404, "FORBIDDEN", "找不到教練資料");
  }

  const rawBookings: PersonalMonthBookingRow[] = bookingsResult.data || [];
  const bookings = rawBookings.filter(
    (booking) =>
      !isScheduleTrashDeletedBooking(booking) &&
      shouldShowBigeScheduleBookingOnDailyBoard(booking),
  );
  const rawNotes: PersonalMonthNoteRow[] = notesResult.data || [];
  const dayStatuses = collectBigePersonalMonthDayStatuses(rawNotes, coachId);
  const notes = rawNotes.filter((note) => !isCoachDayStatusNote(note.content));
  const memberIds = [...new Set(bookings.map((booking) => booking.member_id).filter(Boolean))];
  const trialBookingIds = [
    ...new Set(bookings.map((booking) => booking.trial_booking_id).filter(Boolean)),
  ];
  const admin = createSupabaseAdminClient();
  const [membersResult, trialBookingsResult] = await Promise.all([
    memberIds.length
      ? admin
          .from("members")
          .select("id, full_name, phone, email, email_unavailable, birth_date, member_code, is_prospect")
          .eq("tenant_id", tenantId)
          .in("id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    trialBookingIds.length
      ? admin
          .from("trial_bookings")
          .select("id, name, phone, birthday, service")
          .eq("tenant_id", tenantId)
          .in("id", trialBookingIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (membersResult.error || trialBookingsResult.error) {
    console.error("[bige-personal-month] related read failed", {
      coachId,
      month,
      memberError: membersResult.error?.message,
      trialError: trialBookingsResult.error?.message,
    });
    return apiError(500, "INTERNAL_ERROR", "讀取個人整月課表學員資料失敗");
  }

  let members = membersResult.data || [];
  if (members.length > 0) {
    const legacyResult = await admin
      .from("bige_member_legacy_numbers")
      .select("member_id, legacy_number")
      .eq("tenant_id", tenantId)
      .in("member_id", members.map((member) => member.id));
    if (legacyResult.error) {
      console.error("[bige-personal-month] legacy member number read failed", {
        coachId,
        month,
        legacyError: legacyResult.error.message,
      });
      return apiError(500, "INTERNAL_ERROR", "讀取個人整月課表會員編號失敗");
    }
    const legacyNumbersByMember = new Map<string, string[]>();
    for (const row of legacyResult.data || []) {
      const values = legacyNumbersByMember.get(row.member_id) || [];
      values.push(row.legacy_number);
      legacyNumbersByMember.set(row.member_id, values);
    }
    members = members.map((member) => ({
      ...member,
      legacy_numbers: legacyNumbersByMember.get(member.id) || [],
      legacy_shared: false,
    }));
  }

  return apiSuccess({
    month,
    coach: coachResult.data,
    bookings,
    notes,
    dayStatuses,
    members,
    trialBookings: trialBookingsResult.data || [],
  });
}
