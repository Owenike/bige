import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";

const MEMBER_CODE_RE = /^\d{1,4}$/;
const PAYMENT_METHODS = ["cash", "card", "transfer", "manual", "newebpay"] as const;
const PRODUCT_CODE_RE = /^[a-z0-9_]+$/i;

function parseIntSafe(input: unknown) {
  const n = Number(input);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.floor(n);
}

function parseNumberSafe(input: unknown) {
  const n = Number(input);
  return Number.isFinite(n) ? n : Number.NaN;
}

function isInventoryTableMissing(message: string) {
  return message.includes('relation "frontdesk_product_inventory" does not exist')
    || message.includes('relation "frontdesk_product_inventory_moves" does not exist')
    || message.includes("Could not find the table 'public.frontdesk_product_inventory' in the schema cache")
    || message.includes("Could not find the table 'public.frontdesk_product_inventory_moves' in the schema cache");
}

function isProductsTableMissing(message: string) {
  return message.includes('relation "products" does not exist')
    || message.includes("Could not find the table 'public.products' in the schema cache");
}

function normalizeMemberCode(input: unknown) {
  if (typeof input !== "string") return "";
  return input.trim();
}

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }
  if (!auth.context.branchId) {
    return NextResponse.json({ error: "Missing branch context" }, { status: 400 });
  }

  const productsResult = await auth.supabase
    .from("products")
    .select("code, title, unit_price, quantity, sort_order, is_active, item_type, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("is_active", true)
    .eq("item_type", "product")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (productsResult.error) {
    if (isProductsTableMissing(productsResult.error.message)) {
      return NextResponse.json({ error: "products table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: productsResult.error.message }, { status: 500 });
  }

  const inventoryResult = await auth.supabase
    .from("frontdesk_product_inventory")
    .select("product_code, on_hand, safety_stock, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId);

  if (inventoryResult.error) {
    if (isInventoryTableMissing(inventoryResult.error.message)) {
      return NextResponse.json({ error: "inventory table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: inventoryResult.error.message }, { status: 500 });
  }

  const movesResult = await auth.supabase
    .from("frontdesk_product_inventory_moves")
    .select("id, product_code, delta, reason, note, order_id, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (movesResult.error) {
    if (isInventoryTableMissing(movesResult.error.message)) {
      return NextResponse.json({ error: "inventory table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: movesResult.error.message }, { status: 500 });
  }

  const inventoryByCode = new Map<string, { on_hand: number; safety_stock: number; updated_at: string }>();
  for (const row of (inventoryResult.data || []) as Array<{ product_code: string; on_hand: number; safety_stock: number; updated_at: string }>) {
    inventoryByCode.set(String(row.product_code), {
      on_hand: Number(row.on_hand ?? 0),
      safety_stock: Number(row.safety_stock ?? 5),
      updated_at: row.updated_at,
    });
  }

  const items = (productsResult.data || []).map((row: any) => {
    const inventory = inventoryByCode.get(String(row.code));
    const onHand = Number(inventory?.on_hand ?? 0);
    const safetyStock = Number(inventory?.safety_stock ?? 5);
    return {
      code: String(row.code),
      title: String(row.title || row.code),
      unitPrice: Number(row.unit_price ?? 0),
      unitQuantity: Number(row.quantity ?? 1),
      onHand,
      safetyStock,
      isLowStock: onHand <= safetyStock,
    };
  });

  const moves = (movesResult.data || []).map((row: any) => ({
    id: String(row.id),
    productCode: String(row.product_code || ""),
    delta: Number(row.delta ?? 0),
    reason: String(row.reason || ""),
    note: row.note ? String(row.note) : "",
    orderId: row.order_id ? String(row.order_id) : null,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ items, moves });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }
  if (!auth.context.branchId) {
    return NextResponse.json({ error: "Missing branch context" }, { status: 400 });
  }

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const action = body?.action === "adjust"
    ? "adjust"
    : body?.action === "create_product"
      ? "create_product"
      : "sale";

  if (action === "create_product") {
    const productCode = typeof body?.productCode === "string" ? body.productCode.trim() : "";
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const unitPrice = parseNumberSafe(body?.unitPrice);
    const openingOnHand = parseIntSafe(body?.openingOnHand);
    const safetyStock = parseIntSafe(body?.safetyStock);
    const sortOrder = Number.isFinite(parseIntSafe(body?.sortOrder)) ? parseIntSafe(body?.sortOrder) : 0;

    if (!productCode || !PRODUCT_CODE_RE.test(productCode)) {
      return NextResponse.json({ error: "Invalid productCode format" }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: "Invalid unitPrice" }, { status: 400 });
    }
    if (!Number.isFinite(openingOnHand) || openingOnHand < 0) {
      return NextResponse.json({ error: "Invalid openingOnHand" }, { status: 400 });
    }
    if (!Number.isFinite(safetyStock) || safetyStock < 0) {
      return NextResponse.json({ error: "Invalid safetyStock" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const productUpsert = await auth.supabase
      .from("products")
      .upsert({
        tenant_id: auth.context.tenantId,
        code: productCode,
        title,
        item_type: "product",
        unit_price: unitPrice,
        quantity: 1,
        is_active: true,
        sort_order: sortOrder,
        updated_at: now,
      }, { onConflict: "tenant_id,code" })
      .select("code, title, unit_price, item_type, sort_order, updated_at")
      .maybeSingle();

    if (productUpsert.error) {
      if (isProductsTableMissing(productUpsert.error.message)) {
        return NextResponse.json({ error: "products table missing. Apply migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: productUpsert.error.message }, { status: 500 });
    }
    if (!productUpsert.data) {
      return NextResponse.json({ error: "Create product failed" }, { status: 500 });
    }

    const inventoryUpsert = await auth.supabase
      .from("frontdesk_product_inventory")
      .upsert({
        tenant_id: auth.context.tenantId,
        branch_id: auth.context.branchId,
        product_code: productCode,
        on_hand: openingOnHand,
        safety_stock: safetyStock,
        updated_by: auth.context.userId,
        updated_at: now,
      }, { onConflict: "tenant_id,branch_id,product_code" })
      .select("product_code, on_hand, safety_stock, updated_at")
      .maybeSingle();

    if (inventoryUpsert.error) {
      if (isInventoryTableMissing(inventoryUpsert.error.message)) {
        return NextResponse.json({ error: "inventory table missing. Apply migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: inventoryUpsert.error.message }, { status: 500 });
    }

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "frontdesk_product_upsert",
      target_type: "product",
      target_id: productCode,
      reason: "frontdesk_inventory_create_product",
      payload: {
        code: productCode,
        title,
        unitPrice,
        openingOnHand,
        safetyStock,
        sortOrder,
      },
    });

    return NextResponse.json({
      product: {
        code: String(productUpsert.data.code),
        title: String(productUpsert.data.title || productCode),
        unitPrice: Number(productUpsert.data.unit_price ?? unitPrice),
        sortOrder: Number(productUpsert.data.sort_order ?? sortOrder),
        updatedAt: productUpsert.data.updated_at || now,
      },
      inventory: {
        productCode: String(inventoryUpsert.data?.product_code || productCode),
        onHand: Number(inventoryUpsert.data?.on_hand ?? openingOnHand),
        safetyStock: Number(inventoryUpsert.data?.safety_stock ?? safetyStock),
        updatedAt: inventoryUpsert.data?.updated_at || now,
      },
    }, { status: 201 });
  }

  const productCode = typeof body?.productCode === "string" ? body.productCode.trim() : "";
  if (!productCode) {
    return NextResponse.json({ error: "productCode is required" }, { status: 400 });
  }

  const productResult = await auth.supabase
    .from("products")
    .select("code, title, unit_price, item_type, is_active")
    .eq("tenant_id", auth.context.tenantId)
    .eq("code", productCode)
    .eq("is_active", true)
    .eq("item_type", "product")
    .maybeSingle();

  if (productResult.error) {
    if (isProductsTableMissing(productResult.error.message)) {
      return NextResponse.json({ error: "products table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: productResult.error.message }, { status: 500 });
  }
  if (!productResult.data) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const inventoryResult = await auth.supabase
    .from("frontdesk_product_inventory")
    .select("id, on_hand, safety_stock")
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .eq("product_code", productCode)
    .maybeSingle();

  if (inventoryResult.error) {
    if (isInventoryTableMissing(inventoryResult.error.message)) {
      return NextResponse.json({ error: "inventory table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: inventoryResult.error.message }, { status: 500 });
  }

  if (action === "adjust") {
    const delta = parseIntSafe(body?.delta);
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!Number.isFinite(delta) || delta === 0) {
      return NextResponse.json({ error: "delta must be a non-zero integer" }, { status: 400 });
    }

    const currentOnHand = Number(inventoryResult.data?.on_hand ?? 0);
    const nextOnHand = currentOnHand + delta;
    if (nextOnHand < 0) {
      return NextResponse.json({ error: "Insufficient stock for this adjustment" }, { status: 409 });
    }

    const now = new Date().toISOString();
    let upsertedInventory;
    if (inventoryResult.data?.id) {
      const updateResult = await auth.supabase
        .from("frontdesk_product_inventory")
        .update({
          on_hand: nextOnHand,
          updated_at: now,
          updated_by: auth.context.userId,
        })
        .eq("id", inventoryResult.data.id)
        .select("product_code, on_hand, safety_stock, updated_at")
        .maybeSingle();
      if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
      upsertedInventory = updateResult.data;
    } else {
      const insertResult = await auth.supabase
        .from("frontdesk_product_inventory")
        .insert({
          tenant_id: auth.context.tenantId,
          branch_id: auth.context.branchId,
          product_code: productCode,
          on_hand: nextOnHand,
          safety_stock: 5,
          updated_at: now,
          updated_by: auth.context.userId,
        })
        .select("product_code, on_hand, safety_stock, updated_at")
        .maybeSingle();
      if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
      upsertedInventory = insertResult.data;
    }

    const moveResult = await auth.supabase.from("frontdesk_product_inventory_moves").insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      product_code: productCode,
      delta,
      reason: delta > 0 ? "restock" : "adjustment",
      note: note || null,
      actor_id: auth.context.userId,
    });
    if (moveResult.error) return NextResponse.json({ error: moveResult.error.message }, { status: 500 });

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "inventory_adjust",
      target_type: "product_inventory",
      target_id: productCode,
      reason: delta > 0 ? "restock" : "adjustment",
      payload: {
        delta,
        note: note || null,
        onHand: Number(upsertedInventory?.on_hand ?? 0),
      },
    });

    return NextResponse.json({
      inventory: {
        productCode: String(upsertedInventory?.product_code || productCode),
        onHand: Number(upsertedInventory?.on_hand ?? nextOnHand),
        safetyStock: Number(upsertedInventory?.safety_stock ?? 5),
        updatedAt: upsertedInventory?.updated_at || now,
      },
    });
  }

  const quantity = parseIntSafe(body?.quantity);
  const paymentMethodInput = typeof body?.paymentMethod === "string" ? body.paymentMethod.trim() : "";
  const paymentMethod = PAYMENT_METHODS.find((method) => method === paymentMethodInput);
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const memberCodeInput = normalizeMemberCode(body?.memberCode);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "quantity must be a positive integer" }, { status: 400 });
  }
  if (!paymentMethod) {
    return NextResponse.json({ error: "Invalid paymentMethod" }, { status: 400 });
  }

  const currentOnHand = Number(inventoryResult.data?.on_hand ?? 0);
  if (!inventoryResult.data || currentOnHand < quantity) {
    return NextResponse.json({ error: "Insufficient inventory stock" }, { status: 409 });
  }

  let memberId: string | null = null;
  let memberCode: string | null = null;
  if (memberCodeInput) {
    if (!MEMBER_CODE_RE.test(memberCodeInput)) {
      return NextResponse.json({ error: "Invalid memberCode format. Use 1-9999." }, { status: 400 });
    }
    const memberCodeNum = Number(memberCodeInput);
    if (!Number.isInteger(memberCodeNum) || memberCodeNum < 1 || memberCodeNum > 9999) {
      return NextResponse.json({ error: "Invalid memberCode format. Use 1-9999." }, { status: 400 });
    }
    const normalizedCode = String(memberCodeNum);
    const memberResult = await auth.supabase
      .from("members")
      .select("id, member_code")
      .eq("tenant_id", auth.context.tenantId)
      .in("member_code", Array.from(new Set([memberCodeInput, normalizedCode])))
      .limit(1)
      .maybeSingle();

    if (memberResult.error) return NextResponse.json({ error: memberResult.error.message }, { status: 500 });
    if (!memberResult.data?.id) return NextResponse.json({ error: "Member not found by member code" }, { status: 404 });
    memberId = String(memberResult.data.id);
    memberCode = memberResult.data.member_code ? String(memberResult.data.member_code) : normalizedCode;
  }

  const unitPrice = parseNumberSafe(productResult.data.unit_price ?? 0);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return NextResponse.json({ error: "Invalid product price" }, { status: 400 });
  }
  const totalAmount = unitPrice * quantity;
  const now = new Date().toISOString();

  const orderInsert = await auth.supabase
    .from("orders")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      member_id: memberId,
      amount: totalAmount,
      status: "confirmed",
      channel: "frontdesk",
      note: note || `product_sale:${productCode}x${quantity}`,
      created_by: auth.context.userId,
      updated_at: now,
    })
    .select("id, amount, status, created_at")
    .maybeSingle();

  if (orderInsert.error) return NextResponse.json({ error: orderInsert.error.message }, { status: 500 });
  if (!orderInsert.data?.id) return NextResponse.json({ error: "Order creation failed" }, { status: 500 });

  const orderId = String(orderInsert.data.id);
  const orderItemInsert = await auth.supabase.from("order_items").insert({
    tenant_id: auth.context.tenantId,
    order_id: orderId,
    item_type: "product",
    title: String(productResult.data.title || productCode),
    quantity,
    unit_price: unitPrice,
    line_total: totalAmount,
  });
  if (orderItemInsert.error) return NextResponse.json({ error: orderItemInsert.error.message }, { status: 500 });

  const paymentInsert = await auth.supabase
    .from("payments")
    .insert({
      tenant_id: auth.context.tenantId,
      order_id: orderId,
      amount: totalAmount,
      status: "paid",
      method: paymentMethod,
      paid_at: now,
      updated_at: now,
    })
    .select("id, method, amount, paid_at")
    .maybeSingle();
  if (paymentInsert.error) return NextResponse.json({ error: paymentInsert.error.message }, { status: 500 });

  const orderStatusUpdate = await auth.supabase
    .from("orders")
    .update({ status: "paid", updated_at: now })
    .eq("id", orderId)
    .eq("tenant_id", auth.context.tenantId);
  if (orderStatusUpdate.error) return NextResponse.json({ error: orderStatusUpdate.error.message }, { status: 500 });

  const nextOnHand = currentOnHand - quantity;
  const inventoryUpdate = await auth.supabase
    .from("frontdesk_product_inventory")
    .update({
      on_hand: nextOnHand,
      updated_at: now,
      updated_by: auth.context.userId,
    })
    .eq("id", inventoryResult.data.id)
    .select("product_code, on_hand, safety_stock, updated_at")
    .maybeSingle();
  if (inventoryUpdate.error) return NextResponse.json({ error: inventoryUpdate.error.message }, { status: 500 });

  const moveInsert = await auth.supabase.from("frontdesk_product_inventory_moves").insert({
    tenant_id: auth.context.tenantId,
    branch_id: auth.context.branchId,
    product_code: productCode,
    delta: -quantity,
    reason: "sale",
    note: note || null,
    order_id: orderId,
    actor_id: auth.context.userId,
  });
  if (moveInsert.error) return NextResponse.json({ error: moveInsert.error.message }, { status: 500 });

  if (shiftGuard.shift?.id) {
    await auth.supabase.from("frontdesk_shift_items").insert({
      tenant_id: auth.context.tenantId,
      shift_id: shiftGuard.shift.id,
      kind: "payment",
      ref_id: orderId,
      amount: totalAmount,
      summary: `product_sale:${productCode}x${quantity}:${paymentMethod}`,
    });
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "product_sale",
    target_type: "order",
    target_id: orderId,
    reason: "frontdesk_inventory_sale",
    payload: {
      productCode,
      productTitle: productResult.data.title || productCode,
      quantity,
      unitPrice,
      totalAmount,
      paymentMethod,
      memberId,
      memberCode,
    },
  });

  return NextResponse.json({
    order: {
      id: orderId,
      amount: totalAmount,
      paymentMethod,
      memberCode,
      createdAt: orderInsert.data.created_at,
    },
    inventory: {
      productCode: String(inventoryUpdate.data?.product_code || productCode),
      onHand: Number(inventoryUpdate.data?.on_hand ?? nextOnHand),
      safetyStock: Number(inventoryUpdate.data?.safety_stock ?? 5),
      updatedAt: inventoryUpdate.data?.updated_at || now,
    },
  }, { status: 201 });
}
