import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

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

