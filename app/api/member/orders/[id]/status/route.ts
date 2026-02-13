import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../../lib/auth-context";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;
  const userId = auth.context.userId;

  const { id } = await context.params;

  const memberResult = await supabase
    .from("members")
    .select("id, tenant_id")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const orderResult = await supabase
    .from("orders")
    .select("id, status, amount, channel, created_at, updated_at")
    .eq("id", id)
    .eq("tenant_id", memberResult.data.tenant_id)
    .eq("member_id", memberResult.data.id)
    .maybeSingle();

  if (orderResult.error || !orderResult.data) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({ order: orderResult.data });
}
