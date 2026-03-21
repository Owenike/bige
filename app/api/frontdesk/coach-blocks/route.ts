import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";

function isMissingCoachBlocksTable(message: string) {
  return message.includes('relation "coach_blocks" does not exist')
    || message.includes("Could not find the table 'public.coach_blocks' in the schema cache");
}

function toIso(value: unknown) {
  if (typeof value !== "string") return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const coachId = (params.get("coachId") || "").trim();

  let query = auth.supabase
    .from("coach_blocks")
    .select("id, coach_id, branch_id, starts_at, ends_at, reason, note, status, block_type, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("starts_at", { ascending: true })
    .limit(400);

  if (from) query = query.gte("ends_at", from);
  if (to) query = query.lte("starts_at", to);
  if (coachId) query = query.eq("coach_id", coachId);
  if (auth.context.role === "coach") query = query.eq("coach_id", auth.context.userId);
  if (auth.context.role === "frontdesk" && auth.context.branchId) query = query.eq("branch_id", auth.context.branchId);

  const { data, error } = await query;
  if (error) {
    if (isMissingCoachBlocksTable(error.message)) {
      return NextResponse.json({ items: [], warning: "coach_blocks table missing" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  if (auth.context.role === "frontdesk") {
    const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
    if (!shiftGuard.ok) return shiftGuard.response;
  }

  const body = await request.json().catch(() => null);
  const coachId = typeof body?.coachId === "string" ? body.coachId.trim() : "";
  const branchId = typeof body?.branchId === "string" ? body.branchId.trim() : auth.context.branchId;
  const startsAt = toIso(body?.startsAt);
  const endsAt = toIso(body?.endsAt);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;
  const blockType =
    body?.blockType === "time_off" || body?.blockType === "blocked" || body?.blockType === "offsite" || body?.blockType === "other"
      ? body.blockType
      : "blocked";

  if (!coachId || !startsAt || !endsAt || !reason) {
    return NextResponse.json({ error: "coachId, startsAt, endsAt, reason are required" }, { status: 400 });
  }
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });
  }

  const coachResult = await auth.supabase
    .from("profiles")
    .select("id")
    .eq("id", coachId)
    .eq("tenant_id", auth.context.tenantId)
    .eq("role", "coach")
    .maybeSingle();
  if (coachResult.error) return NextResponse.json({ error: coachResult.error.message }, { status: 500 });
  if (!coachResult.data) return NextResponse.json({ error: "Coach not found" }, { status: 404 });

  const overlapBlock = await auth.supabase
    .from("coach_blocks")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("coach_id", coachId)
    .eq("status", "active")
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt)
    .limit(1)
    .maybeSingle();
  if (overlapBlock.error) {
    if (isMissingCoachBlocksTable(overlapBlock.error.message)) {
      return NextResponse.json({ error: "coach_blocks table missing" }, { status: 409 });
    }
    return NextResponse.json({ error: overlapBlock.error.message }, { status: 500 });
  }
  if (overlapBlock.data) return NextResponse.json({ error: "Coach already has a blocked slot in this range" }, { status: 409 });

  const overlapBooking = await auth.supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("coach_id", coachId)
    .in("status", ["booked", "checked_in"])
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt)
    .limit(1)
    .maybeSingle();
  if (overlapBooking.error) return NextResponse.json({ error: overlapBooking.error.message }, { status: 500 });
  if (overlapBooking.data) return NextResponse.json({ error: "Coach already has booking in this range" }, { status: 409 });

  const insert = await auth.supabase
    .from("coach_blocks")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: branchId || null,
      coach_id: coachId,
      starts_at: startsAt,
      ends_at: endsAt,
      reason,
      note,
      block_type: blockType,
      status: "active",
      created_by: auth.context.userId,
    })
    .select("id, coach_id, branch_id, starts_at, ends_at, reason, note, status, block_type")
    .maybeSingle();
  if (insert.error) {
    if (isMissingCoachBlocksTable(insert.error.message)) {
      return NextResponse.json({ error: "coach_blocks table missing" }, { status: 409 });
    }
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  void (await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "coach_block_create",
    target_type: "coach_block",
    target_id: insert.data?.id || null,
    reason,
    payload: {
      coachId,
      branchId: branchId || null,
      startsAt,
      endsAt,
      note,
      blockType,
    },
  }));

  return NextResponse.json({ item: insert.data }, { status: 201 });
}
