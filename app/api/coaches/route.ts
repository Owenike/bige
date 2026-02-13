import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk", "coach", "member"], request);
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;
  const tenantId = auth.context.tenantId;
  if (!tenantId) return NextResponse.json({ items: [] });

  const { data, error: staffError } = await supabase
    .from("profiles")
    .select("id, display_name, branch_id, is_active")
    .eq("tenant_id", tenantId)
    .eq("role", "coach")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(200);

  if (staffError) return NextResponse.json({ error: staffError.message }, { status: 500 });

  const items = (data ?? []).map((row: any) => ({
    id: String(row.id),
    displayName: row.display_name ? String(row.display_name) : null,
    branchId: row.branch_id ? String(row.branch_id) : null,
  }));

  return NextResponse.json({ items });
}
