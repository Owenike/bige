import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

const STAFF_ROLES = ["manager", "frontdesk", "coach", "member"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

function parseRole(value: string | null): StaffRole | null {
  if (!value) return null;
  return STAFF_ROLES.includes(value as StaffRole) ? (value as StaffRole) : null;
}

export async function GET(request: Request) {
  const auth = await requireProfile(undefined, request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const role = parseRole(searchParams.get("role"));
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  const activeOnly = searchParams.get("activeOnly") === "1";

  let query = auth.supabase
    .from("profiles")
    .select("id, role, tenant_id, branch_id, display_name, is_active, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .in("role", [...STAFF_ROLES])
    .order("created_at", { ascending: false })
    .limit(200);

  if (role) query = query.eq("role", role);
  if (activeOnly) query = query.eq("is_active", true);
  if (q) query = query.or(`display_name.ilike.%${q}%,id.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(undefined, request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        id?: string;
        role?: string;
        displayName?: string | null;
        branchId?: string | null;
        isActive?: boolean;
      }
    | null;

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body?.role === "string") {
    const role = parseRole(body.role);
    if (!role) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }
    updates.role = role;
  }

  if (body && "displayName" in body) {
    const value = body.displayName;
    if (value === null) {
      updates.display_name = null;
    } else if (typeof value === "string") {
      updates.display_name = value.trim() || null;
    } else {
      return NextResponse.json({ error: "invalid displayName" }, { status: 400 });
    }
  }

  if (body && "branchId" in body) {
    const value = body.branchId;
    if (value === null) {
      updates.branch_id = null;
    } else if (typeof value === "string") {
      updates.branch_id = value.trim() || null;
    } else {
      return NextResponse.json({ error: "invalid branchId" }, { status: 400 });
    }
  }

  if (typeof body?.isActive === "boolean") {
    updates.is_active = body.isActive;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no updates provided" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await auth.supabase
    .from("profiles")
    .update(updates)
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .in("role", [...STAFF_ROLES])
    .select("id, role, tenant_id, branch_id, display_name, is_active, created_at, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "staff not found" }, { status: 404 });

  return NextResponse.json({ item: data });
}
