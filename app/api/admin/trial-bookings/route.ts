import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTrialBookingAdmin } from "../../../../lib/trial-booking-admin-auth";
import {
  trialBookingCoachLabel,
  trialBookingCoachOptions,
  type TrialBookingCoachProfile,
} from "../../../../lib/trial-booking-coaches";
import {
  bookingMatchesWorkflowGroup,
  parseTrialBookingWorkflowGroup,
  parseTrialPaymentStatusFilter,
} from "../../../../lib/trial-booking-filters";
import { sendLineScheduledTrialBookingNotification } from "../../../../lib/line-push";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import {
  trialBookingSourceLabel,
  trialBookingSourceValues,
} from "../../../../lib/trial-booking-sources";

const paymentMethods = new Set(["cash_on_site", "online_payment"]);
const sources = new Set<string>(trialBookingSourceValues);
const serviceValues = [
  "weight_training",
  "boxing_fitness",
  "pilates",
  "sports_massage",
  "onsite_assessment",
] as const;
const sourceValues = trialBookingSourceValues;
const arrangedBookingStatuses = ["scheduled", "completed", "no_show"] as const;
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
  "staff_note",
  "staff_note_updated_at",
  "staff_note_updated_by",
  "updated_at",
].join(", ");

const adminBookingCreateSchema = z.object({
  appointmentDate: z.string().trim().regex(dateInputPattern),
  appointmentTime: z.string().trim().regex(timeInputPattern).refine((value) => appointmentTimeValues.has(value)),
  service: z.enum(serviceValues),
  name: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(1).max(30),
  bookingCoach: z.string().trim().min(1).max(50),
  executingCoachId: z.string().uuid(),
  executingCoach: z.string().trim().max(50).optional().default(""),
  source: z.enum(sourceValues),
  note: z.string().trim().max(500).optional().default(""),
});

function readEnumParam(searchParams: URLSearchParams, name: string, allowed: Set<string>) {
  const value = searchParams.get(name)?.trim();
  if (!value || !allowed.has(value)) return null;
  return value;
}

function escapeIlikeValue(value: string) {
  return value.replace(/[%_]/g, (match) => `\\${match}`).replace(/[(),]/g, " ");
}

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

function contactOperatorLabel(profile: {
  english_name?: string | null;
  display_name?: string | null;
  employee_number?: string | null;
} | null) {
  return profile?.english_name?.trim()
    || profile?.display_name?.trim()
    || profile?.employee_number?.trim()
    || "未知人員";
}

function trialAmount(value: (typeof serviceValues)[number]) {
  return value === "sports_massage" ? 1500 : 880;
}

function lineError(result: { error?: string; skipped?: boolean; status?: number }) {
  if (result.skipped) return "missing_line_env";
  if (result.status) return `line_push_failed_${result.status}`;
  return (result.error || "line_push_failed").slice(0, 220);
}

function emptyStats() {
  return {
    total: 0,
    website: 0,
    websiteScheduled: 0,
    websiteRegistration: 0,
    officialLine: 0,
    walkIn: 0,
    phoneBooking: 0,
    br: 0,
  };
}

function nextDateInputValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  return nextDate.toISOString().slice(0, 10);
}

function updatedAtRange(fromDate: string | null, toDate: string | null) {
  if (!fromDate || !toDate || !dateInputPattern.test(fromDate) || !dateInputPattern.test(toDate) || fromDate > toDate) {
    return null;
  }

  return {
    fromInclusive: `${fromDate}T00:00:00+08:00`,
    toExclusive: `${nextDateInputValue(toDate)}T00:00:00+08:00`,
  };
}

async function loadStats(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  fromDate: string | null,
  toDate: string | null,
  dateBasis: "appointment_date" | "updated_at",
) {
  if (!fromDate || !toDate || !dateInputPattern.test(fromDate) || !dateInputPattern.test(toDate) || fromDate > toDate) {
    return emptyStats();
  }

  let query = admin
    .from("trial_bookings")
    .select("id, source, booking_status")
    .not("appointment_date", "is", null)
    .in("booking_status", arrangedBookingStatuses);

  const marketingRange = dateBasis === "updated_at" ? updatedAtRange(fromDate, toDate) : null;
  if (dateBasis === "updated_at") {
    if (!marketingRange) return emptyStats();
    query = query
      .gte("updated_at", marketingRange.fromInclusive)
      .lt("updated_at", marketingRange.toExclusive);
  } else {
    query = query
      .gte("appointment_date", fromDate)
      .lte("appointment_date", toDate);
  }

  const websiteRegistrationQuery = marketingRange
    ? admin
        .from("trial_bookings")
        .select("id", { count: "exact", head: true })
        .eq("source", "website")
        .gte("created_at", marketingRange.fromInclusive)
        .lt("created_at", marketingRange.toExclusive)
    : Promise.resolve({ count: 0, error: null });

  const [result, websiteRegistrationResult] = await Promise.all([
    query.limit(10000),
    websiteRegistrationQuery,
  ]);

  if (result.error) throw result.error;
  if (websiteRegistrationResult.error) throw websiteRegistrationResult.error;

  const stats = emptyStats();
  stats.websiteRegistration = websiteRegistrationResult.count || 0;
  for (const row of result.data || []) {
    const source = typeof row.source === "string" ? row.source : "website";
    if (dateBasis === "updated_at" && source === "legacy_schedule_import") continue;
    stats.total += 1;
    if (source === "official_line") stats.officialLine += 1;
    else if (source === "walk_in") stats.walkIn += 1;
    else if (source === "phone_booking") stats.phoneBooking += 1;
    else if (source === "br") stats.br += 1;
    else {
      stats.website += 1;
      if (row.booking_status === "scheduled") stats.websiteScheduled += 1;
    }
  }
  return stats;
}

export async function GET(request: Request) {
  try {
    const auth = await requireTrialBookingAdmin(request);
    if (!auth.ok) return authFailureResponse(auth.response.status);

    const url = new URL(request.url);
    const searchParams = url.searchParams;
    const paymentMethod = readEnumParam(searchParams, "paymentMethod", paymentMethods);
    const paymentStatus = parseTrialPaymentStatusFilter(searchParams.get("paymentStatus"));
    const workflowGroup = parseTrialBookingWorkflowGroup(searchParams.get("workflowGroup"));
    const source = readEnumParam(searchParams, "source", sources);
    const statsFrom = searchParams.get("statsFrom")?.trim() || null;
    const statsTo = searchParams.get("statsTo")?.trim() || null;
    const q = (searchParams.get("q") || "").trim().slice(0, 80);

    const admin = createSupabaseAdminClient();
    const isMarketingReport = workflowGroup === "marketing_report";
    let query = admin
      .from("trial_bookings")
      .select(TRIAL_BOOKING_SELECT)
      .neq("booking_status", "cancelled");

    query = isMarketingReport
      ? query.order("updated_at", { ascending: false })
      : query.order("created_at", { ascending: false });

    query = query.limit(500);

    if (isMarketingReport) {
      const range = updatedAtRange(statsFrom, statsTo);
      query = query
        .not("appointment_date", "is", null)
        .in("booking_status", arrangedBookingStatuses);

      query = range
        ? query.gte("updated_at", range.fromInclusive).lt("updated_at", range.toExclusive)
        : query.eq("id", "00000000-0000-0000-0000-000000000000");
    }

    if (paymentMethod) query = query.eq("payment_method", paymentMethod);
    if (paymentStatus) query = query.eq("payment_status", paymentStatus);
    if (source) query = query.eq("source", source);
    if (q) {
      const escapedQ = escapeIlikeValue(q);
      query = query.or(`name.ilike.%${escapedQ}%,phone.ilike.%${escapedQ}%,line_name.ilike.%${escapedQ}%`);
    }

    const tenantId = auth.context.tenantId;
    const coachesQuery = tenantId
      ? admin
          .from("profiles")
          .select("id, display_name, english_name, branch_id")
          .eq("tenant_id", tenantId)
          .or("role.in.(coach,therapist),department.eq.coaching")
          .eq("is_active", true)
          .order("english_name", { ascending: true, nullsFirst: false })
          .order("display_name", { ascending: true })
      : Promise.resolve({ data: [], error: null });

    const [result, stats, coachesResult] = await Promise.all([
      query,
      loadStats(admin, statsFrom, statsTo, isMarketingReport ? "updated_at" : "appointment_date"),
      coachesQuery,
    ]);

    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
    }
    if (coachesResult.error) {
      return NextResponse.json({ ok: false, error: coachesResult.error.message }, { status: 500 });
    }

    const bookingRows = (result.data || []) as unknown as Array<Record<string, unknown> & {
      id: string;
      booking_status: Parameters<typeof bookingMatchesWorkflowGroup>[0]["bookingStatus"];
      appointment_date: string | null;
    }>;
    const bookingIds = bookingRows.map((booking) => booking.id);
    const contactHistoryByBooking = new Map<string, Array<{
      id: string;
      note: string;
      contacted_at: string;
      contacted_by: string | null;
      operator_label: string;
    }>>();

    if (bookingIds.length > 0) {
      let contactLogsQuery = admin
        .from("trial_booking_contact_logs")
        .select("id, trial_booking_id, note, contacted_by, contacted_at")
        .in("trial_booking_id", bookingIds)
        .order("contacted_at", { ascending: false });

      if (tenantId) contactLogsQuery = contactLogsQuery.eq("tenant_id", tenantId);

      const contactLogsResult = await contactLogsQuery;
      if (contactLogsResult.error) {
        return NextResponse.json({ ok: false, error: contactLogsResult.error.message }, { status: 500 });
      }

      const operatorIds = Array.from(new Set(
        (contactLogsResult.data || [])
          .map((log) => log.contacted_by)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ));
      const operatorProfilesResult = operatorIds.length > 0
        ? await admin
            .from("profiles")
            .select("id, english_name, display_name, employee_number")
            .in("id", operatorIds)
        : { data: [], error: null };

      if (operatorProfilesResult.error) {
        return NextResponse.json({ ok: false, error: operatorProfilesResult.error.message }, { status: 500 });
      }

      const operatorProfiles = new Map(
        (operatorProfilesResult.data || []).map((profile) => [profile.id, profile]),
      );

      for (const log of contactLogsResult.data || []) {
        const current = contactHistoryByBooking.get(log.trial_booking_id) || [];
        current.push({
          id: log.id,
          note: log.note,
          contacted_at: log.contacted_at,
          contacted_by: log.contacted_by,
          operator_label: contactOperatorLabel(
            typeof log.contacted_by === "string" ? operatorProfiles.get(log.contacted_by) || null : null,
          ),
        });
        contactHistoryByBooking.set(log.trial_booking_id, current);
      }
    }

    const coaches = trialBookingCoachOptions(
      (coachesResult.data || []) as TrialBookingCoachProfile[],
    );

    const bookings = bookingRows.map((booking) => ({
      ...booking,
      contact_history: contactHistoryByBooking.get(booking.id) || [],
    })).filter((booking) => bookingMatchesWorkflowGroup({
      bookingStatus: booking.booking_status,
      appointmentDate: booking.appointment_date,
      contactHistoryCount: booking.contact_history.length,
    }, workflowGroup)).slice(0, 100);

    return NextResponse.json({ ok: true, bookings, stats, coaches });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load trial bookings" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireTrialBookingAdmin(request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const body = await request.json().catch(() => null);
  const parsed = adminBookingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "請確認必填欄位與資料格式是否正確。" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const data = parsed.data;
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
    const executingCoachLabel = trialBookingCoachLabel(
      coachResult.data as TrialBookingCoachProfile,
    );
    const insertResult = await admin
      .from("trial_bookings")
      .insert({
        name: data.name,
        phone: data.phone,
        line_name: null,
        service: data.service,
        preferred_time: "other",
        note: data.note || null,
        payment_method: "cash_on_site",
        payment_status: "pending_cash",
        amount: trialAmount(data.service),
        currency: "TWD",
        source: data.source,
        booking_status: "scheduled",
        appointment_date: data.appointmentDate,
        appointment_time: data.appointmentTime,
        booking_coach: data.bookingCoach,
        executing_coach: executingCoachLabel,
        line_notification_status: "not_sent",
      })
      .select(TRIAL_BOOKING_SELECT)
      .maybeSingle();

    if (insertResult.error) {
      return NextResponse.json({ ok: false, error: insertResult.error.message }, { status: 500 });
    }
    if (!insertResult.data) {
      return NextResponse.json({ ok: false, error: "建立體驗預約失敗。" }, { status: 500 });
    }
    const insertedBooking = insertResult.data as unknown as { id: string } & Record<string, unknown>;

    const lineResult = await sendLineScheduledTrialBookingNotification({
      appointmentDate: data.appointmentDate,
      appointmentTime: data.appointmentTime,
      service: serviceLabel(data.service),
      name: data.name,
      phone: data.phone,
      bookingCoach: data.bookingCoach,
      executingCoach: executingCoachLabel,
      source: trialBookingSourceLabel(data.source),
      note: data.note,
    });

    const lineOk = lineResult.ok && !lineResult.skipped;
    const updateResult = await admin
      .from("trial_bookings")
      .update({
        line_notification_status: lineOk ? "sent" : "failed",
        line_notified_at: lineOk ? new Date().toISOString() : null,
        line_notification_error: lineOk ? null : lineError(lineResult),
      })
      .eq("id", insertedBooking.id)
      .select(TRIAL_BOOKING_SELECT)
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json({ ok: false, error: updateResult.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      booking: updateResult.data || insertedBooking,
      lineNotification: lineOk ? "sent" : "failed",
      message: lineOk ? "體驗預約已建立並發送 LINE 通知。" : "資料已儲存，但 LINE 通知發送失敗。",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "建立體驗預約失敗。" },
      { status: 500 },
    );
  }
}
