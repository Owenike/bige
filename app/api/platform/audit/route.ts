import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return auth.response;

  const searchParams = new URL(request.url).searchParams;
  const tenantFromQuery = searchParams.get("tenantId");
  const targetType = searchParams.get("targetType");
  const action = searchParams.get("action");
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
  const tenantId = auth.context.role === "platform_admin" ? tenantFromQuery : auth.context.tenantId;

  let query = auth.supabase
    .from("audit_logs")
    .select("id, tenant_id, actor_id, action, target_type, target_id, reason, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (tenantId) query = query.eq("tenant_id", tenantId);
  if (targetType) query = query.eq("target_type", targetType);
  if (action) query = query.eq("action", action);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
