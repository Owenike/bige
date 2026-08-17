import { NextResponse } from "next/server";
import { requireTrialBookingAdmin } from "../../../../../lib/trial-booking-admin-auth";
import { resolveTrialFaHistoryCustomer } from "../../../../../lib/trial-booking-fa-history";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

function coachLabel(profile: {
  english_name?: string | null;
  display_name?: string | null;
  employee_number?: string | null;
} | null) {
  return profile?.english_name?.trim()
    || profile?.display_name?.trim()
    || profile?.employee_number?.trim()
    || null;
}

export async function GET(request: Request) {
  try {
    const auth = await requireTrialBookingAdmin(request);
    if (!auth.ok) return authFailureResponse(auth.response.status);

    const requestedTenantId = new URL(request.url).searchParams.get("tenantId")?.trim() || null;
    const tenantId = auth.context.role === "platform_admin"
      ? requestedTenantId || auth.context.tenantId
      : auth.context.tenantId;
    const admin = createSupabaseAdminClient();

    let historyQuery = admin
      .from("bookings")
      .select(
        "id, tenant_id, member_id, coach_id, trial_booking_id, service_name, course_type, trial_stage, starts_at, ends_at, note, status_updated_at, updated_at",
      )
      .eq("is_bige_schedule", true)
      .eq("operation_kind", "trial")
      .eq("status", "completed")
      .eq("trial_conversion_outcome", "not_converted")
      .lte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: false })
      .limit(500);

    if (tenantId) historyQuery = historyQuery.eq("tenant_id", tenantId);

    const historyResult = await historyQuery;
    if (historyResult.error) {
      return NextResponse.json({ ok: false, error: historyResult.error.message }, { status: 500 });
    }

    const historyRows = historyResult.data || [];
    const trialBookingIds = [
      ...new Set(historyRows.map((row) => row.trial_booking_id).filter((value): value is string => Boolean(value))),
    ];
    const memberIds = [
      ...new Set(historyRows.map((row) => row.member_id).filter((value): value is string => Boolean(value))),
    ];
    const coachIds = [
      ...new Set(historyRows.map((row) => row.coach_id).filter((value): value is string => Boolean(value))),
    ];

    const [trialBookingsResult, membersResult, coachesResult] = await Promise.all([
      trialBookingIds.length > 0
        ? admin
            .from("trial_bookings")
            .select(
              "id, created_at, name, phone, birthday, service, source, booking_coach, executing_coach, appointment_date, appointment_time, note, schedule_note",
            )
            .in("id", trialBookingIds)
        : Promise.resolve({ data: [], error: null }),
      memberIds.length > 0
        ? admin
            .from("members")
            .select("id, full_name, phone, birth_date, member_code")
            .in("id", memberIds)
        : Promise.resolve({ data: [], error: null }),
      coachIds.length > 0
        ? admin
            .from("profiles")
            .select("id, english_name, display_name, employee_number")
            .in("id", coachIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const result of [trialBookingsResult, membersResult, coachesResult]) {
      if (result.error) {
        return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
      }
    }

    const trialBookings = new Map((trialBookingsResult.data || []).map((row) => [row.id, row]));
    const members = new Map((membersResult.data || []).map((row) => [row.id, row]));
    const coaches = new Map((coachesResult.data || []).map((row) => [row.id, row]));

    const items = historyRows.map((row) => {
      const trialBooking = row.trial_booking_id
        ? trialBookings.get(row.trial_booking_id) || null
        : null;
      const member = row.member_id ? members.get(row.member_id) || null : null;
      const customer = resolveTrialFaHistoryCustomer({ trialBooking, member });

      return {
        id: row.id,
        trialBookingId: row.trial_booking_id,
        ...customer,
        service: trialBooking?.service || row.course_type || row.service_name || "trial",
        trialStage: row.trial_stage,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        recordedAt: row.status_updated_at || row.updated_at,
        bookingCoach: trialBooking?.booking_coach || null,
        executingCoach: coachLabel(row.coach_id ? coaches.get(row.coach_id) || null : null)
          || trialBooking?.executing_coach
          || null,
        source: trialBooking?.source || null,
        originalAppointmentDate: trialBooking?.appointment_date || null,
        originalAppointmentTime: trialBooking?.appointment_time || null,
        originalNote: trialBooking?.note || null,
        scheduleNote: trialBooking?.schedule_note || null,
        operationNote: row.note || null,
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load FA history" },
      { status: 500 },
    );
  }
}
