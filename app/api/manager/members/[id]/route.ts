import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : null;
  const notes = typeof body?.notes === "string" ? body.notes : null;
  const storeId = typeof body?.storeId === "string" ? body.storeId : null;

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fullName !== null) updatePayload.full_name = fullName;
  if (phone !== null) updatePayload.phone = phone || null;
  if (notes !== null) updatePayload.notes = notes || null;
  if (storeId !== null) updatePayload.store_id = storeId || null;

  const { data, error } = await auth.supabase
    .from("members")
    .update(updatePayload)
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .select("id, full_name, phone, notes, store_id, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "member_update",
    target_type: "member",
    target_id: id,
    reason: "manager_update",
    payload: updatePayload,
  });

  return NextResponse.json({ member: data });
}

