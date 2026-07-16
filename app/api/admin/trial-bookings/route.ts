import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "../../../../lib/auth-context";
import { sendLineScheduledTrialBookingNotification } from "../../../../lib/line-push";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const paymentMethods = new Set(["cash_on_site", "online_payment"]);
const paymentStatuses = new Set(["pending_cash", "pending_payment", "paid", "failed", "cancelled"]);
const bookingStatuses = new Set(["new", "contacted", "scheduled", "completed", "cancelled", "no_show"]);
const sources = new Set(["website", "official_line", "walk_in"]);
const serviceValues = ["weight_training", "boxing_fitness", "pilates", "sports_massage"] as const;
const sourceValues = ["website", "official_line", "walk_in"] as const;
const dateInputPattern = /^\d{4}-\d{2}-\d{2}$/;
const timeInputPattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

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

const adminBookingCreateSchema = z.object({
  appointmentDate: z.string().trim().regex(dateInputPattern),
  appointmentTime: z.string().trim().regex(timeInputPattern),
  service: z.enum(serviceValues),
  name: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(1).max(30),
  bookingCoach: z.string().trim().min(1).max(50),
  executingCoach: z.string().trim().min(1).max(50),
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
  return value;
}

function sourceLabel(value: string) {
  if (value === "official_line") return "官方 LINE";
  if (value === "walk_in") return "現場";
  return "網站";
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
    officialLine: 0,
    walkIn: 0,
  };
}

async function loadStats(admin: ReturnType<typeof createSupabaseAdminClient>, fromDate: string | null, toDate: string | null) {
  if (!fromDate || !toDate || !dateInputPattern.test(fromDate) || !dateInputPattern.test(toDate) || fromDate > toDate) {
    return emptyStats();
  }

  const result = await admin
    .from("trial_bookings")
    .select("id, source")
    .not("appointment_date", "is", null)
    .gte("appointment_date", fromDate)
    .lte("appointment_date", toDate)
    .limit(10000);

  if (result.error) throw result.error;

  const stats = emptyStats();
  for (const row of result.data || []) {
    const source = typeof row.source === "string" ? row.source : "website";
    stats.total += 1;
    if (source === "official_line") stats.officialLine += 1;
    else if (source === "walk_in") stats.walkIn += 1;
    else stats.website += 1;
  }
  return stats;
}

export async function GET(request: Request) {
  try {
    const auth = await requireProfile(["platform_admin", "manager"], request);
    if (!auth.ok) return authFailureResponse(auth.response.status);

    const url = new URL(request.url);
    const searchParams = url.searchParams;
    const paymentMethod = readEnumParam(searchParams, "paymentMethod", paymentMethods);
    const paymentStatus = readEnumParam(searchParams, "paymentStatus", paymentStatuses);
    const bookingStatus = readEnumParam(searchParams, "bookingStatus", bookingStatuses);
    const source = readEnumParam(searchParams, "source", sources);
    const statsFrom = searchParams.get("statsFrom")?.trim() || null;
    const statsTo = searchParams.get("statsTo")?.trim() || null;
    const q = (searchParams.get("q") || "").trim().slice(0, 80);

    const admin = createSupabaseAdminClient();
    let query = admin
      .from("trial_bookings")
      .select(TRIAL_BOOKING_SELECT)
      .order("created_at", { ascending: false })
      .limit(100);

    if (paymentMethod) query = query.eq("payment_method", paymentMethod);
    if (paymentStatus) query = query.eq("payment_status", paymentStatus);
    if (bookingStatus) query = query.eq("booking_status", bookingStatus);
    if (source) query = query.eq("source", source);
    if (q) {
      const escapedQ = escapeIlikeValue(q);
      query = query.or(`name.ilike.%${escapedQ}%,phone.ilike.%${escapedQ}%,line_name.ilike.%${escapedQ}%`);
    }

    const [result, stats] = await Promise.all([query, loadStats(admin, statsFrom, statsTo)]);

    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, bookings: result.data || [], stats });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load trial bookings" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const body = await request.json().catch(() => null);
  const parsed = adminBookingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "請確認必填欄位與資料格式是否正確。" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const data = parsed.data;
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
        executing_coach: data.executingCoach,
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
      executingCoach: data.executingCoach,
      source: sourceLabel(data.source),
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
