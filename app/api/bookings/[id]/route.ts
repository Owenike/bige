import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";

function parseRoomFromNote(note: string | null) {
  if (!note) return "";
  const match = note.match(/\[room:([^\]]+)\]/i);
  return match?.[1]?.trim() || "";
}

function isMissingCoachBlocksTable(message: string) {
  return message.includes('relation "coach_blocks" does not exist')
    || message.includes("Could not find the table 'public.coach_blocks' in the schema cache");
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : null;
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : null;
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : null;
  const note = typeof body?.note === "string" ? body.note : null;
  const coachId = typeof body?.coachId === "string" ? body.coachId : null;
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

  let existingQuery = auth.supabase
    .from("bookings")
    .select("id, tenant_id, branch_id, member_id, coach_id, starts_at, ends_at, status, note")
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId);
  if (auth.context.role === "coach") existingQuery = existingQuery.eq("coach_id", auth.context.userId);
  if (auth.context.role === "frontdesk" && auth.context.branchId) existingQuery = existingQuery.eq("branch_id", auth.context.branchId);
  const existingResult = await existingQuery.maybeSingle();
  if (existingResult.error) return NextResponse.json({ error: existingResult.error.message }, { status: 500 });
  if (!existingResult.data) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const nextStartsAt = startsAt || existingResult.data.starts_at;
  const nextEndsAt = endsAt || existingResult.data.ends_at;
  const nextCoachId = coachId || existingResult.data.coach_id;
  const nextNote = note !== null ? note : existingResult.data.note;
  const movingTimeOrCoach = Boolean(startsAt || endsAt || coachId);

  if (new Date(nextEndsAt).getTime() <= new Date(nextStartsAt).getTime()) {
    return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });
  }

  if (movingTimeOrCoach) {
    const coachOverlap = nextCoachId
      ? await auth.supabase
          .from("bookings")
          .select("id")
          .eq("tenant_id", auth.context.tenantId)
          .eq("coach_id", nextCoachId)
          .in("status", ["booked", "checked_in"])
          .neq("id", id)
          .lt("starts_at", nextEndsAt)
          .gt("ends_at", nextStartsAt)
          .limit(1)
          .maybeSingle()
      : null;
    if (coachOverlap?.error) return NextResponse.json({ error: coachOverlap.error.message }, { status: 500 });
    if (coachOverlap?.data) return NextResponse.json({ error: "Coach time overlaps with another booking" }, { status: 400 });

    const memberOverlap = await auth.supabase
      .from("bookings")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", existingResult.data.member_id)
      .in("status", ["booked", "checked_in"])
      .neq("id", id)
      .lt("starts_at", nextEndsAt)
      .gt("ends_at", nextStartsAt)
      .limit(1)
      .maybeSingle();
    if (memberOverlap.error) return NextResponse.json({ error: memberOverlap.error.message }, { status: 500 });
    if (memberOverlap.data) return NextResponse.json({ error: "Member time overlaps with another booking" }, { status: 400 });

    const room = parseRoomFromNote(nextNote);
    if (room) {
      const roomCandidates = await auth.supabase
        .from("bookings")
        .select("id, note")
        .eq("tenant_id", auth.context.tenantId)
        .in("status", ["booked", "checked_in"])
        .neq("id", id)
        .lt("starts_at", nextEndsAt)
        .gt("ends_at", nextStartsAt)
        .limit(200);
      if (roomCandidates.error) return NextResponse.json({ error: roomCandidates.error.message }, { status: 500 });
      const roomConflict = (roomCandidates.data || []).find((item: { note: string | null }) => parseRoomFromNote(item.note || null) === room);
      if (roomConflict) return NextResponse.json({ error: "Room time overlaps with another booking" }, { status: 400 });
    }

    if (nextCoachId) {
      const coachBlock = await auth.supabase
        .from("coach_blocks")
        .select("id")
        .eq("tenant_id", auth.context.tenantId)
        .eq("coach_id", nextCoachId)
        .eq("status", "active")
        .lt("starts_at", nextEndsAt)
        .gt("ends_at", nextStartsAt)
        .limit(1)
        .maybeSingle();
      if (coachBlock.error && !isMissingCoachBlocksTable(coachBlock.error.message)) {
        return NextResponse.json({ error: coachBlock.error.message }, { status: 500 });
      }
      if (!coachBlock.error && coachBlock.data) {
        return NextResponse.json({ error: "Coach is blocked in this time range" }, { status: 400 });
      }
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (status) updatePayload.status = status;
  if (startsAt) updatePayload.starts_at = startsAt;
  if (endsAt) updatePayload.ends_at = endsAt;
  if (note !== null) updatePayload.note = note;
  if (coachId) updatePayload.coach_id = coachId;
  updatePayload.updated_at = new Date().toISOString();

  let query = auth.supabase
    .from("bookings")
    .update(updatePayload)
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .select("id, coach_id, status, starts_at, ends_at, note");

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
