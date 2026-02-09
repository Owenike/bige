import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient(request);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const memberResult = await supabase
    .from("members")
    .select("id, tenant_id")
    .eq("auth_user_id", user.id)
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
