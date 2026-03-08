import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import {
  evaluateTenantAccess,
  type TenantStatus,
  type TenantSubscriptionSnapshot,
} from "../../../../lib/tenant-subscription";

type TenantRow = {
  id: string;
  name: string;
  status: TenantStatus;
};

type TenantBillingStat = {
  tenantId: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  paidAmount: number;
  refundedAmount: number;
  netAmount: number;
  paidPayments: number;
  refundedPayments: number;
  ordersPaid: number;
  ordersPending: number;
  activeSubscriptions: number;
  expiringIn14Days: number;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: TenantSubscriptionSnapshot["status"];
  subscriptionStartsAt: string | null;
  subscriptionEndsAt: string | null;
  subscriptionGraceEndsAt: string | null;
  subscriptionRemainingDays: number | null;
  subscriptionUsable: boolean;
  subscriptionAccessCode: string | null;
};

type TenantSubscriptionRow = {
  tenant_id: string;
  plan_id: string | null;
  plan_code: string | null;
  status: TenantSubscriptionSnapshot["status"];
  starts_at: string | null;
  ends_at: string | null;
  grace_ends_at: string | null;
};

type PlanRow = {
  id: string;
  code: string;
  name: string;
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

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Admin client init failed");
  }

  const params = new URL(request.url).searchParams;
  const requestedTenantId = params.get("tenantId");
  const days = Math.min(180, Math.max(1, Number(params.get("days") || 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date();
  const nowMs = now.getTime();
  const expireWindow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const tenantScope =
    auth.context.role === "platform_admin"
      ? requestedTenantId
        ? [requestedTenantId]
        : null
      : auth.context.tenantId
        ? [auth.context.tenantId]
        : [];

  if (auth.context.role !== "platform_admin" && (!tenantScope || tenantScope.length === 0)) {
    return apiError(400, "FORBIDDEN", "Missing tenant context");
  }

  let tenantsQuery = admin.from("tenants").select("id, name, status").order("created_at", { ascending: false });
  if (tenantScope && tenantScope.length > 0) {
    tenantsQuery = tenantsQuery.in("id", tenantScope);
  }

  const tenantsResult = await tenantsQuery;
  if (tenantsResult.error) return apiError(500, "INTERNAL_ERROR", tenantsResult.error.message);
  const tenants = (tenantsResult.data || []) as TenantRow[];
  const tenantIds = tenants.map((row) => row.id);
  if (tenantIds.length === 0) {
    return apiSuccess({
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
        usableTenants: 0,
      },
      expiring: [],
    });
  }

  const [ordersResult, paymentsResult, subscriptionsResult, expiringResult, tenantSubscriptionsResult] = await Promise.all([
    admin.from("orders").select("tenant_id, status, amount, created_at").in("tenant_id", tenantIds).gte("created_at", since).limit(5000),
    admin
      .from("payments")
      .select("tenant_id, status, amount, method, created_at, paid_at")
      .in("tenant_id", tenantIds)
      .gte("created_at", since)
      .limit(5000),
    admin.from("subscriptions").select("tenant_id, member_id, status, valid_to").in("tenant_id", tenantIds).limit(5000),
    admin
      .from("subscriptions")
      .select("tenant_id, member_id, status, valid_to")
      .in("tenant_id", tenantIds)
      .eq("status", "active")
      .gte("valid_to", now.toISOString())
      .lte("valid_to", expireWindow)
      .order("valid_to", { ascending: true })
      .limit(500),
    admin
      .from("tenant_subscriptions")
      .select("tenant_id, plan_id, plan_code, status, starts_at, ends_at, grace_ends_at")
      .in("tenant_id", tenantIds)
      .eq("is_current", true),
  ]);

  if (ordersResult.error) return apiError(500, "INTERNAL_ERROR", ordersResult.error.message);
  if (paymentsResult.error) return apiError(500, "INTERNAL_ERROR", paymentsResult.error.message);
  if (subscriptionsResult.error) return apiError(500, "INTERNAL_ERROR", subscriptionsResult.error.message);
  if (expiringResult.error) return apiError(500, "INTERNAL_ERROR", expiringResult.error.message);
  if (tenantSubscriptionsResult.error) return apiError(500, "INTERNAL_ERROR", tenantSubscriptionsResult.error.message);

  const tenantSubscriptions = (tenantSubscriptionsResult.data || []) as TenantSubscriptionRow[];
  const planIds = Array.from(new Set(tenantSubscriptions.map((row) => row.plan_id).filter((id): id is string => Boolean(id))));

  const planNameById = new Map<string, PlanRow>();
  if (planIds.length > 0) {
    const plansResult = await admin.from("saas_plans").select("id, code, name").in("id", planIds);
    if (plansResult.error) return apiError(500, "INTERNAL_ERROR", plansResult.error.message);
    for (const row of (plansResult.data || []) as PlanRow[]) {
      planNameById.set(row.id, row);
    }
  }

  const subscriptionByTenant = new Map<string, TenantSubscriptionSnapshot>();
  for (const row of tenantSubscriptions) {
    const plan = row.plan_id ? planNameById.get(row.plan_id) : null;
    const planCode = row.plan_code ?? plan?.code ?? null;
    subscriptionByTenant.set(row.tenant_id, {
      status: row.status ?? null,
      startsAt: row.starts_at ?? null,
      endsAt: row.ends_at ?? null,
      graceEndsAt: row.grace_ends_at ?? null,
      planCode,
      planName: plan?.name ?? null,
    });
  }

  const statsByTenant = new Map<string, TenantBillingStat>();
  for (const tenant of tenants) {
    const subscription = subscriptionByTenant.get(tenant.id) ?? null;
    const access = evaluateTenantAccess({
      tenantStatus: tenant.status ?? null,
      subscription,
    });
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
      planCode: subscription?.planCode ?? null,
      planName: subscription?.planName ?? null,
      subscriptionStatus: access.effectiveStatus === "none" ? null : access.effectiveStatus,
      subscriptionStartsAt: subscription?.startsAt ?? null,
      subscriptionEndsAt: subscription?.endsAt ?? null,
      subscriptionGraceEndsAt: subscription?.graceEndsAt ?? null,
      subscriptionRemainingDays: access.remainingDays,
      subscriptionUsable: access.allowed,
      subscriptionAccessCode: access.blockedCode,
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
    const membersResult = await admin.from("members").select("id, full_name").in("id", memberIds);
    if (membersResult.error) return apiError(500, "INTERNAL_ERROR", membersResult.error.message);
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
      collectionRate:
        item.ordersPaid + item.ordersPending > 0
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
      acc.usableTenants += item.subscriptionUsable ? 1 : 0;
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
      usableTenants: 0,
    },
  );

  return apiSuccess({
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
