import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";
import { PURCHASE_PRODUCTS } from "../../../lib/products";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk", "coach", "member"], request);
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;
  const tenantId = auth.context.tenantId;
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
