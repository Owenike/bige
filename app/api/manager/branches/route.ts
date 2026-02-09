import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get("activeOnly") === "1";

  let query = auth.supabase
    .from("branches")
    .select("id, tenant_id, name, code, address, is_active, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : null;
  const address = typeof body?.address === "string" ? body.address.trim() : null;
  const isActive = body?.isActive === false ? false : true;

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const now = new Date().toISOString();
  const { data, error } = await auth.supabase
    .from("branches")
    .insert({
      tenant_id: auth.context.tenantId,
      name,
      code,
      address,
      is_active: isActive,
      created_at: now,
      updated_at: now,
    })
    .select("id, name, code, address, is_active")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "branch_create",
    target_type: "branch",
    target_id: data?.id ? String(data.id) : null,
    reason: "manager_create",
    payload: { name, code, address, isActive },
  });

  return NextResponse.json({ branch: data }, { status: 201 });
}

