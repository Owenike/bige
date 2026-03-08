import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { claimIdempotency, finalizeIdempotency } from "../../../../../lib/idempotency";
import { evaluateTenantAccess, type TenantStatus, type TenantSubscriptionSnapshot } from "../../../../../lib/tenant-subscription";

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

type PlanRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toPositiveDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function toSnapshot(row: TenantSubscriptionRow, planName: string | null): TenantSubscriptionSnapshot {
  return {
    status: row.status ?? null,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    graceEndsAt: row.grace_ends_at ?? null,
    planCode: row.plan_code ?? null,
    planName,
  };
}

async function loadSubscriptionContext(auth: Awaited<ReturnType<typeof requireProfile>>, tenantId: string) {
  if (!auth.ok) return null;
  const [tenantResult, currentResult] = await Promise.all([
    auth.supabase.from("tenants").select("id, name, status").eq("id", tenantId).maybeSingle(),
    auth.supabase.from("tenant_subscriptions").select("*").eq("tenant_id", tenantId).eq("is_current", true).maybeSingle(),
  ]);
  if (tenantResult.error) return { error: tenantResult.error.message };
  if (!tenantResult.data) return { notFound: true };
  if (currentResult.error) return { error: currentResult.error.message };
  const subscription = (currentResult.data as TenantSubscriptionRow | null) ?? null;

  let plan: PlanRow | null = null;
  if (subscription?.plan_id) {
    const planResult = await auth.supabase
      .from("saas_plans")
      .select("id, code, name, is_active")
      .eq("id", subscription.plan_id)
      .maybeSingle();
    if (planResult.error) return { error: planResult.error.message };
    plan = (planResult.data as PlanRow | null) ?? null;
  }

  return {
    tenant: tenantResult.data as { id: string; name: string; status: TenantStatus },
    subscription,
    plan,
  };
}

export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const { tenantId } = await context.params;
  if (!tenantId) return apiError(400, "FORBIDDEN", "tenantId is required");

  const loaded = await loadSubscriptionContext(auth, tenantId);
  if (!loaded) return apiError(500, "INTERNAL_ERROR", "Unable to load subscription");
  if ("error" in loaded) return apiError(500, "INTERNAL_ERROR", loaded.error);
  if ("notFound" in loaded) return apiError(404, "FORBIDDEN", "Tenant not found");

  const snapshot = loaded.subscription ? toSnapshot(loaded.subscription, loaded.plan?.name ?? null) : null;
  const access = evaluateTenantAccess({
    tenantStatus: loaded.tenant.status,
    subscription: snapshot,
  });

  return apiSuccess({
    tenant: loaded.tenant,
    subscription: loaded.subscription
      ? {
          id: loaded.subscription.id,
          tenantId: loaded.subscription.tenant_id,
          planId: loaded.subscription.plan_id,
          planCode: loaded.subscription.plan_code,
          planName: loaded.plan?.name ?? null,
          status: loaded.subscription.status,
          startsAt: loaded.subscription.starts_at,
          endsAt: loaded.subscription.ends_at,
          graceEndsAt: loaded.subscription.grace_ends_at,
          suspendedAt: loaded.subscription.suspended_at,
          canceledAt: loaded.subscription.canceled_at,
          notes: loaded.subscription.notes,
          updatedAt: loaded.subscription.updated_at,
          createdAt: loaded.subscription.created_at,
        }
      : null,
    access: {
      allowed: access.allowed,
      blockedCode: access.blockedCode,
      warningCode: access.warningCode,
      remainingDays: access.remainingDays,
      effectiveStatus: access.effectiveStatus,
    },
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const { tenantId } = await context.params;
  if (!tenantId) return apiError(400, "FORBIDDEN", "tenantId is required");

  const loaded = await loadSubscriptionContext(auth, tenantId);
  if (!loaded) return apiError(500, "INTERNAL_ERROR", "Unable to load subscription");
  if ("error" in loaded) return apiError(500, "INTERNAL_ERROR", loaded.error);
  if ("notFound" in loaded) return apiError(404, "FORBIDDEN", "Tenant not found");
  if (!loaded.subscription) return apiError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim() : "update";
  const idempotencyKeyInput = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const now = new Date();
  const nowIso = now.toISOString();

  const updates: Record<string, unknown> = {
    updated_at: nowIso,
    updated_by: auth.context.userId,
  };
  let auditAction = "tenant_subscription_updated";

  if (action === "renew") {
    const extendDays = toPositiveDays(body?.extendDays) || 30;
    const currentEnd = loaded.subscription.ends_at ? new Date(loaded.subscription.ends_at) : now;
    const effectiveBase = currentEnd.getTime() > now.getTime() ? currentEnd : now;
    updates.ends_at = addDays(effectiveBase, extendDays).toISOString();
    updates.status = "active";
    updates.suspended_at = null;
    updates.canceled_at = null;
    auditAction = "tenant_subscription_renewed";
  } else if (action === "enter_grace") {
    const requestedGraceEndsAt = toIsoOrNull(body?.graceEndsAt) ?? addDays(now, 7).toISOString();
    const existingEndsAt = loaded.subscription.ends_at;
    const currentEndsAtMs = existingEndsAt ? new Date(existingEndsAt).getTime() : null;
    const requestedGraceMs = new Date(requestedGraceEndsAt).getTime();
    const graceAnchor =
      currentEndsAtMs !== null && existingEndsAt && currentEndsAtMs <= requestedGraceMs
        ? existingEndsAt
        : nowIso;
    const normalizedGraceEndsAt =
      new Date(graceAnchor).getTime() > requestedGraceMs ? graceAnchor : requestedGraceEndsAt;
    updates.status = "grace";
    updates.ends_at = graceAnchor;
    updates.grace_ends_at = normalizedGraceEndsAt;
    auditAction = "tenant_subscription_grace_updated";
  } else if (action === "suspend") {
    updates.status = "suspended";
    updates.suspended_at = nowIso;
    auditAction = "tenant_subscription_suspended";
  } else if (action === "restore") {
    const endsAt = toIsoOrNull(body?.endsAt);
    const currentEndsAtMs = loaded.subscription.ends_at ? new Date(loaded.subscription.ends_at).getTime() : null;
    if (!endsAt && currentEndsAtMs !== null && currentEndsAtMs < now.getTime()) {
      return apiError(400, "INVALID_SUBSCRIPTION_STATE", "endsAt is required to restore expired subscription");
    }
    updates.status = "active";
    updates.suspended_at = null;
    updates.grace_ends_at = null;
    if (endsAt) updates.ends_at = endsAt;
    auditAction = "tenant_subscription_restored";
  } else {
    const nextStatus = typeof body?.status === "string" ? body.status.trim() : null;
    if (nextStatus) {
      if (!["trial", "active", "grace", "suspended", "expired", "canceled"].includes(nextStatus)) {
        return apiError(400, "INVALID_SUBSCRIPTION_STATE", "Invalid subscription status");
      }
      updates.status = nextStatus;
      if (nextStatus === "suspended") updates.suspended_at = nowIso;
      if (nextStatus === "canceled") updates.canceled_at = nowIso;
    }
    const planCode = typeof body?.planCode === "string" ? body.planCode.trim().toLowerCase() : "";
    if (planCode) {
      const planResult = await auth.supabase.from("saas_plans").select("id, code, is_active").eq("code", planCode).maybeSingle();
      if (planResult.error) return apiError(500, "INTERNAL_ERROR", planResult.error.message);
      if (!planResult.data || !planResult.data.is_active) {
        return apiError(400, "INVALID_SUBSCRIPTION_STATE", "Plan not found or inactive");
      }
      updates.plan_id = planResult.data.id;
      updates.plan_code = planResult.data.code;
    }
    const startsAt = toIsoOrNull(body?.startsAt);
    const endsAt = toIsoOrNull(body?.endsAt);
    const graceEndsAt = toIsoOrNull(body?.graceEndsAt);
    if (startsAt) updates.starts_at = startsAt;
    if (endsAt) updates.ends_at = endsAt;
    if (graceEndsAt || body?.graceEndsAt === null || body?.graceEndsAt === "") {
      updates.grace_ends_at = graceEndsAt;
    }
    if (typeof body?.notes === "string") {
      updates.notes = body.notes.trim() || null;
    }
  }

  const operationKey =
    idempotencyKeyInput ||
    ["tenant_subscription_patch", tenantId, loaded.subscription.id, action, JSON.stringify(updates)].join(":");
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
    return apiError(409, "FORBIDDEN", "Duplicate subscription patch request in progress");
  }

  const updateResult = await auth.supabase
    .from("tenant_subscriptions")
    .update(updates)
    .eq("id", loaded.subscription.id)
    .select("*")
    .maybeSingle();
  if (updateResult.error) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "SUBSCRIPTION_PATCH_FAILED",
    });
    return apiError(500, "INTERNAL_ERROR", updateResult.error.message);
  }

  const subscription = (updateResult.data as TenantSubscriptionRow | null) ?? null;
  if (!subscription) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "SUBSCRIPTION_PATCH_EMPTY",
    });
    return apiError(500, "INTERNAL_ERROR", "Subscription update failed");
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: auth.context.userId,
    action: auditAction,
    target_type: "tenant_subscription",
    target_id: subscription.id,
    reason: typeof body?.reason === "string" ? body.reason : null,
    payload: {
      action,
      updates,
    },
  });

  const planResult = subscription.plan_id
    ? await auth.supabase.from("saas_plans").select("name").eq("id", subscription.plan_id).maybeSingle()
    : { data: null, error: null };
  if (planResult.error) return apiError(500, "INTERNAL_ERROR", planResult.error.message);
  const planName = (planResult.data as { name: string | null } | null)?.name ?? null;

  const access = evaluateTenantAccess({
    tenantStatus: loaded.tenant.status,
    subscription: toSnapshot(subscription, planName),
  });

  const successPayload = {
    subscription: {
      id: subscription.id,
      tenantId: subscription.tenant_id,
      planId: subscription.plan_id,
      planCode: subscription.plan_code,
      planName,
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
    access: {
      allowed: access.allowed,
      blockedCode: access.blockedCode,
      warningCode: access.warningCode,
      remainingDays: access.remainingDays,
      effectiveStatus: access.effectiveStatus,
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
