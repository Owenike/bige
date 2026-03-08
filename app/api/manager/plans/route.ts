import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { requirePermission } from "../../../../lib/permissions";
import {
  normalizeFulfillmentKind,
  normalizePlanType,
  type MemberPlanType,
  type PlanFulfillmentKind,
} from "../../../../lib/member-plan-lifecycle";

type PlanRow = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  plan_type: MemberPlanType;
  fulfillment_kind: PlanFulfillmentKind;
  default_duration_days: number | null;
  default_quantity: number | null;
  allow_auto_renew: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toPlanItem(row: PlanRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    planType: row.plan_type,
    fulfillmentKind: row.fulfillment_kind,
    defaultDurationDays: row.default_duration_days,
    defaultQuantity: row.default_quantity,
    allowAutoRenew: row.allow_auto_renew,
    isActive: row.is_active,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveTenantScope(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth;

  const url = new URL(request.url);
  const requestedTenantId = url.searchParams.get("tenantId");
  const tenantId = auth.context.role === "platform_admin" ? requestedTenantId : auth.context.tenantId;
  if (!tenantId) return { ok: false as const, response: apiError(400, "FORBIDDEN", "tenantId is required") };
  return { ok: true as const, auth, tenantId };
}

export async function GET(request: Request) {
  const scoped = await resolveTenantScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "plans.read");
  if (!permission.ok) return permission.response;

  const result = await scoped.auth.supabase
    .from("member_plan_catalog")
    .select(
      "id, tenant_id, code, name, description, plan_type, fulfillment_kind, default_duration_days, default_quantity, allow_auto_renew, is_active, metadata, created_at, updated_at",
    )
    .eq("tenant_id", scoped.tenantId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);

  const contractsResult = await scoped.auth.supabase
    .from("member_plan_contracts")
    .select("status, ends_at")
    .eq("tenant_id", scoped.tenantId)
    .limit(5000);
  if (contractsResult.error) return apiError(500, "INTERNAL_ERROR", contractsResult.error.message);

  const now = Date.now();
  let expiringSoon = 0;
  let expired = 0;
  let exhausted = 0;
  for (const row of (contractsResult.data || []) as Array<{ status: string | null; ends_at: string | null }>) {
    if (row.status === "exhausted") exhausted += 1;
    if (row.status === "expired") expired += 1;
    if (row.ends_at) {
      const ends = new Date(row.ends_at).getTime();
      if (!Number.isNaN(ends)) {
        const days = Math.ceil((ends - now) / (24 * 60 * 60 * 1000));
        if (days >= 0 && days <= 14) expiringSoon += 1;
        if (days < 0) expired += 1;
      }
    }
  }

  return apiSuccess({
    items: ((result.data || []) as PlanRow[]).map(toPlanItem),
    summary: {
      totalPlans: (result.data || []).length,
      activePlans: ((result.data || []) as PlanRow[]).filter((row) => row.is_active).length,
      inactivePlans: ((result.data || []) as PlanRow[]).filter((row) => !row.is_active).length,
      expiringSoon,
      expired,
      exhausted,
    },
  });
}

export async function POST(request: Request) {
  const scoped = await resolveTenantScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "plans.write");
  if (!permission.ok) return permission.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const code = normalizeText(body?.code)?.toLowerCase() ?? "";
  const name = normalizeText(body?.name) ?? "";
  const description = normalizeText(body?.description);
  const planType = normalizePlanType(body?.planType);
  const fulfillmentKind = normalizeFulfillmentKind(body?.fulfillmentKind ?? "none");
  const defaultDurationDays = body?.defaultDurationDays === null ? null : Number(body?.defaultDurationDays ?? null);
  const defaultQuantity = body?.defaultQuantity === null ? null : Number(body?.defaultQuantity ?? null);
  const allowAutoRenew = body?.allowAutoRenew === true;
  const isActive = body?.isActive === false ? false : true;

  if (!code || !/^[a-z0-9_]+$/i.test(code)) {
    return apiError(400, "FORBIDDEN", "code is required and must be alphanumeric with underscore");
  }
  if (!name) return apiError(400, "FORBIDDEN", "name is required");
  if (!planType) return apiError(400, "INVALID_PLAN_TYPE", "planType is invalid");
  if (!fulfillmentKind) return apiError(400, "INVALID_PLAN_TYPE", "fulfillmentKind is invalid");
  if (defaultDurationDays !== null && (!Number.isFinite(defaultDurationDays) || defaultDurationDays <= 0)) {
    return apiError(400, "FORBIDDEN", "defaultDurationDays must be a positive number");
  }
  if (defaultQuantity !== null && (!Number.isFinite(defaultQuantity) || defaultQuantity < 0)) {
    return apiError(400, "FORBIDDEN", "defaultQuantity must be zero or positive");
  }

  const upsertResult = await scoped.auth.supabase
    .from("member_plan_catalog")
    .upsert(
      {
        tenant_id: scoped.tenantId,
        code,
        name,
        description,
        plan_type: planType,
        fulfillment_kind: fulfillmentKind,
        default_duration_days: defaultDurationDays,
        default_quantity: defaultQuantity,
        allow_auto_renew: allowAutoRenew,
        is_active: isActive,
        updated_by: scoped.auth.context.userId,
        created_by: scoped.auth.context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,code" },
    )
    .select(
      "id, tenant_id, code, name, description, plan_type, fulfillment_kind, default_duration_days, default_quantity, allow_auto_renew, is_active, metadata, created_at, updated_at",
    )
    .maybeSingle();

  if (upsertResult.error || !upsertResult.data) {
    return apiError(500, "INTERNAL_ERROR", upsertResult.error?.message || "Create plan failed");
  }

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "member_plan_catalog_upsert",
    target_type: "member_plan_catalog",
    target_id: String(upsertResult.data.id),
    reason: null,
    payload: {
      code,
      planType,
      fulfillmentKind,
      defaultDurationDays,
      defaultQuantity,
      allowAutoRenew,
      isActive,
    },
  });

  return apiSuccess({
    item: toPlanItem(upsertResult.data as PlanRow),
  });
}

export async function PATCH(request: Request) {
  const scoped = await resolveTenantScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "plans.write");
  if (!permission.ok) return permission.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = normalizeText(body?.id);
  const code = normalizeText(body?.code)?.toLowerCase() ?? null;
  if (!id && !code) return apiError(400, "FORBIDDEN", "id or code is required");

  let query = scoped.auth.supabase
    .from("member_plan_catalog")
    .select(
      "id, tenant_id, code, name, description, plan_type, fulfillment_kind, default_duration_days, default_quantity, allow_auto_renew, is_active, metadata, created_at, updated_at",
    )
    .eq("tenant_id", scoped.tenantId)
    .limit(1);
  query = id ? query.eq("id", id) : query.eq("code", code as string);
  const existing = await query.maybeSingle();
  if (existing.error) return apiError(500, "INTERNAL_ERROR", existing.error.message);
  if (!existing.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Plan not found");

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: scoped.auth.context.userId,
  };
  if ("name" in (body || {})) {
    const value = normalizeText(body?.name);
    if (!value) return apiError(400, "FORBIDDEN", "name cannot be empty");
    updates.name = value;
  }
  if ("description" in (body || {})) updates.description = normalizeText(body?.description);
  if ("planType" in (body || {})) {
    const value = normalizePlanType(body?.planType);
    if (!value) return apiError(400, "INVALID_PLAN_TYPE", "planType is invalid");
    updates.plan_type = value;
  }
  if ("fulfillmentKind" in (body || {})) {
    const value = normalizeFulfillmentKind(body?.fulfillmentKind);
    if (!value) return apiError(400, "INVALID_PLAN_TYPE", "fulfillmentKind is invalid");
    updates.fulfillment_kind = value;
  }
  if ("defaultDurationDays" in (body || {})) {
    if (body?.defaultDurationDays === null) {
      updates.default_duration_days = null;
    } else {
      const value = Number(body?.defaultDurationDays);
      if (!Number.isFinite(value) || value <= 0) return apiError(400, "FORBIDDEN", "defaultDurationDays must be positive");
      updates.default_duration_days = value;
    }
  }
  if ("defaultQuantity" in (body || {})) {
    if (body?.defaultQuantity === null) {
      updates.default_quantity = null;
    } else {
      const value = Number(body?.defaultQuantity);
      if (!Number.isFinite(value) || value < 0) return apiError(400, "FORBIDDEN", "defaultQuantity must be zero or positive");
      updates.default_quantity = value;
    }
  }
  if ("allowAutoRenew" in (body || {})) updates.allow_auto_renew = body?.allowAutoRenew === true;
  if ("isActive" in (body || {})) updates.is_active = body?.isActive === true;

  const updateResult = await scoped.auth.supabase
    .from("member_plan_catalog")
    .update(updates)
    .eq("tenant_id", scoped.tenantId)
    .eq("id", existing.data.id)
    .select(
      "id, tenant_id, code, name, description, plan_type, fulfillment_kind, default_duration_days, default_quantity, allow_auto_renew, is_active, metadata, created_at, updated_at",
    )
    .maybeSingle();
  if (updateResult.error || !updateResult.data) {
    return apiError(500, "INTERNAL_ERROR", updateResult.error?.message || "Update plan failed");
  }

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "member_plan_catalog_update",
    target_type: "member_plan_catalog",
    target_id: String(updateResult.data.id),
    reason: null,
    payload: updates,
  });

  return apiSuccess({
    item: toPlanItem(updateResult.data as PlanRow),
  });
}

