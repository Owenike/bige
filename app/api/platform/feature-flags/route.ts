import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return auth.response;

  const tenantIdFromQuery = new URL(request.url).searchParams.get("tenantId");
  const tenantId = auth.context.role === "platform_admin" ? tenantIdFromQuery : auth.context.tenantId;

  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("feature_flags")
    .select("id, tenant_id, key, enabled, updated_at")
    .eq("tenant_id", tenantId)
    .order("key", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const enabled = Boolean(body?.enabled);

  if (!tenantId || !key) {
    return NextResponse.json({ error: "tenantId and key are required" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("feature_flags")
    .upsert({ tenant_id: tenantId, key, enabled, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,key" })
    .select("id, tenant_id, key, enabled, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ flag: data });
}
