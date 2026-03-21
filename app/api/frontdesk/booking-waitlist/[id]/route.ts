import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../../lib/auth-context";

const ALLOWED_STATUS = new Set(["pending", "notified", "booked", "cancelled"]);

function normalizeDate(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeTime(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  const statusInput = typeof body?.status === "string" ? body.status.trim() : "";
  const status = statusInput ? statusInput : null;
  if (status && !ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;
  const desiredDate = normalizeDate(body?.desiredDate);
  const desiredTime = normalizeTime(body?.desiredTime);
  const linkedBookingId = typeof body?.linkedBookingId === "string" && body.linkedBookingId.trim() ? body.linkedBookingId.trim() : null;

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (status) updatePayload.status = status;
  if (body?.note !== undefined) updatePayload.note = note;
  if (body?.desiredDate !== undefined) updatePayload.desired_date = desiredDate;
  if (body?.desiredTime !== undefined) updatePayload.desired_time = desiredTime;
  if (body?.linkedBookingId !== undefined) updatePayload.linked_booking_id = linkedBookingId;

  const updated = await auth.supabase
    .from("booking_waitlist")
    .update(updatePayload)
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .select("id, branch_id, member_id, linked_booking_id, contact_name, contact_phone, desired_date, desired_time, note, status, created_at")
    .maybeSingle();
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 500 });
  if (!updated.data) return NextResponse.json({ error: "Waitlist item not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "booking_waitlist_update",
    target_type: "booking_waitlist",
    target_id: id,
    reason: note,
    payload: updatePayload,
  });

  return NextResponse.json({
    item: updated.data
      ? {
          id: updated.data.id,
          branchId: updated.data.branch_id,
          memberId: updated.data.member_id,
          linkedBookingId: updated.data.linked_booking_id,
          contactName: updated.data.contact_name,
          contactPhone: updated.data.contact_phone,
          desiredDate: updated.data.desired_date,
          desiredTime: updated.data.desired_time,
          note: updated.data.note,
          status: updated.data.status,
          createdAt: updated.data.created_at,
        }
      : null,
  });
}
