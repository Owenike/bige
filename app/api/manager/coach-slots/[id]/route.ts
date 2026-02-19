import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const action = body?.action === "cancel" ? "cancel" : body?.action === "activate" ? "activate" : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!action) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });

  const nextStatus = action === "cancel" ? "cancelled" : "active";
  const now = new Date().toISOString();

  const { data, error } = await auth.supabase
    .from("coach_slots")
    .update({ status: nextStatus, updated_at: now })
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .select("id, coach_id, starts_at, ends_at, status, updated_at")
    .maybeSingle();

  if (error) {
    if (error.message.includes('relation "coach_slots" does not exist')) {
      return NextResponse.json({
        slot: {
          id,
          coach_id: null,
          starts_at: null,
          ends_at: null,
          status: nextStatus,
          updated_at: now,
        },
        warning: "coach_slots table missing. Fallback mode: write skipped.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Slot not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "coach_slot_update",
    target_type: "coach_slot",
    target_id: id,
    reason,
    payload: { action, nextStatus },
  });

  return NextResponse.json({ slot: data });
}
