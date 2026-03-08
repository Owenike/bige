import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { checkMemberEligibility } from "../../../../lib/entitlement-eligibility";

function isMissingSyncTable(message: string) {
  return (
    message.includes('relation "booking_sync_jobs" does not exist') ||
    message.includes("Could not find the table 'public.booking_sync_jobs' in the schema cache")
  );
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 20)));
  const { data, error } = await auth.supabase
    .from("booking_sync_jobs")
    .select("id, booking_id, provider, event_type, status, payload, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingSyncTable(error.message)) {
      return apiSuccess({ items: [], warning: "booking_sync_jobs table missing" });
    }
    return apiError(500, "INTERNAL_ERROR", error.message);
  }

  const jobs = (data || []) as Array<{
    id: string;
    booking_id: string | null;
    provider: string | null;
    event_type: string | null;
    status: string | null;
    payload: Record<string, unknown> | null;
    created_at: string | null;
    updated_at: string | null;
  }>;
  const bookingIds = Array.from(
    new Set(
      jobs
        .map((job) => job.booking_id || "")
        .filter((value) => value.length > 0),
    ),
  );

  const bookingMemberMap = new Map<string, { memberId: string; branchId: string | null; serviceName: string | null; coachId: string | null }>();
  if (bookingIds.length > 0) {
    const bookingsResult = await auth.supabase
      .from("bookings")
      .select("id, member_id, branch_id, service_name, coach_id")
      .eq("tenant_id", auth.context.tenantId)
      .in("id", bookingIds);
    if (bookingsResult.error) return apiError(500, "INTERNAL_ERROR", bookingsResult.error.message);
    for (const row of (bookingsResult.data || []) as Array<{
      id: string;
      member_id: string | null;
      branch_id: string | null;
      service_name: string | null;
      coach_id: string | null;
    }>) {
      if (!row.member_id) continue;
      bookingMemberMap.set(row.id, {
        memberId: row.member_id,
        branchId: row.branch_id ?? null,
        serviceName: row.service_name ?? null,
        coachId: row.coach_id ?? null,
      });
    }
  }

  const eligibilityByBooking = new Map<string, Awaited<ReturnType<typeof checkMemberEligibility>>>();
  for (const [bookingId, detail] of bookingMemberMap.entries()) {
    const eligibility = await checkMemberEligibility({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      memberId: detail.memberId,
      branchId: auth.context.branchId ?? detail.branchId,
      scenario: "booking",
      serviceName: detail.serviceName,
      coachId: detail.coachId,
    });
    eligibilityByBooking.set(bookingId, eligibility);
  }

  return apiSuccess({
    items: jobs.map((job) => ({
      id: job.id,
      bookingId: job.booking_id,
      provider: job.provider,
      eventType: job.event_type,
      status: job.status,
      payload: job.payload,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      eligibility: job.booking_id ? eligibilityByBooking.get(job.booking_id) ?? null : null,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const body = await request.json().catch(() => null);
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
  const provider = typeof body?.provider === "string" ? body.provider.trim() : "google_calendar";
  const eventType = typeof body?.eventType === "string" ? body.eventType.trim() : "upsert";
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

  if (!bookingId) return apiError(400, "FORBIDDEN", "bookingId is required");

  const bookingResult = await auth.supabase
    .from("bookings")
    .select("id, member_id, branch_id, service_name, coach_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingResult.error) return apiError(500, "INTERNAL_ERROR", bookingResult.error.message);
  if (!bookingResult.data) return apiError(404, "FORBIDDEN", "Booking not found");
  if (auth.context.branchId && bookingResult.data.branch_id && bookingResult.data.branch_id !== auth.context.branchId) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden booking access for current branch");
  }

  const eligibility =
    typeof bookingResult.data.member_id === "string" && bookingResult.data.member_id
      ? await checkMemberEligibility({
          supabase: auth.supabase,
          tenantId: auth.context.tenantId,
          memberId: bookingResult.data.member_id,
          branchId: auth.context.branchId ?? bookingResult.data.branch_id ?? null,
          scenario: "booking",
          serviceName: bookingResult.data.service_name ?? null,
          coachId: bookingResult.data.coach_id ?? null,
        })
      : null;

  const insert = await auth.supabase
    .from("booking_sync_jobs")
    .insert({
      tenant_id: auth.context.tenantId,
      booking_id: bookingId,
      provider,
      event_type: eventType,
      payload,
      status: "queued",
      created_by: auth.context.userId,
    })
    .select("id, booking_id, provider, event_type, status, payload, created_at, updated_at")
    .maybeSingle();

  if (insert.error) {
    if (isMissingSyncTable(insert.error.message)) {
      return apiError(409, "FORBIDDEN", "booking_sync_jobs table missing");
    }
    return apiError(500, "INTERNAL_ERROR", insert.error.message);
  }

  await auth.supabase
    .from("audit_logs")
    .insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "booking_sync_queue",
      target_type: "booking",
      target_id: bookingId,
      reason: `${provider}:${eventType}`,
      payload: {
        ...payload,
        eligibility: eligibility
          ? {
              eligible: eligibility.eligible,
              reasonCode: eligibility.reasonCode,
              selectedContractId: eligibility.candidate?.contractId ?? null,
            }
          : null,
      },
    })
    .catch(() => null);

  return apiSuccess({
    job: insert.data,
    eligibility,
  });
}
