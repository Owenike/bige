import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

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
  const code = normalizeOptionalText(body?.code);
  const address = normalizeOptionalText(body?.address);
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
    .select("id, tenant_id, name, code, address, is_active, created_at, updated_at")
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

export async function PATCH(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    updates.name = name;
  }
  if ("code" in (body || {})) {
    updates.code = normalizeOptionalText(body?.code);
  }
  if ("address" in (body || {})) {
    updates.address = normalizeOptionalText(body?.address);
  }
  if (typeof body?.isActive === "boolean") {
    updates.is_active = body.isActive;
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: "no updates provided" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("branches")
    .update(updates)
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .select("id, tenant_id, name, code, address, is_active, created_at, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Branch not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "branch_update",
    target_type: "branch",
    target_id: id,
    reason: "manager_update",
    payload: updates,
  });

  return NextResponse.json({ branch: data });
}
