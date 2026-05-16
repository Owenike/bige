import { apiError, apiSuccess } from "../../../../lib/auth-context";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}

function isValidDate(value: string) {
  return value && !Number.isNaN(new Date(value).getTime());
}

function publicBookingError(message: string) {
  if (message === "service_name_required") return "Service name is required";
  if (message === "customer_name_required") return "Customer name is required";
  if (message === "customer_phone_required") return "Customer phone is required";
  if (message === "invalid_booking_time") return "Invalid booking time";
  if (message === "booking_must_be_future") return "Booking must be in the future";
  if (message === "booking_branch_not_found") return "Booking branch not found";
  if (message === "coach_not_available") return "Coach is not available";
  if (message === "coach_time_conflict") return "Coach time conflicts with another booking";
  return "Booking creation failed";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const serviceName = text(body?.serviceName);
  const coachId = nullableText(body?.coachId);
  const startsAt = text(body?.startsAt);
  const endsAt = text(body?.endsAt);
  const note = nullableText(body?.note);
  const contactName = text(body?.contactName);
  const contactPhone = text(body?.contactPhone);
  const contactEmail = nullableText(body?.contactEmail);
  const branchId = nullableText(body?.branchId);
  const branchCode = nullableText(body?.branchCode);

  if (!serviceName) return apiError(400, "FORBIDDEN", "Service name is required");
  if (!contactName) return apiError(400, "FORBIDDEN", "Customer name is required");
  if (!contactPhone) return apiError(400, "FORBIDDEN", "Customer phone is required");
  if (!isValidDate(startsAt)) return apiError(400, "FORBIDDEN", "Invalid start time");
  if (!isValidDate(endsAt)) return apiError(400, "FORBIDDEN", "Invalid end time");
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return apiError(400, "FORBIDDEN", "endsAt must be after startsAt");
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient(request);
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Supabase client initialization failed");
  }

  const { data, error } = await supabase.rpc("create_public_booking", {
    p_branch_id: branchId,
    p_branch_code: branchCode,
    p_service_name: serviceName,
    p_coach_id: coachId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_note: note,
    p_customer_name: contactName,
    p_customer_phone: contactPhone,
    p_customer_email: contactEmail,
  });

  if (error) {
    return apiError(400, "FORBIDDEN", publicBookingError(error.message));
  }

  const booking = Array.isArray(data) ? data[0] : data;
  return apiSuccess({ booking });
}
