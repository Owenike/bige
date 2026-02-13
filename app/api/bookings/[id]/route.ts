import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : null;
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : null;
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : null;
  const note = typeof body?.note === "string" ? body.note : null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  const allowedStatus =
    auth.context.role === "coach"
      ? ["checked_in", "completed", "no_show"]
      : ["booked", "checked_in", "completed", "cancelled", "no_show"];
  if (status && !allowedStatus.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  if (!reason) {
    return NextResponse.json({ error: "reason is required for booking updates" }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = {};
  if (status) updatePayload.status = status;
  if (startsAt) updatePayload.starts_at = startsAt;
  if (endsAt) updatePayload.ends_at = endsAt;
  if (note !== null) updatePayload.note = note;
  updatePayload.updated_at = new Date().toISOString();

  let query = auth.supabase
    .from("bookings")
    .update(updatePayload)
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .select("id, status, starts_at, ends_at, note");

  if (auth.context.role === "coach") {
    query = query.eq("coach_id", auth.context.userId);
  }
  if (auth.context.role === "frontdesk" && auth.context.branchId) {
    query = query.eq("branch_id", auth.context.branchId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "booking_update",
    target_type: "booking",
    target_id: id,
    reason,
    payload: updatePayload,
  });

  return NextResponse.json({ booking: data });
}
