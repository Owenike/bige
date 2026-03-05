import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../../lib/auth-context";

function toIso(value: unknown) {
  if (typeof value !== "string") return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const status = body?.status === "cancelled" || body?.status === "active" ? body.status : null;
  const startsAt = toIso(body?.startsAt);
  const endsAt = toIso(body?.endsAt);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

  const existing = await auth.supabase
    .from("coach_blocks")
    .select("id, coach_id, starts_at, ends_at, status")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  if (!existing.data) return NextResponse.json({ error: "Block not found" }, { status: 404 });

  const nextStartsAt = startsAt || existing.data.starts_at;
  const nextEndsAt = endsAt || existing.data.ends_at;
  const nextStatus = status || existing.data.status;
  if (new Date(nextEndsAt).getTime() <= new Date(nextStartsAt).getTime()) {
    return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });
  }

  if (nextStatus === "active") {
    const overlapBlock = await auth.supabase
      .from("coach_blocks")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("coach_id", existing.data.coach_id)
      .eq("status", "active")
      .neq("id", id)
      .lt("starts_at", nextEndsAt)
      .gt("ends_at", nextStartsAt)
      .limit(1)
      .maybeSingle();
    if (overlapBlock.error) return NextResponse.json({ error: overlapBlock.error.message }, { status: 500 });
    if (overlapBlock.data) return NextResponse.json({ error: "Blocked slot overlaps another active block" }, { status: 409 });

    const overlapBooking = await auth.supabase
      .from("bookings")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("coach_id", existing.data.coach_id)
      .in("status", ["booked", "checked_in"])
      .lt("starts_at", nextEndsAt)
      .gt("ends_at", nextStartsAt)
      .limit(1)
      .maybeSingle();
    if (overlapBooking.error) return NextResponse.json({ error: overlapBooking.error.message }, { status: 500 });
    if (overlapBooking.data) return NextResponse.json({ error: "Blocked slot overlaps active booking" }, { status: 409 });
  }

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (status) updatePayload.status = status;
  if (startsAt) updatePayload.starts_at = startsAt;
  if (endsAt) updatePayload.ends_at = endsAt;
  if (body?.note !== undefined) updatePayload.note = note;

  const updated = await auth.supabase
    .from("coach_blocks")
    .update(updatePayload)
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .select("id, coach_id, starts_at, ends_at, reason, note, status")
    .maybeSingle();
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 500 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "coach_block_update",
    target_type: "coach_block",
    target_id: id,
    reason: reason || note || null,
    payload: {
      previous: existing.data,
      next: updatePayload,
    },
  }).catch(() => null);

  return NextResponse.json({ item: updated.data });
}
