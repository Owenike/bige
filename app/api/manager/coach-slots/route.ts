import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const coachId = searchParams.get("coachId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = auth.supabase
    .from("coach_slots")
    .select("id, coach_id, branch_id, starts_at, ends_at, status, note, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("starts_at", { ascending: true })
    .limit(300);

  if (coachId) query = query.eq("coach_id", coachId);
  if (from) query = query.gte("starts_at", from);
  if (to) query = query.lte("starts_at", to);

  const { data, error } = await query;
  if (error) {
    if (error.message.includes('relation "coach_slots" does not exist')) {
      return NextResponse.json({
        items: [],
        warning: "coach_slots table missing. Running in fallback mode with empty slot list.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const coachId = typeof body?.coachId === "string" ? body.coachId : "";
  const branchId = typeof body?.branchId === "string" ? body.branchId : null;
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : "";
  const note = typeof body?.note === "string" ? body.note : null;

  if (!coachId || !startsAt || !endsAt) {
    return NextResponse.json({ error: "coachId, startsAt, endsAt are required" }, { status: 400 });
  }
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });
  }

  const overlap = await auth.supabase
    .from("coach_slots")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("coach_id", coachId)
    .eq("status", "active")
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt)
    .limit(1)
    .maybeSingle();

  if (overlap.error) {
    if (overlap.error.message.includes('relation "coach_slots" does not exist')) {
      return NextResponse.json({
        slot: {
          id: `fallback-${crypto.randomUUID()}`,
          coach_id: coachId,
          branch_id: branchId,
          starts_at: startsAt,
          ends_at: endsAt,
          status: "active",
          note,
        },
        warning: "coach_slots table missing. Fallback mode: write skipped.",
      }, { status: 201 });
    }
    return NextResponse.json({ error: overlap.error.message }, { status: 500 });
  }
  if (overlap.data) {
    return NextResponse.json({ error: "Slot overlaps with existing slot" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await auth.supabase
    .from("coach_slots")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: branchId,
      coach_id: coachId,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "active",
      note,
      created_by: auth.context.userId,
      created_at: now,
      updated_at: now,
    })
    .select("id, coach_id, branch_id, starts_at, ends_at, status, note")
    .maybeSingle();

  if (error) {
    if (error.message.includes('relation "coach_slots" does not exist')) {
      return NextResponse.json({
        slot: {
          id: `fallback-${crypto.randomUUID()}`,
          coach_id: coachId,
          branch_id: branchId,
          starts_at: startsAt,
          ends_at: endsAt,
          status: "active",
          note,
        },
        warning: "coach_slots table missing. Fallback mode: write skipped.",
      }, { status: 201 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "coach_slot_create",
    target_type: "coach_slot",
    target_id: String(data?.id || ""),
    reason: "manager_create",
    payload: { coachId, branchId, startsAt, endsAt, note },
  });

  return NextResponse.json({ slot: data }, { status: 201 });
}
