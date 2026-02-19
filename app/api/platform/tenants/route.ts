import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

type TenantStatus = "active" | "suspended" | "disabled";

function parseTenantStatus(input: unknown): TenantStatus {
  if (input === "suspended" || input === "disabled") return input;
  return "active";
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("tenants")
    .select("id, name, status, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const status = parseTenantStatus(body?.status);

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("tenants")
    .insert({ name, status, updated_at: new Date().toISOString() })
    .select("id, name, status, created_at, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: data?.id || null,
    actor_id: auth.context.userId,
    action: "tenant_created",
    target_type: "tenant",
    target_id: data?.id || null,
    reason: null,
    payload: { name, status },
  });

  return NextResponse.json({ tenant: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    updates.name = name;
  }

  if ("status" in (body || {})) {
    updates.status = parseTenantStatus(body?.status);
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: "no updates provided" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("tenants")
    .update(updates)
    .eq("id", id)
    .select("id, name, status, created_at, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: id,
    actor_id: auth.context.userId,
    action: "tenant_updated",
    target_type: "tenant",
    target_id: id,
    reason: null,
    payload: updates,
  });

  return NextResponse.json({ tenant: data });
}
