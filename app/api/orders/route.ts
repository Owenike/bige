import { NextResponse } from "next/server";
import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../lib/auth-context";
import { claimIdempotency, finalizeIdempotency } from "../../../lib/idempotency";
import { requirePermission } from "../../../lib/permissions";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ok<TData extends Record<string, unknown>>(data: TData) {
  return apiSuccess(data);
}

function fail(
  status: number,
  code: "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_ERROR" | "BRANCH_SCOPE_DENIED",
  message: string,
) {
  return apiError(status, code, message);
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "orders.read");
  if (!permission.ok) return permission.response;

  if (!auth.context.tenantId) {
    return fail(400, "FORBIDDEN", "Invalid tenant context");
  }
  if (auth.context.role === "frontdesk" && !auth.context.branchId) {
    return fail(403, "BRANCH_SCOPE_DENIED", "Missing branch context for frontdesk");
  }

  let query = auth.supabase
    .from("orders")
    .select("id, member_id, amount, status, channel, note, created_at, updated_at, branch_id")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (auth.context.role === "frontdesk" && auth.context.branchId) {
    query = query.eq("branch_id", auth.context.branchId);
  }

  const { data, error } = await query;

  if (error) return fail(500, "INTERNAL_ERROR", error.message);
  return ok({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "orders.write");
  if (!permission.ok) return permission.response;
  if (auth.context.role === "frontdesk" && !auth.context.branchId) {
    return fail(403, "BRANCH_SCOPE_DENIED", "Missing branch context for frontdesk");
  }

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const rawMemberId = typeof body?.memberId === "string" ? body.memberId.trim() : "";
  const memberId = rawMemberId ? rawMemberId : null;
  const amount = Number(body?.amount ?? 0);
  const subtotal = Number(body?.subtotal ?? amount);
  const discountAmount = Number(body?.discountAmount ?? 0);
  const discountNote = typeof body?.discountNote === "string" ? body.discountNote.trim() : "";
  const managerOverride = body?.managerOverride === true;
  const channel = body?.channel === "online" ? "online" : "frontdesk";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const idempotencyKeyInput = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!auth.context.tenantId || Number.isNaN(amount) || amount <= 0) {
    return fail(400, "FORBIDDEN", "Invalid amount or tenant context");
  }
  if (memberId && !isUuid(memberId)) {
    return fail(400, "FORBIDDEN", "memberId must be a valid UUID");
  }
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return fail(400, "FORBIDDEN", "Invalid subtotal");
  }
  if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal) {
    return fail(400, "FORBIDDEN", "Invalid discountAmount");
  }
  const computedAmount = Number((subtotal - discountAmount).toFixed(2));
  if (Math.abs(computedAmount - amount) > 0.01) {
    return fail(400, "FORBIDDEN", "amount does not match subtotal - discountAmount");
  }
  const discountRate = subtotal > 0 ? discountAmount / subtotal : 0;
  const requiresManagerOverride = discountAmount > 0 && (discountAmount >= 500 || discountRate >= 0.2);
  if (auth.context.role === "frontdesk" && requiresManagerOverride && !managerOverride) {
    return fail(409, "FORBIDDEN", "High discount requires manager override");
  }

  if (memberId) {
    const memberResult = await auth.supabase
      .from("members")
      .select("id, store_id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", memberId)
      .maybeSingle();

    if (memberResult.error) return fail(500, "INTERNAL_ERROR", memberResult.error.message);
    if (!memberResult.data) return fail(404, "FORBIDDEN", "Member not found");
    if (
      auth.context.role === "frontdesk" &&
      auth.context.branchId &&
      String(memberResult.data.store_id || "") !== auth.context.branchId
    ) {
      return fail(403, "BRANCH_SCOPE_DENIED", "Forbidden member access for current branch");
    }
  }

  const persistedNote = [
    note || "",
    discountAmount > 0 ? `discount:${discountAmount}` : "",
    discountNote ? `discount_note:${discountNote}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const operationKey =
    idempotencyKeyInput ||
    ["order_create", auth.context.tenantId, memberId || "walkin", amount.toFixed(2), channel, persistedNote || "na"].join(":");
  const operationClaim = await claimIdempotency({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    operationKey,
    actorId: auth.context.userId,
    ttlMinutes: 30,
  });
  if (!operationClaim.ok) return fail(500, "INTERNAL_ERROR", operationClaim.error);
  if (!operationClaim.claimed) {
    if (operationClaim.existing?.status === "succeeded" && operationClaim.existing.response) {
      return ok({ replayed: true, ...operationClaim.existing.response });
    }
    return fail(409, "FORBIDDEN", "Duplicate order create request in progress");
  }

  const { data, error } = await auth.supabase
    .from("orders")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      member_id: memberId,
      amount,
      status: "confirmed",
      channel,
      note: persistedNote || null,
      created_by: auth.context.userId,
    })
    .select("id, amount, status, channel, note")
    .maybeSingle();

  if (error) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      operationKey,
      status: "failed",
      errorCode: "ORDER_INSERT_FAILED",
    });
    return fail(500, "INTERNAL_ERROR", error.message);
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "order_created",
    target_type: "order",
    target_id: data?.id ? String(data.id) : null,
    reason: discountNote || null,
    payload: {
      memberId,
      amount,
      subtotal,
      discountAmount,
      discountRate,
      requiresManagerOverride,
      managerOverride,
      channel,
      note: note || null,
    },
  });

  const successPayload = { order: data };
  await finalizeIdempotency({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    operationKey,
    status: "succeeded",
    response: successPayload as Record<string, unknown>,
  });

  return NextResponse.json(
    {
      ok: true,
      data: successPayload,
      order: data,
    },
    { status: 201 },
  );
}
