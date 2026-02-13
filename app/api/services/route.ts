import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";
import { DEFAULT_SERVICES } from "../../../lib/services";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk", "coach", "member"], request);
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;
  const tenantId = auth.context.tenantId;
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
