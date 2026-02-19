import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

const ITEM_TYPES = ["subscription", "entry_pass", "product"] as const;

function parseBodyNumber(input: unknown) {
  const n = Number(input);
  return Number.isFinite(n) ? n : NaN;
}

function mapProductRow(row: any) {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    itemType: String(row.item_type),
    unitPrice: Number(row.unit_price ?? 0),
    quantity: Number(row.quantity ?? 1),
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("products")
    .select("id, code, title, item_type, unit_price, quantity, is_active, sort_order, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    if (error.message.includes('relation "products" does not exist')) {
      return NextResponse.json({ error: "products table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: (data ?? []).map(mapProductRow) });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const itemType = ITEM_TYPES.includes(body?.itemType) ? body.itemType : "";
  const unitPrice = parseBodyNumber(body?.unitPrice);
  const quantity = Math.max(1, Math.floor(parseBodyNumber(body?.quantity ?? 1)));
  const isActive = body?.isActive === false ? false : true;
  const sortOrder = Number.isFinite(parseBodyNumber(body?.sortOrder)) ? Math.floor(Number(body.sortOrder)) : 0;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }
  if (!code || !/^[a-z0-9_]+$/i.test(code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!itemType) {
    return NextResponse.json({ error: "Invalid itemType" }, { status: 400 });
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return NextResponse.json({ error: "Invalid unitPrice" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const upsert = await auth.supabase
    .from("products")
    .upsert(
      {
        tenant_id: auth.context.tenantId,
        code,
        title,
        item_type: itemType,
        unit_price: unitPrice,
        quantity,
        is_active: isActive,
        sort_order: sortOrder,
        updated_at: now,
      },
      { onConflict: "tenant_id,code" },
    )
    .select("id, code, title, item_type, unit_price, quantity, is_active, sort_order, created_at, updated_at")
    .maybeSingle();

  if (upsert.error) {
    if (upsert.error.message.includes('relation "products" does not exist')) {
      return NextResponse.json({ error: "products table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: upsert.error.message }, { status: 500 });
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "product_upsert",
    target_type: "product",
    target_id: code,
    reason: "manager_update",
    payload: {
      code,
      title,
      itemType,
      unitPrice,
      quantity,
      isActive,
      sortOrder,
    },
  });

  return NextResponse.json({ product: upsert.data ? mapProductRow(upsert.data) : null }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code || !/^[a-z0-9_]+$/i.test(code)) {
    return NextResponse.json({ error: "Valid code is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body?.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    updates.title = title;
  }

  if ("itemType" in (body || {})) {
    if (!ITEM_TYPES.includes(body?.itemType)) {
      return NextResponse.json({ error: "Invalid itemType" }, { status: 400 });
    }
    updates.item_type = body.itemType;
  }

  if ("unitPrice" in (body || {})) {
    const unitPrice = parseBodyNumber(body?.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: "Invalid unitPrice" }, { status: 400 });
    }
    updates.unit_price = unitPrice;
  }

  if ("quantity" in (body || {})) {
    const quantity = Math.max(1, Math.floor(parseBodyNumber(body?.quantity)));
    if (!quantity) return NextResponse.json({ error: "Invalid quantity" }, { status: 400 });
    updates.quantity = quantity;
  }

  if ("sortOrder" in (body || {})) {
    const sortOrder = parseBodyNumber(body?.sortOrder);
    if (!Number.isFinite(sortOrder)) return NextResponse.json({ error: "Invalid sortOrder" }, { status: 400 });
    updates.sort_order = Math.floor(sortOrder);
  }

  if (typeof body?.isActive === "boolean") {
    updates.is_active = body.isActive;
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: "no updates provided" }, { status: 400 });
  }

  const updateResult = await auth.supabase
    .from("products")
    .update(updates)
    .eq("tenant_id", auth.context.tenantId)
    .eq("code", code)
    .select("id, code, title, item_type, unit_price, quantity, is_active, sort_order, created_at, updated_at")
    .maybeSingle();

  if (updateResult.error) {
    if (updateResult.error.message.includes('relation "products" does not exist')) {
      return NextResponse.json({ error: "products table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }
  if (!updateResult.data) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "product_update",
    target_type: "product",
    target_id: code,
    reason: "manager_update",
    payload: updates,
  });

  return NextResponse.json({ product: mapProductRow(updateResult.data) });
}
