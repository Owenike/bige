import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

const CANCEL_OR_RESCHEDULE_LOCK_MINUTES = 120;

const BUSINESS_ERROR_STATUS: Record<string, number> = {
  reason_required: 400,
  booking_not_found: 404,
  booking_not_modifiable: 400,
  booking_locked_for_modification: 400,
  reschedule_time_required: 400,
  invalid_reschedule_range: 400,
  reschedule_must_be_future: 400,
  booking_time_overlap: 400,
};

function mapRpcError(message: string | undefined) {
  if (!message) return { status: 500, error: "Booking update failed" };
  const status = BUSINESS_ERROR_STATUS[message];
  if (status) return { status, error: message };
  return { status: 500, error: message };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Tenant context is required" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action === "reschedule" ? "reschedule" : "cancel";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : null;
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : null;

  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { data, error } = await auth.supabase.rpc("member_modify_booking", {
    p_tenant_id: auth.context.tenantId,
    p_booking_id: id,
    p_member_id: memberResult.data.id,
    p_actor_id: auth.context.userId,
    p_action: action,
    p_reason: reason,
    p_starts_at: action === "reschedule" ? startsAt : null,
    p_ends_at: action === "reschedule" ? endsAt : null,
    p_lock_minutes: CANCEL_OR_RESCHEDULE_LOCK_MINUTES,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const booking = Array.isArray(data) ? data[0] : null;
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  return NextResponse.json({ booking });
}
