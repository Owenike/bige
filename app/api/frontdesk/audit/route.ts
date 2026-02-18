import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Invalid tenant context" }, { status: 400 });
  }

  const params = new URL(request.url).searchParams;
  const action = params.get("action") || "";
  const targetType = params.get("targetType") || "";
  const targetId = params.get("targetId") || "";
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 30)));

  let query = auth.supabase
    .from("audit_logs")
    .select("id, action, target_type, target_id, reason, payload, created_at, actor_id")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (action) query = query.eq("action", action);
  if (targetType) query = query.eq("target_type", targetType);
  if (targetId) query = query.eq("target_id", targetId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

