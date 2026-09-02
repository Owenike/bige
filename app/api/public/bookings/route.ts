import { NextResponse } from "next/server";
import { apiError, apiSuccess } from "../../../../lib/auth-context";
import { sendLineBookingNotification } from "../../../../lib/line-push";
import { rateLimitShared } from "../../../../lib/rate-limit";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const GENDER_OPTIONS = new Set(["男性", "女性"]);
const DAY_TYPE_OPTIONS = new Set(["平日", "假日", "都可以"]);
const TIME_SLOT_OPTIONS = new Set(["下午", "晚上", "都可以"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}

function normalizeDate(value: unknown) {
  const normalized = text(value);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function publicBookingError(message: string) {
  if (message === "customer_name_required") return "請填寫姓名";
  if (message === "customer_gender_required") return "請選擇性別";
  if (message === "customer_phone_required") return "請填寫手機號碼";
  if (message === "customer_birthdate_required") return "請選擇出生年月日";
  if (message === "preferred_day_type_required") return "請選擇可預約日期";
  if (message === "preferred_time_slot_required") return "請選擇可預約時段";
  if (message === "invalid_birthdate") return "出生年月日格式不正確";
  if (message === "booking_branch_not_found") return "找不到可預約分店";
  return "預約需求送出失敗，請稍後再試，或直接聯繫櫃台協助。";
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipLimit = await rateLimitShared({
    key: `public-booking:create:ip:${ip}`,
    limit: 12,
    windowMs: 60 * 60 * 1000,
  });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "送出次數過多，請稍後再試，或直接聯繫櫃台協助。" },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
    );
  }

  const body = await request.json().catch(() => null);
  const contactName = text(body?.contactName);
  const gender = text(body?.gender);
  const contactPhone = text(body?.contactPhone);
  const birthdate = normalizeDate(body?.birthdate);
  const preferredDayType = text(body?.preferredDayType);
  const preferredTimeSlot = text(body?.preferredTimeSlot);
  const note = nullableText(body?.note);

  if (!contactName) return apiError(400, "FORBIDDEN", "請填寫姓名");
  if (!GENDER_OPTIONS.has(gender)) return apiError(400, "FORBIDDEN", "請選擇性別");
  if (!contactPhone) return apiError(400, "FORBIDDEN", "請填寫手機號碼");
  if (birthdate === "") return apiError(400, "FORBIDDEN", "出生年月日格式不正確");
  if (!birthdate) return apiError(400, "FORBIDDEN", "請選擇出生年月日");
  if (!DAY_TYPE_OPTIONS.has(preferredDayType)) return apiError(400, "FORBIDDEN", "請選擇可預約日期");
  if (!TIME_SLOT_OPTIONS.has(preferredTimeSlot)) return apiError(400, "FORBIDDEN", "請選擇可預約時段");

  const phoneLimit = await rateLimitShared({
    key: `public-booking:create:phone:${contactPhone.replace(/\D/g, "")}`,
    limit: 4,
    windowMs: 60 * 60 * 1000,
  });
  if (!phoneLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "這個手機號碼送出次數過多，請稍後再試，或直接聯繫櫃台協助。" },
      { status: 429, headers: { "Retry-After": String(phoneLimit.retryAfterSec) } },
    );
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Supabase client initialization failed");
  }

  const { data, error } = await supabase.rpc("create_public_booking_request", {
    p_customer_name: contactName,
    p_customer_gender: gender,
    p_customer_phone: contactPhone,
    p_customer_birthdate: birthdate,
    p_preferred_day_type: preferredDayType,
    p_preferred_time_slot: preferredTimeSlot,
    p_note: note,
  });

  if (error) {
    return apiError(400, "FORBIDDEN", publicBookingError(error.message));
  }

  const requestItem = Array.isArray(data) ? data[0] : data;
  await sendLineBookingNotification({
    customerName: contactName,
    customerGender: gender,
    customerPhone: contactPhone,
    customerBirthdate: birthdate,
    preferredDayType,
    preferredTimeSlot,
    note,
  });

  return apiSuccess({ request: requestItem });
}
