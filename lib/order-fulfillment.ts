const MONTHLY_30D_CODE = "monthly_30d";
const SINGLE_PASS_CODE = "single_pass";
const PUNCH_10_CODE = "punch_10";

type SupabaseLike = {
  from: (table: string) => any;
};

interface FulfillOrderInput {
  supabase: SupabaseLike;
  tenantId: string;
  orderId: string;
  actorId: string | null;
  memberId: string | null;
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseCodeQuantity(lineTitle: string, quantity: number) {
  const q = Math.max(1, Number(quantity || 1));
  const code = String(lineTitle || "").trim();
  return { code, quantity: q };
}

export async function fulfillOrderEntitlements(input: FulfillOrderInput) {
  if (!input.memberId) {
    return { ok: false as const, fulfilled: false, reason: "missing_member_id" };
  }

  const existing = await input.supabase
    .from("audit_logs")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("action", "order_fulfilled")
    .eq("target_type", "order")
    .eq("target_id", input.orderId)
    .limit(1)
    .maybeSingle();

  if (existing.data) {
    return { ok: true as const, fulfilled: false, reason: "already_fulfilled" };
  }

  const lineResult = await input.supabase
    .from("order_items")
    .select("id, title, quantity, item_type")
    .eq("tenant_id", input.tenantId)
    .eq("order_id", input.orderId);

  if (lineResult.error) {
    return { ok: false as const, fulfilled: false, reason: lineResult.error.message };
  }

  const lines = (lineResult.data || []) as Array<{
    id: string;
    title: string;
    quantity: number;
    item_type: string;
  }>;

  if (!lines.length) {
    return { ok: true as const, fulfilled: false, reason: "no_order_items" };
  }

  const grants: Array<Record<string, unknown>> = [];
  const now = new Date();
  for (const line of lines) {
    const parsed = parseCodeQuantity(line.title, line.quantity);

    if (line.item_type === "subscription" && parsed.code === MONTHLY_30D_CODE) {
      const sub = await input.supabase
        .from("subscriptions")
        .select("id, valid_to, status")
        .eq("tenant_id", input.tenantId)
        .eq("member_id", input.memberId)
        .eq("status", "active")
        .gte("valid_to", now.toISOString())
        .order("valid_to", { ascending: false })
        .limit(1)
        .maybeSingle();

      const startAt = sub.data?.valid_to ? new Date(String(sub.data.valid_to)) : now;
      const validTo = addDays(startAt, 30 * parsed.quantity);

      const insertResult = await input.supabase.from("subscriptions").insert({
        tenant_id: input.tenantId,
        member_id: input.memberId,
        valid_from: startAt.toISOString(),
        valid_to: validTo.toISOString(),
        status: "active",
      });

      if (insertResult.error) {
        return { ok: false as const, fulfilled: false, reason: insertResult.error.message };
      }

      grants.push({
        type: "subscription",
        code: MONTHLY_30D_CODE,
        months: parsed.quantity,
        validFrom: startAt.toISOString(),
        validTo: validTo.toISOString(),
      });
      continue;
    }

    if (line.item_type === "entry_pass" && parsed.code === SINGLE_PASS_CODE) {
      const remaining = parsed.quantity;
      const expiresAt = addDays(now, 30).toISOString();
      const insertResult = await input.supabase.from("entry_passes").insert({
        tenant_id: input.tenantId,
        member_id: input.memberId,
        pass_type: "single",
        remaining,
        expires_at: expiresAt,
        status: "active",
      });

      if (insertResult.error) {
        return { ok: false as const, fulfilled: false, reason: insertResult.error.message };
      }

      grants.push({
        type: "entry_pass",
        code: SINGLE_PASS_CODE,
        remaining,
        expiresAt,
      });
      continue;
    }

    if (line.item_type === "entry_pass" && parsed.code === PUNCH_10_CODE) {
      const remaining = parsed.quantity * 10;
      const expiresAt = addDays(now, 180).toISOString();
      const insertResult = await input.supabase.from("entry_passes").insert({
        tenant_id: input.tenantId,
        member_id: input.memberId,
        pass_type: "punch",
        remaining,
        expires_at: expiresAt,
        status: "active",
      });

      if (insertResult.error) {
        return { ok: false as const, fulfilled: false, reason: insertResult.error.message };
      }

      grants.push({
        type: "entry_pass",
        code: PUNCH_10_CODE,
        remaining,
        expiresAt,
      });
    }
  }

  await input.supabase.from("audit_logs").insert({
    tenant_id: input.tenantId,
    actor_id: input.actorId,
    action: "order_fulfilled",
    target_type: "order",
    target_id: input.orderId,
    reason: "payment_settled",
    payload: { memberId: input.memberId, grants },
  });

  return { ok: true as const, fulfilled: true, reason: null };
}

export const PURCHASE_PRODUCT_CODES = {
  MONTHLY_30D_CODE,
  SINGLE_PASS_CODE,
  PUNCH_10_CODE,
} as const;
