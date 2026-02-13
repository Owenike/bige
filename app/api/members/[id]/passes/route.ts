import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Tenant context is required" }, { status: 400 });
  }

  const { id } = await context.params;

  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id")
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (memberResult.error) return NextResponse.json({ error: memberResult.error.message }, { status: 500 });
  if (!memberResult.data) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (auth.context.role === "frontdesk" && auth.context.branchId && String(memberResult.data.store_id || "") !== auth.context.branchId) {
    return NextResponse.json({ error: "Forbidden member access for current branch" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await auth.supabase
    .from("entry_passes")
    .select("id, pass_type, remaining, expires_at, status")
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", id)
    .eq("status", "active")
    .gt("remaining", 0)
    .or(`expires_at.is.null,expires_at.gte.${nowIso}`)
    .order("expires_at", { ascending: true, nullsFirst: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
