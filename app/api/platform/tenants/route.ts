import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("tenants")
    .select("id, name, status, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const status = body?.status === "suspended" || body?.status === "disabled" ? body.status : "active";

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("tenants")
    .insert({ name, status })
    .select("id, name, status")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tenant: data }, { status: 201 });
}
