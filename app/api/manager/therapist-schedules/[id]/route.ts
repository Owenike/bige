import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

function normalizeTime(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^\d{2}:\d{2}(:\d{2})?$/.test(trimmed) ? trimmed : "";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if ("branchId" in (body || {})) updates.branch_id = typeof body?.branchId === "string" && body.branchId.trim() ? body.branchId.trim() : null;
  if ("dayOfWeek" in (body || {})) {
    const dayOfWeek = Number(body?.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return NextResponse.json({ error: "Invalid dayOfWeek" }, { status: 400 });
    }
    updates.day_of_week = dayOfWeek;
  }
  if ("startTime" in (body || {})) {
    const startTime = normalizeTime(body?.startTime);
    if (!startTime) return NextResponse.json({ error: "Invalid startTime" }, { status: 400 });
    updates.start_time = startTime;
  }
  if ("endTime" in (body || {})) {
    const endTime = normalizeTime(body?.endTime);
    if (!endTime) return NextResponse.json({ error: "Invalid endTime" }, { status: 400 });
    updates.end_time = endTime;
  }
  if ("timezone" in (body || {})) updates.timezone = typeof body?.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "Asia/Taipei";
  if ("effectiveFrom" in (body || {})) updates.effective_from = typeof body?.effectiveFrom === "string" && body.effectiveFrom.trim() ? body.effectiveFrom.trim() : null;
  if ("effectiveUntil" in (body || {})) updates.effective_until = typeof body?.effectiveUntil === "string" && body.effectiveUntil.trim() ? body.effectiveUntil.trim() : null;
  if ("note" in (body || {})) updates.note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;
  if ("isActive" in (body || {})) updates.is_active = body?.isActive === false ? false : true;

  const result = await auth.supabase
    .from("coach_recurring_schedules")
    .update(updates)
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .select("id, coach_id, branch_id, day_of_week, start_time, end_time, timezone, effective_from, effective_until, is_active, note, created_at, updated_at")
    .maybeSingle();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  if (!result.data) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "therapist_schedule_update",
    target_type: "coach_recurring_schedule",
    target_id: id,
    reason: "manager_update",
    payload: updates,
  }).catch(() => null);

  return NextResponse.json({ item: result.data });
}
