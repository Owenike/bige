import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();

  let query = auth.supabase
    .from("members")
    .select("id, full_name, phone, photo_url, store_id, tenant_id")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : null;
  const storeId = typeof body?.storeId === "string" ? body.storeId : auth.context.branchId;

  if (!fullName || !auth.context.tenantId) {
    return NextResponse.json({ error: "Missing fullName or tenant context" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("members")
    .insert({
      tenant_id: auth.context.tenantId,
      store_id: storeId,
      full_name: fullName,
      phone,
    })
    .select("id, full_name, phone, store_id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ member: data }, { status: 201 });
}
