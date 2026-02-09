import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient(request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profileResult = await supabase.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
  const tenantIdFromProfile = (profileResult.data as any)?.tenant_id ? String((profileResult.data as any).tenant_id) : null;

  const memberResult = tenantIdFromProfile
    ? { data: null as any, error: null as any }
    : await supabase.from("members").select("tenant_id").eq("auth_user_id", user.id).maybeSingle();
  const tenantIdFromMember = (memberResult.data as any)?.tenant_id ? String((memberResult.data as any).tenant_id) : null;

  const tenantId = tenantIdFromProfile || tenantIdFromMember;
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

