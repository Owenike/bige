import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { claimIdempotency, finalizeIdempotency } from "../../../../lib/idempotency";
import { evaluateTenantAccess, type TenantStatus, type TenantSubscriptionSnapshot } from "../../../../lib/tenant-subscription";

type PlanRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type TenantRow = {
  id: string;
  name: string;
  status: TenantStatus;
};

type TenantSubscriptionRow = {
  id: string;
  tenant_id: string;
  plan_id: string | null;
  plan_code: string | null;
  status: TenantSubscriptionSnapshot["status"];
  starts_at: string | null;
  ends_at: string | null;
  grace_ends_at: string | null;
  suspended_at: string | null;
  canceled_at: string | null;
  notes: string | null;
  updated_at: string;
  created_at: string;
};

const VALID_STATUSES: Array<NonNullable<TenantSubscriptionSnapshot["status"]>> = [
  "trial",
  "active",
  "grace",
  "suspended",
  "expired",
  "canceled",
];

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeStatus(value: unknown): TenantSubscriptionSnapshot["status"] {
  if (typeof value !== "string") return null;
  return VALID_STATUSES.includes(value as NonNullable<TenantSubscriptionSnapshot["status"]>)
    ? (value as TenantSubscriptionSnapshot["status"])
    : null;
}

function planNameFromCode(code: string) {
  return code
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toSubscriptionSnapshot(row: TenantSubscriptionRow, planName: string | null): TenantSubscriptionSnapshot {
  return {
    status: row.status ?? null,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    graceEndsAt: row.grace_ends_at ?? null,
    planCode: row.plan_code ?? null,
    planName,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const tenantId = params.get("tenantId");

  const [plansResult, tenantsResult, subscriptionsResult] = await Promise.all([
    auth.supabase.from("saas_plans").select("id, code, name, description, is_active").order("code", { ascending: true }),
    tenantId
      ? auth.supabase.from("tenants").select("id, name, status").eq("id", tenantId)
      : auth.supabase.from("tenants").select("id, name, status").order("name", { ascending: true }).limit(500),
    tenantId
      ? auth.supabase.from("tenant_subscriptions").select("*").eq("tenant_id", tenantId).eq("is_current", true).limit(1)
      : auth.supabase.from("tenant_subscriptions").select("*").eq("is_current", true).limit(500),
  ]);

  if (plansResult.error) return apiError(500, "INTERNAL_ERROR", plansResult.error.message);
  if (tenantsResult.error) return apiError(500, "INTERNAL_ERROR", tenantsResult.error.message);
  if (subscriptionsResult.error) return apiError(500, "INTERNAL_ERROR", subscriptionsResult.error.message);

  const plans = (plansResult.data || []) as PlanRow[];
  const tenants = (tenantsResult.data || []) as TenantRow[];
  const subscriptions = (subscriptionsResult.data || []) as TenantSubscriptionRow[];

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const subscriptionByTenant = new Map(subscriptions.map((row) => [row.tenant_id, row]));

  const items = tenants.map((tenant) => {
    const row = subscriptionByTenant.get(tenant.id) ?? null;
    const plan = row?.plan_id ? planById.get(row.plan_id) : null;
    const snapshot = row ? toSubscriptionSnapshot(row, plan?.name ?? (row.plan_code ? planNameFromCode(row.plan_code) : null)) : null;
    const access = evaluateTenantAccess({
      tenantStatus: tenant.status ?? null,
      subscription: snapshot,
    });

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantStatus: tenant.status,
      subscriptionId: row?.id ?? null,
      planCode: snapshot?.planCode ?? null,
      planName: snapshot?.planName ?? null,
      status: snapshot?.status ?? null,
      startsAt: snapshot?.startsAt ?? null,
      endsAt: snapshot?.endsAt ?? null,
      graceEndsAt: snapshot?.graceEndsAt ?? null,
      notes: row?.notes ?? null,
      createdAt: row?.created_at ?? null,
      updatedAt: row?.updated_at ?? null,
      remainingDays: access.remainingDays,
      isUsable: access.allowed,
      blockedCode: access.blockedCode,
      warningCode: access.warningCode,
    };
  });

  return apiSuccess({
    items,
    plans,
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  const planCode = typeof body?.planCode === "string" ? body.planCode.trim().toLowerCase() : "";
  const status = normalizeStatus(body?.status) ?? "active";
  const startsAt = toIsoOrNull(body?.startsAt) ?? new Date().toISOString();
  const endsAt = toIsoOrNull(body?.endsAt);
  const graceEndsAt = toIsoOrNull(body?.graceEndsAt);
  const notes = typeof body?.notes === "string" ? body.notes.trim() || null : null;
  const idempotencyKeyInput = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!tenantId) return apiError(400, "FORBIDDEN", "tenantId is required");
  if (!planCode) return apiError(400, "FORBIDDEN", "planCode is required");
  if (!endsAt && (status === "active" || status === "trial" || status === "grace")) {
    return apiError(400, "INVALID_SUBSCRIPTION_STATE", "endsAt is required for active/trial/grace statuses");
  }
  if (status === "grace" && !graceEndsAt) {
    return apiError(400, "INVALID_SUBSCRIPTION_STATE", "graceEndsAt is required for grace status");
  }

  const [tenantResult, planResult] = await Promise.all([
    auth.supabase.from("tenants").select("id, status").eq("id", tenantId).maybeSingle(),
    auth.supabase.from("saas_plans").select("id, code, name, is_active").eq("code", planCode).maybeSingle(),
  ]);

  if (tenantResult.error) return apiError(500, "INTERNAL_ERROR", tenantResult.error.message);
  if (!tenantResult.data) return apiError(404, "FORBIDDEN", "Tenant not found");
  if (planResult.error) return apiError(500, "INTERNAL_ERROR", planResult.error.message);
  if (!planResult.data || !planResult.data.is_active) {
    return apiError(400, "INVALID_SUBSCRIPTION_STATE", "Plan not found or inactive");
  }

  const nowIso = new Date().toISOString();
  const operationKey =
    idempotencyKeyInput ||
    ["tenant_subscription_upsert", tenantId, planCode, status, startsAt, endsAt || "na", graceEndsAt || "na"].join(":");
  const operationClaim = await claimIdempotency({
    supabase: auth.supabase,
    tenantId,
    operationKey,
    actorId: auth.context.userId,
    ttlMinutes: 60,
  });
  if (!operationClaim.ok) return apiError(500, "INTERNAL_ERROR", operationClaim.error);
  if (!operationClaim.claimed) {
    if (operationClaim.existing?.status === "succeeded" && operationClaim.existing.response) {
      return apiSuccess({ replayed: true, ...operationClaim.existing.response });
    }
    return apiError(409, "FORBIDDEN", "Duplicate subscription update request in progress");
  }

  const existingResult = await auth.supabase
    .from("tenant_subscriptions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_current", true)
    .maybeSingle();
  if (existingResult.error) return apiError(500, "INTERNAL_ERROR", existingResult.error.message);

  const payload = {
    tenant_id: tenantId,
    plan_id: planResult.data.id,
    plan_code: planResult.data.code,
    status,
    starts_at: startsAt,
    ends_at: endsAt,
    grace_ends_at: graceEndsAt,
    suspended_at: status === "suspended" ? nowIso : null,
    canceled_at: status === "canceled" ? nowIso : null,
    notes,
    updated_by: auth.context.userId,
    updated_at: nowIso,
    is_current: true,
  };

  let subscription: TenantSubscriptionRow | null = null;
  let action = "tenant_subscription_created";

  if (existingResult.data?.id) {
    action = "tenant_subscription_updated";
    const updateResult = await auth.supabase
      .from("tenant_subscriptions")
      .update(payload)
      .eq("id", existingResult.data.id)
      .select("*")
      .maybeSingle();
    if (updateResult.error) {
      await finalizeIdempotency({
        supabase: auth.supabase,
        tenantId,
        operationKey,
        status: "failed",
        errorCode: "SUBSCRIPTION_UPDATE_FAILED",
      });
      return apiError(500, "INTERNAL_ERROR", updateResult.error.message);
    }
    subscription = (updateResult.data as TenantSubscriptionRow | null) ?? null;
  } else {
    const insertResult = await auth.supabase
      .from("tenant_subscriptions")
      .insert({
        ...payload,
        created_by: auth.context.userId,
        created_at: nowIso,
      })
      .select("*")
      .maybeSingle();
    if (insertResult.error) {
      await finalizeIdempotency({
        supabase: auth.supabase,
        tenantId,
        operationKey,
        status: "failed",
        errorCode: "SUBSCRIPTION_INSERT_FAILED",
      });
      return apiError(500, "INTERNAL_ERROR", insertResult.error.message);
    }
    subscription = (insertResult.data as TenantSubscriptionRow | null) ?? null;
  }

  if (!subscription) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "SUBSCRIPTION_SAVE_FAILED",
    });
    return apiError(500, "INTERNAL_ERROR", "Subscription save failed");
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: auth.context.userId,
    action,
    target_type: "tenant_subscription",
    target_id: subscription.id,
    reason: null,
    payload: {
      planCode: subscription.plan_code,
      status: subscription.status,
      startsAt: subscription.starts_at,
      endsAt: subscription.ends_at,
      graceEndsAt: subscription.grace_ends_at,
      notes: subscription.notes,
    },
  });

  const successPayload = {
    subscription: {
      id: subscription.id,
      tenantId: subscription.tenant_id,
      planId: subscription.plan_id,
      planCode: subscription.plan_code,
      status: subscription.status,
      startsAt: subscription.starts_at,
      endsAt: subscription.ends_at,
      graceEndsAt: subscription.grace_ends_at,
      suspendedAt: subscription.suspended_at,
      canceledAt: subscription.canceled_at,
      notes: subscription.notes,
      updatedAt: subscription.updated_at,
      createdAt: subscription.created_at,
    },
  };
  await finalizeIdempotency({
    supabase: auth.supabase,
    tenantId,
    operationKey,
    status: "succeeded",
    response: successPayload as Record<string, unknown>,
  });

  return apiSuccess(successPayload);
}
