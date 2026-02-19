import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

type TenantRow = {
  id: string;
  name: string;
  status: string;
};

type TenantBillingStat = {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  paidAmount: number;
  refundedAmount: number;
  netAmount: number;
  paidPayments: number;
  refundedPayments: number;
  ordersPaid: number;
  ordersPending: number;
  activeSubscriptions: number;
  expiringIn14Days: number;
};

function num(input: unknown) {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isActiveSubscription(status: string, validTo: string | null, nowMs: number) {
  if (status !== "active") return false;
  if (!validTo) return true;
  const ts = new Date(validTo).getTime();
  if (!Number.isFinite(ts)) return true;
  return ts >= nowMs;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const requestedTenantId = params.get("tenantId");
  const days = Math.min(180, Math.max(1, Number(params.get("days") || 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date();
  const nowMs = now.getTime();
  const expireWindow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const tenantScope = auth.context.role === "platform_admin"
    ? requestedTenantId
      ? [requestedTenantId]
      : null
    : auth.context.tenantId
      ? [auth.context.tenantId]
      : [];

  if (auth.context.role !== "platform_admin" && (!tenantScope || tenantScope.length === 0)) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  let tenantsQuery = auth.supabase
    .from("tenants")
    .select("id, name, status")
    .order("created_at", { ascending: false });

  if (tenantScope && tenantScope.length > 0) {
    tenantsQuery = tenantsQuery.in("id", tenantScope);
  }

  const tenantsResult = await tenantsQuery;
  if (tenantsResult.error) return NextResponse.json({ error: tenantsResult.error.message }, { status: 500 });
  const tenants = (tenantsResult.data || []) as TenantRow[];
  const tenantIds = tenants.map((row) => row.id);
  if (tenantIds.length === 0) {
    return NextResponse.json({
      range: { since, until: new Date().toISOString(), days },
      items: [],
      totals: {
        paidAmount: 0,
        refundedAmount: 0,
        netAmount: 0,
        paidPayments: 0,
        refundedPayments: 0,
        activeSubscriptions: 0,
        expiringIn14Days: 0,
      },
      expiring: [],
    });
  }

  const [ordersResult, paymentsResult, subscriptionsResult, expiringResult] = await Promise.all([
    auth.supabase
      .from("orders")
      .select("tenant_id, status, amount, created_at")
      .in("tenant_id", tenantIds)
      .gte("created_at", since)
      .limit(5000),
    auth.supabase
      .from("payments")
      .select("tenant_id, status, amount, method, created_at, paid_at")
      .in("tenant_id", tenantIds)
      .gte("created_at", since)
      .limit(5000),
    auth.supabase
      .from("subscriptions")
      .select("tenant_id, member_id, status, valid_to")
      .in("tenant_id", tenantIds)
      .limit(5000),
    auth.supabase
      .from("subscriptions")
      .select("tenant_id, member_id, status, valid_to")
      .in("tenant_id", tenantIds)
      .eq("status", "active")
      .gte("valid_to", now.toISOString())
      .lte("valid_to", expireWindow)
      .order("valid_to", { ascending: true })
      .limit(500),
  ]);

  if (ordersResult.error) return NextResponse.json({ error: ordersResult.error.message }, { status: 500 });
  if (paymentsResult.error) return NextResponse.json({ error: paymentsResult.error.message }, { status: 500 });
  if (subscriptionsResult.error) return NextResponse.json({ error: subscriptionsResult.error.message }, { status: 500 });
  if (expiringResult.error) return NextResponse.json({ error: expiringResult.error.message }, { status: 500 });

  const statsByTenant = new Map<string, TenantBillingStat>();
  for (const tenant of tenants) {
    statsByTenant.set(tenant.id, {
      tenantId: tenant.id,
      tenantName: tenant.name || tenant.id,
      tenantStatus: tenant.status || "active",
      paidAmount: 0,
      refundedAmount: 0,
      netAmount: 0,
      paidPayments: 0,
      refundedPayments: 0,
      ordersPaid: 0,
      ordersPending: 0,
      activeSubscriptions: 0,
      expiringIn14Days: 0,
    });
  }

  for (const row of (ordersResult.data || []) as Array<{ tenant_id: string; status: string; amount: number }>) {
    const stat = statsByTenant.get(String(row.tenant_id || ""));
    if (!stat) continue;
    if (row.status === "paid") {
      stat.ordersPaid += 1;
    } else if (!["cancelled", "refunded"].includes(String(row.status || ""))) {
      stat.ordersPending += 1;
    }
  }

  for (const row of (paymentsResult.data || []) as Array<{ tenant_id: string; status: string; amount: number }>) {
    const stat = statsByTenant.get(String(row.tenant_id || ""));
    if (!stat) continue;
    const amount = num(row.amount);
    if (row.status === "paid") {
      stat.paidAmount += amount;
      stat.paidPayments += 1;
    } else if (row.status === "refunded") {
      stat.refundedAmount += amount;
      stat.refundedPayments += 1;
    }
  }

  for (const row of (subscriptionsResult.data || []) as Array<{ tenant_id: string; status: string; valid_to: string | null }>) {
    const stat = statsByTenant.get(String(row.tenant_id || ""));
    if (!stat) continue;
    if (isActiveSubscription(String(row.status || ""), row.valid_to, nowMs)) {
      stat.activeSubscriptions += 1;
    }
  }

  const expiringRows = (expiringResult.data || []) as Array<{
    tenant_id: string;
    member_id: string;
    valid_to: string | null;
  }>;
  const memberIds = Array.from(new Set(expiringRows.map((row) => String(row.member_id || "")).filter(Boolean)));
  const memberNameById = new Map<string, string>();
  if (memberIds.length > 0) {
    const membersResult = await auth.supabase
      .from("members")
      .select("id, full_name")
      .in("id", memberIds);
    if (membersResult.error) return NextResponse.json({ error: membersResult.error.message }, { status: 500 });
    for (const row of (membersResult.data || []) as Array<{ id: string; full_name: string | null }>) {
      memberNameById.set(row.id, row.full_name || row.id);
    }
  }

  const expiring = expiringRows.map((row) => {
    const stat = statsByTenant.get(String(row.tenant_id || ""));
    if (stat) stat.expiringIn14Days += 1;
    return {
      tenantId: row.tenant_id,
      tenantName: stat?.tenantName || row.tenant_id,
      memberId: row.member_id,
      memberName: memberNameById.get(String(row.member_id || "")) || row.member_id,
      validTo: row.valid_to,
    };
  });

  const items = Array.from(statsByTenant.values())
    .map((item) => ({
      ...item,
      paidAmount: Number(item.paidAmount.toFixed(2)),
      refundedAmount: Number(item.refundedAmount.toFixed(2)),
      netAmount: Number((item.paidAmount - item.refundedAmount).toFixed(2)),
      collectionRate: item.ordersPaid + item.ordersPending > 0
        ? Number((item.ordersPaid / (item.ordersPaid + item.ordersPending)).toFixed(4))
        : 0,
    }))
    .sort((a, b) => b.netAmount - a.netAmount);

  const totals = items.reduce(
    (acc, item) => {
      acc.paidAmount += item.paidAmount;
      acc.refundedAmount += item.refundedAmount;
      acc.netAmount += item.netAmount;
      acc.paidPayments += item.paidPayments;
      acc.refundedPayments += item.refundedPayments;
      acc.activeSubscriptions += item.activeSubscriptions;
      acc.expiringIn14Days += item.expiringIn14Days;
      return acc;
    },
    {
      paidAmount: 0,
      refundedAmount: 0,
      netAmount: 0,
      paidPayments: 0,
      refundedPayments: 0,
      activeSubscriptions: 0,
      expiringIn14Days: 0,
    },
  );

  return NextResponse.json({
    range: { since, until: new Date().toISOString(), days },
    items,
    totals: {
      ...totals,
      paidAmount: Number(totals.paidAmount.toFixed(2)),
      refundedAmount: Number(totals.refundedAmount.toFixed(2)),
      netAmount: Number(totals.netAmount.toFixed(2)),
    },
    expiring: expiring.slice(0, 120),
  });
}
