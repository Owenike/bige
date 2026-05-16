import { apiError, apiSuccess } from "../../../../lib/auth-context";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

const GENDER_OPTIONS = new Set(["女性", "男性", "不方便透露"]);
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
  if (message === "customer_name_required") return "請輸入姓名";
  if (message === "customer_gender_required") return "請選擇性別";
  if (message === "customer_phone_required") return "請輸入手機號碼";
  if (message === "preferred_day_type_required") return "請選擇可預約日期";
  if (message === "preferred_time_slot_required") return "請選擇可預約時段";
  if (message === "invalid_birthdate") return "出生年月日格式不正確";
  if (message === "booking_branch_not_found") return "找不到可預約分店";
  return "預約需求送出失敗，請稍後再試，或直接聯繫櫃台協助。";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const contactName = text(body?.contactName);
  const gender = text(body?.gender);
  const contactPhone = text(body?.contactPhone);
  const birthdate = normalizeDate(body?.birthdate);
  const preferredDayType = text(body?.preferredDayType);
  const preferredTimeSlot = text(body?.preferredTimeSlot);
  const note = nullableText(body?.note);

  if (!contactName) return apiError(400, "FORBIDDEN", "請輸入姓名");
  if (!GENDER_OPTIONS.has(gender)) return apiError(400, "FORBIDDEN", "請選擇性別");
  if (!contactPhone) return apiError(400, "FORBIDDEN", "請輸入手機號碼");
  if (birthdate === "") return apiError(400, "FORBIDDEN", "出生年月日格式不正確");
  if (!DAY_TYPE_OPTIONS.has(preferredDayType)) return apiError(400, "FORBIDDEN", "請選擇可預約日期");
  if (!TIME_SLOT_OPTIONS.has(preferredTimeSlot)) return apiError(400, "FORBIDDEN", "請選擇可預約時段");

  let supabase;
  try {
    supabase = await createSupabaseServerClient(request);
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
  return apiSuccess({ request: requestItem });
}
