import { NextResponse } from "next/server";
import { DEFAULT_SERVICES } from "../../../lib/services";
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
  if (!tenantId) return NextResponse.json({ items: DEFAULT_SERVICES });

  const { data, error: servicesError } = await supabase
    .from("services")
    .select("code, name, duration_minutes, capacity")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(200);

  if (servicesError) {
    if (servicesError.message.includes('relation "services" does not exist')) {
      return NextResponse.json({ items: DEFAULT_SERVICES });
    }
    return NextResponse.json({ error: servicesError.message }, { status: 500 });
  }

  const items = (data ?? []).map((row: any) => ({
    code: String(row.code),
    name: String(row.name),
    durationMinutes: Number(row.duration_minutes ?? 60),
    capacity: Number(row.capacity ?? 1),
  }));

  return NextResponse.json({ items: items.length ? items : DEFAULT_SERVICES });
}

