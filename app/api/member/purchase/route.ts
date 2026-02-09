import { NextResponse } from "next/server";
import { getPurchasableProduct } from "../../../../lib/products";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient(request);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const productCode = typeof body?.productCode === "string" ? body.productCode : "";
  const quantity = Math.max(1, Number(body?.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity < 1) {
    return NextResponse.json({ error: "Invalid quantity" }, { status: 400 });
  }

  const memberResult = await supabase
    .from("members")
    .select("id, tenant_id, store_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const member = memberResult.data as { id: string; tenant_id: string; store_id: string | null };
  const dbProductResult = await supabase
    .from("products")
    .select("code, title, item_type, unit_price, quantity, is_active")
    .eq("tenant_id", member.tenant_id)
    .eq("code", productCode)
    .maybeSingle();

  const productsTableMissing =
    Boolean(dbProductResult.error?.message) && dbProductResult.error!.message.includes('relation "products" does not exist');
  if (dbProductResult.error && !productsTableMissing) {
    return NextResponse.json({ error: dbProductResult.error.message }, { status: 500 });
  }

  const dbRow = !productsTableMissing ? (dbProductResult.data as any) || null : null;
  const fallback = getPurchasableProduct(productCode);
  const product =
    dbRow && dbRow.is_active === true
      ? {
          code: String(dbRow.code),
          title: String(dbRow.title),
          itemType: dbRow.item_type === "subscription" ? ("subscription" as const) : ("entry_pass" as const),
          unitPrice: Number(dbRow.unit_price ?? 0),
          quantity: Number(dbRow.quantity ?? 1),
        }
      : fallback;

  if (!product) {
    return NextResponse.json({ error: "Invalid productCode" }, { status: 400 });
  }
  if (product.itemType !== "subscription" && product.itemType !== "entry_pass") {
    return NextResponse.json({ error: "Product not purchasable online" }, { status: 400 });
  }

  const lineQuantity = product.quantity * quantity;
  const amount = product.unitPrice * lineQuantity;

  const orderResult = await supabase
    .from("orders")
    .insert({
      tenant_id: member.tenant_id,
      branch_id: member.store_id,
      member_id: member.id,
      amount,
      status: "confirmed",
      channel: "online",
      note: `member_purchase:${productCode}`,
    })
    .select("id, tenant_id, member_id, amount, status, channel")
    .maybeSingle();

  if (orderResult.error || !orderResult.data) {
    return NextResponse.json({ error: orderResult.error?.message || "Create order failed" }, { status: 500 });
  }

  const order = orderResult.data as { id: string; amount: number };

  const itemResult = await supabase.from("order_items").insert({
    tenant_id: member.tenant_id,
    order_id: order.id,
    item_type: product.itemType,
    title: product.code,
    quantity: lineQuantity,
    unit_price: product.unitPrice,
    line_total: amount,
  });

  if (itemResult.error) {
    return NextResponse.json({ error: itemResult.error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      order: {
        id: order.id,
        amount,
        productCode,
        quantity: lineQuantity,
      },
    },
    { status: 201 },
  );
}
