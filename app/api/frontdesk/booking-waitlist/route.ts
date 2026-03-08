import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../../lib/auth-context";
import { checkMemberEligibility } from "../../../../lib/entitlement-eligibility";

function isMissingWaitlistTable(message: string) {
  return (
    message.includes('relation "booking_waitlist" does not exist') ||
    message.includes("Could not find the table 'public.booking_waitlist' in the schema cache")
  );
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeTime(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const params = new URL(request.url).searchParams;
  const date = normalizeDate(params.get("date"));
  const status = (params.get("status") || "").trim();
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 20)));

  let query = auth.supabase
    .from("booking_waitlist")
    .select("id, member_id, contact_name, contact_phone, desired_date, desired_time, note, status, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (date) query = query.eq("desired_date", date);
  if (status) query = query.eq("status", status);
  if (auth.context.role === "frontdesk" && auth.context.branchId) query = query.eq("branch_id", auth.context.branchId);

  const { data, error } = await query;
  if (error) {
    if (isMissingWaitlistTable(error.message)) {
      return apiSuccess({ items: [], warning: "booking_waitlist table missing" });
    }
    return apiError(500, "INTERNAL_ERROR", error.message);
  }

  const items = (data || []) as Array<{
    id: string;
    member_id: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    desired_date: string | null;
    desired_time: string | null;
    note: string | null;
    status: string | null;
    created_at: string | null;
  }>;

  const memberIds = Array.from(
    new Set(
      items
        .map((item) => item.member_id || "")
        .filter((value) => value.length > 0),
    ),
  );
  const eligibilityByMember = new Map<string, Awaited<ReturnType<typeof checkMemberEligibility>>>();
  for (const memberId of memberIds) {
    const eligibility = await checkMemberEligibility({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      memberId,
      branchId: auth.context.branchId ?? null,
      scenario: "booking",
      serviceName: "coach_session",
      coachId: null,
    });
    eligibilityByMember.set(memberId, eligibility);
  }

  return apiSuccess({
    items: items.map((item) => ({
      id: item.id,
      memberId: item.member_id,
      contactName: item.contact_name,
      contactPhone: item.contact_phone,
      desiredDate: item.desired_date,
      desiredTime: item.desired_time,
      note: item.note,
      status: item.status,
      createdAt: item.created_at,
      eligibility: item.member_id ? eligibilityByMember.get(item.member_id) ?? null : null,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const memberId = typeof body?.memberId === "string" ? body.memberId.trim() : null;
  const contactName = typeof body?.contactName === "string" ? body.contactName.trim() : "";
  const contactPhone = typeof body?.contactPhone === "string" ? body.contactPhone.trim() : null;
  const desiredDate = normalizeDate(body?.desiredDate);
  const desiredTime = normalizeTime(body?.desiredTime);
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

  if (!contactName) return apiError(400, "FORBIDDEN", "contactName is required");

  let eligibility: Awaited<ReturnType<typeof checkMemberEligibility>> | null = null;
  if (memberId) {
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
    eligibility = await checkMemberEligibility({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      memberId,
      branchId: auth.context.branchId ?? memberResult.data.store_id ?? null,
      scenario: "booking",
      serviceName: "coach_session",
      coachId: null,
    });
  }

  const insert = await auth.supabase
    .from("booking_waitlist")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      member_id: memberId || null,
      contact_name: contactName,
      contact_phone: contactPhone || null,
      desired_date: desiredDate,
      desired_time: desiredTime,
      note,
      status: "pending",
      created_by: auth.context.userId,
    })
    .select("id, member_id, contact_name, contact_phone, desired_date, desired_time, note, status, created_at")
    .maybeSingle();
  if (insert.error) {
    if (isMissingWaitlistTable(insert.error.message)) {
      return apiError(409, "FORBIDDEN", "booking_waitlist table missing");
    }
    return apiError(500, "INTERNAL_ERROR", insert.error.message);
  }

  await auth.supabase
    .from("audit_logs")
    .insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "booking_waitlist_create",
      target_type: "booking_waitlist",
      target_id: insert.data?.id || null,
      reason: note,
      payload: {
        memberId,
        contactName,
        contactPhone,
        desiredDate,
        desiredTime,
        note,
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
    item: {
      ...(insert.data || {}),
      eligibility,
    },
  });
}
