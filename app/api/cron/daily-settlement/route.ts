import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const token = request.headers.get("x-cron-secret") || "";
  return Boolean(secret && token && secret === token);
}

type Aggregate = {
  tenantId: string;
  branchId: string | null;
  totalPaid: number;
  totalRefunded: number;
  cashTotal: number;
  cardTotal: number;
  transferTotal: number;
  newebpayTotal: number;
  orderIds: Set<string>;
  paymentCount: number;
};

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const body = await request.json().catch(() => ({}));
  const settlementDate = typeof body?.date === "string" ? body.date : new Date().toISOString().slice(0, 10);
  const start = `${settlementDate}T00:00:00.000Z`;
  const end = `${settlementDate}T23:59:59.999Z`;

  const { data: payments, error: paymentError } = await supabase
    .from("payments")
    .select("id, tenant_id, order_id, amount, status, method, paid_at")
    .gte("created_at", start)
    .lte("created_at", end)
    .limit(5000);

  if (paymentError) return NextResponse.json({ error: paymentError.message }, { status: 500 });
  const paymentRows = payments || [];
  if (!paymentRows.length) return NextResponse.json({ settlementDate, upserted: 0 });

  const orderIds = Array.from(new Set(paymentRows.map((row) => String(row.order_id))));
  const { data: orders } = await supabase
    .from("orders")
    .select("id, branch_id")
    .in("id", orderIds);

  const branchByOrder = new Map((orders || []).map((o) => [String(o.id), o.branch_id ? String(o.branch_id) : null]));
  const map = new Map<string, Aggregate>();

  for (const row of paymentRows) {
    const tenantId = String(row.tenant_id);
    const branchId = branchByOrder.get(String(row.order_id)) || null;
    const key = `${tenantId}:${branchId || "null"}`;
    if (!map.has(key)) {
      map.set(key, {
        tenantId,
        branchId,
        totalPaid: 0,
        totalRefunded: 0,
        cashTotal: 0,
        cardTotal: 0,
        transferTotal: 0,
        newebpayTotal: 0,
        orderIds: new Set<string>(),
        paymentCount: 0,
      });
    }
    const aggregate = map.get(key)!;
    const amount = Number(row.amount ?? 0);
    const status = String(row.status || "");
    const method = String(row.method || "");

    aggregate.orderIds.add(String(row.order_id));
    aggregate.paymentCount += 1;

    if (status === "paid") {
      aggregate.totalPaid += amount;
      if (method === "cash") aggregate.cashTotal += amount;
      if (method === "card") aggregate.cardTotal += amount;
      if (method === "transfer") aggregate.transferTotal += amount;
      if (method === "newebpay") aggregate.newebpayTotal += amount;
    }
    if (status === "refunded") {
      aggregate.totalRefunded += amount;
    }
  }

  const upserts = Array.from(map.values()).map((agg) => ({
    tenant_id: agg.tenantId,
    branch_id: agg.branchId,
    settlement_date: settlementDate,
    total_paid: agg.totalPaid,
    total_refunded: agg.totalRefunded,
    cash_total: agg.cashTotal,
    card_total: agg.cardTotal,
    transfer_total: agg.transferTotal,
    newebpay_total: agg.newebpayTotal,
    order_count: agg.orderIds.size,
    payment_count: agg.paymentCount,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabase
    .from("daily_settlements")
    .upsert(upserts, { onConflict: "tenant_id,branch_id,settlement_date" });

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  return NextResponse.json({
    settlementDate,
    upserted: upserts.length,
  });
}
