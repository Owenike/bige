import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

function parseIntSafe(input: unknown, fallback: number) {
  const n = Number(input);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function mapServiceRow(row: any) {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    durationMinutes: Number(row.duration_minutes ?? 60),
    capacity: Number(row.capacity ?? 1),
    isActive: row.is_active !== false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("services")
    .select("id, code, name, duration_minutes, capacity, is_active, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    if (error.message.includes('relation "services" does not exist')) {
      return NextResponse.json({
        items: [],
        warning: "services table missing. Running in fallback mode with empty service list.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: (data ?? []).map(mapServiceRow) });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const durationMinutes = Math.max(1, parseIntSafe(body?.durationMinutes, 60));
  const capacity = Math.max(1, parseIntSafe(body?.capacity, 1));
  const isActive = body?.isActive === false ? false : true;

  if (!code || !/^[a-z0-9_]+$/i.test(code)) return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const now = new Date().toISOString();
  const upsert = await auth.supabase
    .from("services")
    .upsert(
      {
        tenant_id: auth.context.tenantId,
        code,
        name,
        duration_minutes: durationMinutes,
        capacity,
        is_active: isActive,
        updated_at: now,
      },
      { onConflict: "tenant_id,code" },
    )
    .select("id, code, name, duration_minutes, capacity, is_active, created_at, updated_at")
    .maybeSingle();

  if (upsert.error) {
    if (upsert.error.message.includes('relation "services" does not exist')) {
      return NextResponse.json({ error: "services table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: upsert.error.message }, { status: 500 });
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "service_upsert",
    target_type: "service",
    target_id: code,
    reason: "manager_update",
    payload: { code, name, durationMinutes, capacity, isActive },
  });

  return NextResponse.json({ service: upsert.data ? mapServiceRow(upsert.data) : null }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!code || !/^[a-z0-9_]+$/i.test(code)) {
    return NextResponse.json({ error: "Valid code is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    updates.name = name;
  }

  if ("durationMinutes" in (body || {})) {
    const durationMinutes = Math.max(1, parseIntSafe(body?.durationMinutes, 0));
    if (!durationMinutes) return NextResponse.json({ error: "Invalid durationMinutes" }, { status: 400 });
    updates.duration_minutes = durationMinutes;
  }

  if ("capacity" in (body || {})) {
    const capacity = Math.max(1, parseIntSafe(body?.capacity, 0));
    if (!capacity) return NextResponse.json({ error: "Invalid capacity" }, { status: 400 });
    updates.capacity = capacity;
  }

  if (typeof body?.isActive === "boolean") {
    updates.is_active = body.isActive;
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: "no updates provided" }, { status: 400 });
  }

  const updateResult = await auth.supabase
    .from("services")
    .update(updates)
    .eq("tenant_id", auth.context.tenantId)
    .eq("code", code)
    .select("id, code, name, duration_minutes, capacity, is_active, created_at, updated_at")
    .maybeSingle();

  if (updateResult.error) {
    if (updateResult.error.message.includes('relation "services" does not exist')) {
      return NextResponse.json({ error: "services table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }
  if (!updateResult.data) return NextResponse.json({ error: "Service not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "service_update",
    target_type: "service",
    target_id: code,
    reason: "manager_update",
    payload: updates,
  });

  return NextResponse.json({ service: mapServiceRow(updateResult.data) });
}
