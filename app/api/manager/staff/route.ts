import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

const ROLES = ["manager", "frontdesk", "coach", "member"] as const;
type StaffRole = (typeof ROLES)[number];

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  const activeOnly = searchParams.get("activeOnly") === "1";

  const roleFilter = ROLES.includes(role as any) ? (role as StaffRole) : null;

  let query = auth.supabase
    .from("profiles")
    .select("id, role, tenant_id, branch_id, display_name, is_active, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (roleFilter) query = query.eq("role", roleFilter);
  if (activeOnly) query = query.eq("is_active", true);
  if (q) query = query.or(`display_name.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

