import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../lib/auth-context";
import { writeOperationalAudit } from "../../../lib/contracts-audit";
import { consumeSessionEntitlement } from "../../../lib/entitlement-consumption";
import { claimIdempotency, finalizeIdempotency } from "../../../lib/idempotency";
import { findOpenShiftForBranch, insertShiftItem } from "../../../lib/shift-reconciliation";

export async function GET(request: Request) {
  const auth = await requireProfile(
    ["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk", "coach"],
    request,
  );
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const memberId = new URL(request.url).searchParams.get("memberId");

  let query = auth.supabase
    .from("session_redemptions")
    .select(
      "id, booking_id, member_id, pass_id, member_plan_contract_id, session_no, redeemed_kind, quantity, note, created_at",
    )
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (memberId) query = query.eq("member_id", memberId);

  const result = await query;
  if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);
  return apiSuccess({ items: result.data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(
    ["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk", "coach"],
    request,
  );
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "memberId and tenant context are required");
  }

  const shiftGuard = await requireOpenShift({
    supabase: auth.supabase,
    context: auth.context,
    enforceRoles: ["frontdesk"],
  });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : null;
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  const passId = typeof body?.passId === "string" ? body.passId : null;
  const contractId = typeof body?.contractId === "string" ? body.contractId : null;
  const sessionNo = Number.isFinite(Number(body?.sessionNo)) ? Math.max(1, Number(body?.sessionNo)) : null;
  const note = typeof body?.note === "string" ? body.note : null;
  const quantity = Math.max(1, Number(body?.quantity ?? 1));
  const idempotencyKeyInput = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!memberId) return apiError(400, "FORBIDDEN", "memberId and tenant context are required");

  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id")
    .eq("id", memberId)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();
  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (!memberResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");
  if (auth.context.branchId) {
    if (!memberResult.data.store_id || auth.context.branchId !== memberResult.data.store_id) {
      return apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden member access for current branch");
    }
  }

  let bookingServiceName: string | null = null;
  let bookingCoachId: string | null = null;
  if (bookingId) {
    const bookingResult = await auth.supabase
      .from("bookings")
      .select("id, service_name, coach_id, branch_id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingResult.error) return apiError(500, "INTERNAL_ERROR", bookingResult.error.message);
    if (!bookingResult.data) return apiError(404, "FORBIDDEN", "Booking not found");
    if (auth.context.branchId && bookingResult.data.branch_id && bookingResult.data.branch_id !== auth.context.branchId) {
      return apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden booking access for current branch");
    }
    bookingServiceName =
      typeof bookingResult.data.service_name === "string" ? bookingResult.data.service_name : null;
    bookingCoachId = typeof bookingResult.data.coach_id === "string" ? bookingResult.data.coach_id : null;
  }

  const operationKey =
    idempotencyKeyInput ||
    [
      "session_redeem",
      auth.context.tenantId,
      memberId,
      bookingId || "na",
      sessionNo ?? "na",
      quantity,
      passId || contractId || "auto",
    ].join(":");
  const operationClaim = await claimIdempotency({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    operationKey,
    actorId: auth.context.userId,
    ttlMinutes: 60,
  });
  if (!operationClaim.ok) {
    return apiError(500, "INTERNAL_ERROR", operationClaim.error);
  }
  if (!operationClaim.claimed) {
    if (operationClaim.existing?.status === "succeeded" && operationClaim.existing.response) {
      return apiSuccess({
        replayed: true,
        ...operationClaim.existing.response,
      });
    }
    return apiError(409, "FORBIDDEN", "Duplicate redemption request in progress");
  }

  const consume = await consumeSessionEntitlement({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    memberId,
    actorId: auth.context.userId,
    branchId: auth.context.branchId ?? memberResult.data.store_id ?? null,
    bookingId,
    serviceName: bookingServiceName,
    coachId: bookingCoachId,
    quantity,
    sessionNo,
    note,
    preferredPassId: passId,
    preferredContractId: contractId,
  });
  if (!consume.ok) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      operationKey,
      status: "failed",
      errorCode: consume.code,
    });
    await writeOperationalAudit({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      action: "session_redemption_failed",
      targetType: "member",
      targetId: memberId,
      reason: consume.code,
      payload: {
        bookingId,
        quantity,
        sessionNo,
        passId,
        contractId,
        message: consume.message,
      },
    });
    return apiError(consume.status, consume.code, consume.message);
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "session_redeemed",
    target_type: "session_redemption",
    target_id: String(consume.data.redemption.redemption_id || ""),
    reason: note || null,
    payload: {
      bookingId,
      memberId,
      quantity,
      sessionNo,
      selectedContractId: consume.data.eligibility.candidate?.contractId ?? null,
      selectedPassId: consume.data.eligibility.candidate?.passId ?? null,
      eligibility: {
        eligible: consume.data.eligibility.eligible,
        reasonCode: consume.data.eligibility.reasonCode,
        usageBucket: consume.data.eligibility.usageBucket,
      },
    },
  });

  const successPayload = {
    redemption: consume.data.redemption,
    contract: consume.data.contract,
    eligibility: consume.data.eligibility,
  };
  await finalizeIdempotency({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    operationKey,
    status: "succeeded",
    response: successPayload as Record<string, unknown>,
  });

  let shiftId = shiftGuard.shift?.id ? String(shiftGuard.shift.id) : null;
  if (!shiftId) {
    const branchShift = await findOpenShiftForBranch({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      branchId: auth.context.branchId ?? memberResult.data.store_id ?? null,
    });
    if (branchShift.ok) shiftId = branchShift.shiftId;
  }
  await insertShiftItem({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    shiftId,
    kind: "note",
    refId: String(consume.data.redemption.redemption_id || ""),
    amount: null,
    summary: `session_redemption:${bookingId || "na"}:${quantity}`,
    eventType: "session_redeemed",
    quantity,
    metadata: {
      memberId,
      bookingId,
      sessionNo,
      selectedContractId: consume.data.eligibility.candidate?.contractId ?? null,
      selectedPassId: consume.data.eligibility.candidate?.passId ?? null,
    },
  }).catch(() => null);

  return apiSuccess(successPayload);
}
