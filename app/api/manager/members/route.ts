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
  const q = (searchParams.get("q") || "").trim();

  let query = auth.supabase
    .from("members")
    .select("id, full_name, phone, photo_url, notes, store_id, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
  }

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
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const phone = normalizeOptionalText(body?.phone);
  const notes = normalizeOptionalText(body?.notes);
  const storeId = normalizeOptionalText(body?.storeId);

  if (!fullName) {
    return NextResponse.json({ error: "fullName is required" }, { status: 400 });
  }

  if (storeId) {
    const { data: branch, error: branchError } = await auth.supabase
      .from("branches")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", storeId)
      .maybeSingle();
    if (branchError) return NextResponse.json({ error: branchError.message }, { status: 500 });
    if (!branch) return NextResponse.json({ error: "branch not found for storeId" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await auth.supabase
    .from("members")
    .insert({
      tenant_id: auth.context.tenantId,
      full_name: fullName,
      phone,
      notes,
      store_id: storeId,
      created_at: now,
      updated_at: now,
    })
    .select("id, full_name, phone, notes, store_id, created_at, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "member_create",
    target_type: "member",
    target_id: data?.id ? String(data.id) : null,
    reason: "manager_create",
    payload: { fullName, phone, notes, storeId },
  });

  return NextResponse.json({ member: data }, { status: 201 });
}
