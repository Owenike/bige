import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const { id } = await context.params;

  if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });

  const { data: order, error: fetchError } = await auth.supabase
    .from("orders")
    .select("id, status, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (fetchError || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (auth.context.role === "frontdesk" && auth.context.branchId && String(order.branch_id || "") !== auth.context.branchId) {
    return NextResponse.json({ error: "Forbidden order access for current branch" }, { status: 403 });
  }
  if (order.status === "cancelled" || order.status === "refunded") {
    return NextResponse.json({ error: "Order already closed" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .select("id, status, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "order_void",
    target_type: "order",
    target_id: id,
    reason,
    payload: { previousStatus: order.status },
  });

  return NextResponse.json({ order: data });
}
