import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import {
  BookingCommercialError,
  listManagerMemberPackages,
  listManagerPackageTemplates,
} from "../../../../lib/booking-commerce";
import { requirePermission } from "../../../../lib/permissions";

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function resolveScopedAuth(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth;
  if (!auth.context.tenantId) {
    return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant context") };
  }
  return { ok: true as const, auth };
}

function normalizeServiceScope(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);
}

export async function GET(request: Request) {
  const scoped = await resolveScopedAuth(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "plans.read");
  if (!permission.ok) return permission.response;

  try {
    const [templates, memberPackages] = await Promise.all([
      listManagerPackageTemplates({
        supabase: scoped.auth.supabase,
        tenantId: scoped.auth.context.tenantId!,
        branchId: scoped.auth.context.branchId,
      }),
      listManagerMemberPackages({
        supabase: scoped.auth.supabase,
        tenantId: scoped.auth.context.tenantId!,
        branchId: scoped.auth.context.branchId,
      }),
    ]);

    return apiSuccess({
      templates,
      memberPackages,
    });
  } catch (error) {
    if (error instanceof BookingCommercialError) {
      return apiError(error.status, error.code as "FORBIDDEN", error.message);
    }
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Load packages failed");
  }
}

export async function POST(request: Request) {
  const scoped = await resolveScopedAuth(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "plans.write");
  if (!permission.ok) return permission.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const code = normalizeText(body?.code)?.toLowerCase() ?? "";
  const name = normalizeText(body?.name) ?? "";
  const description = normalizeText(body?.description);
  const planType = body?.planType === "coach_pack" ? "coach_pack" : "entry_pass";
  const branchId = normalizeText(body?.branchId);
  const totalSessions = Number(body?.totalSessions ?? 0);
  const validDays =
    body?.validDays === null || body?.validDays === undefined || body?.validDays === ""
      ? null
      : Number(body?.validDays);
  const priceAmount = Number(body?.priceAmount ?? 0);
  const isActive = body?.isActive === false ? false : true;
  const serviceScope = normalizeServiceScope(body?.serviceScope);

  if (!code || !/^[a-z0-9_]+$/i.test(code)) {
    return apiError(400, "FORBIDDEN", "code is required and must be alphanumeric with underscore");
  }
  if (!name) return apiError(400, "FORBIDDEN", "name is required");
  if (!Number.isFinite(totalSessions) || totalSessions <= 0) {
    return apiError(400, "FORBIDDEN", "totalSessions must be a positive number");
  }
  if (validDays !== null && (!Number.isFinite(validDays) || validDays <= 0)) {
    return apiError(400, "FORBIDDEN", "validDays must be a positive number");
  }
  if (!Number.isFinite(priceAmount) || priceAmount < 0) {
    return apiError(400, "FORBIDDEN", "priceAmount must be zero or positive");
  }
  if (scoped.auth.context.branchId && branchId && scoped.auth.context.branchId !== branchId) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Branch manager cannot write another branch package");
  }

  const result = await scoped.auth.supabase
    .from("member_plan_catalog")
    .upsert(
      {
        tenant_id: scoped.auth.context.tenantId,
        branch_id: branchId || scoped.auth.context.branchId || null,
        code,
        name,
        description,
        plan_type: planType,
        fulfillment_kind: "entry_pass",
        default_duration_days: validDays,
        default_quantity: totalSessions,
        price_amount: priceAmount,
        service_scope: serviceScope,
        is_active: isActive,
        updated_by: scoped.auth.context.userId,
        created_by: scoped.auth.context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,code" },
    )
    .select("id")
    .maybeSingle();

  if (result.error || !result.data) {
    return apiError(500, "INTERNAL_ERROR", result.error?.message || "Save package template failed");
  }

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.auth.context.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "package_template_upsert",
    target_type: "member_plan_catalog",
    target_id: String(result.data.id),
    payload: {
      code,
      name,
      planType,
      branchId: branchId || scoped.auth.context.branchId || null,
      totalSessions,
      validDays,
      priceAmount,
      serviceScope,
      isActive,
    },
  });

  return apiSuccess({ id: result.data.id });
}

export async function PATCH(request: Request) {
  const scoped = await resolveScopedAuth(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "plans.write");
  if (!permission.ok) return permission.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = normalizeText(body?.id);
  if (!id) return apiError(400, "FORBIDDEN", "id is required");

  const currentResult = await scoped.auth.supabase
    .from("member_plan_catalog")
    .select("id, branch_id")
    .eq("tenant_id", scoped.auth.context.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (currentResult.error) return apiError(500, "INTERNAL_ERROR", currentResult.error.message);
  if (!currentResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Package template not found");
  if (scoped.auth.context.branchId && currentResult.data.branch_id && scoped.auth.context.branchId !== currentResult.data.branch_id) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Branch manager cannot update another branch package");
  }

  const updates: Record<string, unknown> = {
    updated_by: scoped.auth.context.userId,
    updated_at: new Date().toISOString(),
  };
  if ("name" in (body || {})) updates.name = normalizeText(body?.name);
  if ("description" in (body || {})) updates.description = normalizeText(body?.description);
  if ("totalSessions" in (body || {})) {
    const value = Number(body?.totalSessions);
    if (!Number.isFinite(value) || value <= 0) return apiError(400, "FORBIDDEN", "totalSessions must be positive");
    updates.default_quantity = value;
  }
  if ("validDays" in (body || {})) {
    if (body?.validDays === null || body?.validDays === "") {
      updates.default_duration_days = null;
    } else {
      const value = Number(body?.validDays);
      if (!Number.isFinite(value) || value <= 0) return apiError(400, "FORBIDDEN", "validDays must be positive");
      updates.default_duration_days = value;
    }
  }
  if ("priceAmount" in (body || {})) {
    const value = Number(body?.priceAmount);
    if (!Number.isFinite(value) || value < 0) return apiError(400, "FORBIDDEN", "priceAmount must be zero or positive");
    updates.price_amount = value;
  }
  if ("serviceScope" in (body || {})) updates.service_scope = normalizeServiceScope(body?.serviceScope);
  if ("isActive" in (body || {})) updates.is_active = body?.isActive === true;

  const updateResult = await scoped.auth.supabase
    .from("member_plan_catalog")
    .update(updates)
    .eq("tenant_id", scoped.auth.context.tenantId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (updateResult.error || !updateResult.data) {
    return apiError(500, "INTERNAL_ERROR", updateResult.error?.message || "Update package template failed");
  }

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.auth.context.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "package_template_update",
    target_type: "member_plan_catalog",
    target_id: String(updateResult.data.id),
    payload: updates,
  });

  return apiSuccess({ id: updateResult.data.id });
}
