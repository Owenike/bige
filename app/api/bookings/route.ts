import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../lib/auth-context";
import { checkMemberEligibility } from "../../../lib/entitlement-eligibility";

function parseRoomFromNote(note: string | null) {
  if (!note) return "";
  const match = note.match(/\[room:([^\]]+)\]/i);
  return match?.[1]?.trim() || "";
}

function isMissingCoachBlocksTable(message: string) {
  return (
    message.includes('relation "coach_blocks" does not exist') ||
    message.includes("Could not find the table 'public.coach_blocks' in the schema cache")
  );
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

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = auth.supabase
    .from("bookings")
    .select("id, member_id, coach_id, service_name, starts_at, ends_at, status, note")
    .eq("tenant_id", auth.context.tenantId)
    .order("starts_at", { ascending: true })
    .limit(100);

  if (from) query = query.gte("starts_at", from);
  if (to) query = query.lte("starts_at", to);
  if (auth.context.role === "coach") query = query.eq("coach_id", auth.context.userId);
  if (auth.context.role === "frontdesk" && auth.context.branchId) query = query.eq("branch_id", auth.context.branchId);

  const { data, error } = await query;
  if (error) return apiError(500, "INTERNAL_ERROR", error.message);

  return apiSuccess({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  const coachId = typeof body?.coachId === "string" ? body.coachId : null;
  const serviceName = typeof body?.serviceName === "string" ? body.serviceName.trim() : "";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : "";
  const note = typeof body?.note === "string" ? body.note : null;

  if (!memberId || !serviceName || !startsAt || !endsAt) {
    return apiError(400, "FORBIDDEN", "Missing required fields");
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return apiError(400, "FORBIDDEN", "endsAt must be after startsAt");
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", memberId)
    .maybeSingle();
  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (!memberResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");
  if (auth.context.branchId && memberResult.data.store_id && memberResult.data.store_id !== auth.context.branchId) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden member access for current branch");
  }

  const eligibility = await checkMemberEligibility({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    memberId,
    branchId: auth.context.branchId ?? memberResult.data.store_id ?? null,
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

  const memberOverlap = await auth.supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", memberId)
    .in("status", ["booked", "checked_in"])
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt)
    .limit(1)
    .maybeSingle();
  if (memberOverlap.error) return apiError(500, "INTERNAL_ERROR", memberOverlap.error.message);
  if (memberOverlap.data) {
    return apiError(400, "FORBIDDEN", "Member time overlaps with another booking");
  }

  const room = parseRoomFromNote(note);
  if (room) {
    const roomCandidates = await auth.supabase
      .from("bookings")
      .select("id, note")
      .eq("tenant_id", auth.context.tenantId)
      .in("status", ["booked", "checked_in"])
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt)
      .limit(200);
    if (roomCandidates.error) return apiError(500, "INTERNAL_ERROR", roomCandidates.error.message);
    const roomConflict = (roomCandidates.data || []).find(
      (item: { note: string | null }) => parseRoomFromNote(item.note || null) === room,
    );
    if (roomConflict) {
      return apiError(400, "FORBIDDEN", "Room time overlaps with another booking");
    }
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

    const coachBlock = await auth.supabase
      .from("coach_blocks")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("coach_id", coachId)
      .eq("status", "active")
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt)
      .limit(1)
      .maybeSingle();
    if (coachBlock.error && !isMissingCoachBlocksTable(coachBlock.error.message)) {
      return apiError(500, "INTERNAL_ERROR", coachBlock.error.message);
    }
    if (!coachBlock.error && coachBlock.data) {
      return apiError(400, "FORBIDDEN", "Coach is blocked in this time range");
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
      member_id: memberId,
      coach_id: coachId,
      service_name: serviceName,
      starts_at: startsAt,
      ends_at: endsAt,
      note,
      created_by: auth.context.userId,
    })
    .select("id, status, starts_at, ends_at")
    .maybeSingle();

  if (error) return apiError(500, "INTERNAL_ERROR", error.message);

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "booking_create",
    target_type: "booking",
    target_id: String(data?.id || ""),
    reason: "booking_create",
    payload: {
      memberId,
      coachId,
      serviceName,
      startsAt,
      endsAt,
      selectedContractId: eligibility.candidate?.contractId ?? null,
      selectedPassId: eligibility.candidate?.passId ?? null,
    },
  });

  return apiSuccess({ booking: data, eligibility });
}
