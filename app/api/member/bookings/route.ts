import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { checkMemberEligibility } from "../../../../lib/entitlement-eligibility";

export async function GET(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "Tenant context is required");
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");
  }

  const status = new URL(request.url).searchParams.get("status");

  let query = auth.supabase
    .from("bookings")
    .select("id, coach_id, service_name, starts_at, ends_at, status, note")
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", memberResult.data.id)
    .order("starts_at", { ascending: true })
    .limit(100);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return apiError(500, "INTERNAL_ERROR", error.message);

  return apiSuccess({ items: data ?? [] });
}

function eligibilityStatusFromCode(code: string) {
  if (code === "BRANCH_SCOPE_DENIED") return 403;
  if (code === "ENTITLEMENT_NOT_FOUND") return 404;
  if (code === "PLAN_INACTIVE") return 409;
  if (code === "ENTITLEMENT_EXPIRED") return 409;
  if (code === "ENTITLEMENT_EXHAUSTED") return 409;
  if (code === "CONTRACT_STATE_INVALID") return 409;
  if (code === "NO_MATCHING_ENTITLEMENT") return 409;
  return 409;
}

export async function POST(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const coachId = typeof body?.coachId === "string" ? body.coachId : null;
  const serviceName = typeof body?.serviceName === "string" ? body.serviceName.trim() : "";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : "";
  const note = typeof body?.note === "string" ? body.note : null;

  if (!serviceName || !startsAt || !endsAt || !auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "Missing required fields");
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return apiError(400, "FORBIDDEN", "endsAt must be after startsAt");
  }

  if (new Date(startsAt).getTime() <= Date.now()) {
    return apiError(400, "FORBIDDEN", "Booking must be in the future");
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");
  }

  const eligibility = await checkMemberEligibility({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    memberId: memberResult.data.id,
    branchId: (typeof memberResult.data.store_id === "string" ? memberResult.data.store_id : null) || auth.context.branchId,
    scenario: "booking",
    serviceName,
    coachId,
  });
  if (!eligibility.eligible) {
    const denialCode = eligibility.reasonCode === "OK" ? "ELIGIBILITY_DENIED" : eligibility.reasonCode;
    return apiError(
      eligibilityStatusFromCode(denialCode),
      denialCode,
      eligibility.message,
    );
  }

  const overlapResult = await auth.supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", memberResult.data.id)
    .in("status", ["booked", "checked_in"])
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt)
    .limit(1)
    .maybeSingle();

  if (overlapResult.error) return apiError(500, "INTERNAL_ERROR", overlapResult.error.message);
  if (overlapResult.data) {
    return apiError(400, "FORBIDDEN", "Booking time overlaps with existing booking");
  }

  if (coachId) {
    const coachOverlap = await auth.supabase
      .from("bookings")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("coach_id", coachId)
      .in("status", ["booked", "checked_in"])
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt)
      .limit(1)
      .maybeSingle();
    if (coachOverlap.error) return apiError(500, "INTERNAL_ERROR", coachOverlap.error.message);
    if (coachOverlap.data) {
      return apiError(400, "FORBIDDEN", "Coach time overlaps with another booking");
    }

    const slotResult = await auth.supabase
      .from("coach_slots")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("coach_id", coachId)
      .eq("status", "active")
      .lte("starts_at", startsAt)
      .gte("ends_at", endsAt)
      .limit(1)
      .maybeSingle();

    if (slotResult.error && !slotResult.error.message.includes('relation "coach_slots" does not exist')) {
      return apiError(500, "INTERNAL_ERROR", slotResult.error.message);
    }
    if (!slotResult.error && !slotResult.data) {
      return apiError(400, "FORBIDDEN", "Coach is unavailable (no matching schedule slot)");
    }
  }

  const { data, error } = await auth.supabase
    .from("bookings")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId ?? memberResult.data.store_id ?? null,
      member_id: memberResult.data.id,
      coach_id: coachId,
      service_name: serviceName,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "booked",
      note,
      created_by: auth.context.userId,
    })
    .select("id, coach_id, service_name, starts_at, ends_at, status, note")
    .maybeSingle();

  if (error) return apiError(500, "INTERNAL_ERROR", error.message);

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "member_booking_create",
    target_type: "booking",
    target_id: String(data?.id || ""),
    payload: {
      startsAt,
      endsAt,
      serviceName,
      eligibility: {
        code: eligibility.reasonCode,
        selectedContractId: eligibility.candidate?.contractId ?? null,
      },
    },
  });

  return apiSuccess({ booking: data, eligibility });
}
