import { NextResponse } from "next/server";
import { z } from "zod";
import { sendLineTrialBookingNotification } from "../../../../lib/line-push";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const serviceValues = ["weight_training", "boxing_fitness", "pilates", "sports_massage"] as const;
const preferredTimeValues = [
  "weekday_morning",
  "weekday_afternoon",
  "weekday_evening",
  "weekend_morning",
  "weekend_afternoon",
  "weekend_evening",
  "other",
] as const;
const paymentMethodValues = ["cash_on_site", "online_payment"] as const;

const trialBookingSchema = z.object({
  name: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(1).max(30),
  lineName: z.string().trim().max(80).optional().default(""),
  service: z.enum(serviceValues),
  preferredTime: z.enum(preferredTimeValues),
  paymentMethod: z.enum(paymentMethodValues),
  note: z.string().trim().max(500).optional().default(""),
});

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function serviceLabel(value: (typeof serviceValues)[number]) {
  if (value === "weight_training") return "重量訓練";
  if (value === "boxing_fitness") return "拳擊體能訓練";
  if (value === "pilates") return "器械皮拉提斯";
  return "運動按摩";
}

function preferredTimeLabel(value: (typeof preferredTimeValues)[number]) {
  const labels: Record<(typeof preferredTimeValues)[number], string> = {
    weekday_morning: "平日上午",
    weekday_afternoon: "平日下午",
    weekday_evening: "平日晚上",
    weekend_morning: "假日上午",
    weekend_afternoon: "假日下午",
    weekend_evening: "假日晚上",
    other: "其他時段",
  };
  return labels[value];
}

function paymentMethodLabel(value: (typeof paymentMethodValues)[number]) {
  return value === "cash_on_site" ? "現場付款" : "線上付款";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "請提供有效的預約資料。");
  }

  const parsed = trialBookingSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "請確認必填欄位與資料格式是否正確。");
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase admin client initialization failed");
  }

  const paymentStatus = parsed.data.paymentMethod === "cash_on_site" ? "pending_cash" : "pending_payment";

  const insertResult = await admin
    .from("trial_bookings")
    .insert({
      name: parsed.data.name,
      phone: parsed.data.phone,
      line_name: parsed.data.lineName || null,
      service: parsed.data.service,
      preferred_time: parsed.data.preferredTime,
      note: parsed.data.note || null,
      payment_method: parsed.data.paymentMethod,
      payment_status: paymentStatus,
      amount: null,
      currency: "TWD",
      source: "website_trial_booking",
      booking_status: "new",
    })
    .select("id, payment_method, payment_status, booking_status")
    .maybeSingle();

  if (insertResult.error) {
    return jsonError(500, insertResult.error.message);
  }

  if (!insertResult.data) {
    return jsonError(500, "建立首次體驗預約失敗。");
  }

  console.info("[trial-booking] created booking", {
    bookingId: insertResult.data.id,
    paymentMethod: insertResult.data.payment_method,
    paymentStatus: insertResult.data.payment_status,
  });

  const lineResult = await sendLineTrialBookingNotification({
    bookingId: insertResult.data.id,
    name: parsed.data.name,
    phone: parsed.data.phone,
    lineName: parsed.data.lineName,
    service: serviceLabel(parsed.data.service),
    preferredTime: preferredTimeLabel(parsed.data.preferredTime),
    paymentMethod: paymentMethodLabel(parsed.data.paymentMethod),
    note: parsed.data.note,
  });

  if (!lineResult.ok) {
    console.warn("[trial-booking] line notification did not complete", {
      status: lineResult.status,
      error: lineResult.error,
      skipped: lineResult.skipped,
    });
  }

  return NextResponse.json({
    ok: true,
    booking: {
      id: insertResult.data.id,
      paymentMethod: insertResult.data.payment_method,
      paymentStatus: insertResult.data.payment_status,
      bookingStatus: insertResult.data.booking_status,
    },
  });
}
