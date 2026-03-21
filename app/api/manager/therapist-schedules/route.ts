import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

function normalizeTime(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^\d{2}:\d{2}(:\d{2})?$/.test(trimmed) ? trimmed : "";
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const params = new URL(request.url).searchParams;
  const coachId = params.get("coachId");

  let query = auth.supabase
    .from("coach_recurring_schedules")
    .select("id, coach_id, branch_id, day_of_week, start_time, end_time, timezone, effective_from, effective_until, is_active, note, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("day_of_week", { ascending: true });

  if (coachId) query = query.eq("coach_id", coachId);

  const result = await query;
  if (result.error) {
    if (result.error.message.toLowerCase().includes("coach_recurring_schedules")) {
      return NextResponse.json({ items: [], warning: "coach_recurring_schedules table missing" });
    }
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ items: result.data || [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const coachId = typeof body?.coachId === "string" ? body.coachId.trim() : "";
  const branchId = typeof body?.branchId === "string" && body.branchId.trim() ? body.branchId.trim() : null;
  const dayOfWeek = Number(body?.dayOfWeek);
  const startTime = normalizeTime(body?.startTime);
  const endTime = normalizeTime(body?.endTime);
  const timezone = typeof body?.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "Asia/Taipei";
  const effectiveFrom = typeof body?.effectiveFrom === "string" && body.effectiveFrom.trim() ? body.effectiveFrom.trim() : null;
  const effectiveUntil = typeof body?.effectiveUntil === "string" && body.effectiveUntil.trim() ? body.effectiveUntil.trim() : null;
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

  if (!coachId || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || !startTime || !endTime) {
    return NextResponse.json({ error: "coachId, dayOfWeek, startTime, endTime are required" }, { status: 400 });
  }
  if (endTime <= startTime) return NextResponse.json({ error: "endTime must be after startTime" }, { status: 400 });

  const result = await auth.supabase
    .from("coach_recurring_schedules")
    .insert({
      tenant_id: auth.context.tenantId,
      coach_id: coachId,
      branch_id: branchId,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      timezone,
      effective_from: effectiveFrom,
      effective_until: effectiveUntil,
      is_active: true,
      note,
      created_by: auth.context.userId,
    })
    .select("id, coach_id, branch_id, day_of_week, start_time, end_time, timezone, effective_from, effective_until, is_active, note, created_at, updated_at")
    .maybeSingle();

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });

  void (await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "therapist_schedule_create",
    target_type: "coach_recurring_schedule",
    target_id: result.data?.id || null,
    reason: "manager_create",
    payload: {
      coachId,
      branchId,
      dayOfWeek,
      startTime,
      endTime,
      timezone,
      effectiveFrom,
      effectiveUntil,
      note,
    },
  }));

  return NextResponse.json({ item: result.data }, { status: 201 });
}
