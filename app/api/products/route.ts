import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { PURCHASE_PRODUCTS } from "../../../lib/products";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient(request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Prefer tenant-scoped products from DB. Fallback to code-defined defaults.
  const profileResult = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  const tenantIdFromProfile = (profileResult.data as any)?.tenant_id ? String((profileResult.data as any).tenant_id) : null;

  const memberResult = tenantIdFromProfile
    ? { data: null as any, error: null as any }
    : await supabase.from("members").select("tenant_id").eq("auth_user_id", user.id).maybeSingle();
  const tenantIdFromMember = (memberResult.data as any)?.tenant_id ? String((memberResult.data as any).tenant_id) : null;

  const tenantId = tenantIdFromProfile || tenantIdFromMember;
  if (!tenantId) {
    return NextResponse.json({ items: PURCHASE_PRODUCTS });
  }

  const productsResult = await supabase
    .from("products")
    .select("code, title, item_type, unit_price, quantity, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("item_type", ["subscription", "entry_pass"])
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (productsResult.error) {
    return NextResponse.json({ items: PURCHASE_PRODUCTS });
  }

  const items = (productsResult.data || []).map((row: any) => ({
    code: String(row.code),
    title: String(row.title),
    itemType: row.item_type === "subscription" ? "subscription" : "entry_pass",
    unitPrice: Number(row.unit_price ?? 0),
    quantity: Number(row.quantity ?? 1),
  }));

  return NextResponse.json({ items: items.length ? items : PURCHASE_PRODUCTS });
}
