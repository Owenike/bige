import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "./supabase/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import { evaluateTenantAccess, type TenantStatus, type TenantSubscriptionSnapshot } from "./tenant-subscription";

export type AppRole =
  | "platform_admin"
  | "manager"
  | "supervisor"
  | "branch_manager"
  | "store_owner"
  | "store_manager"
  | "frontdesk"
  | "coach"
  | "therapist"
  | "sales"
  | "member"
  | "customer";

type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INACTIVE_ACCOUNT"
  | "TENANT_SUSPENDED"
  | "TENANT_DISABLED"
  | "SUBSCRIPTION_EXPIRED"
  | "SUBSCRIPTION_CANCELED"
  | "SUBSCRIPTION_NOT_FOUND"
  | "INVALID_SUBSCRIPTION_STATE"
  | "STAFF_CREATE_DENIED"
  | "STAFF_UPDATE_DENIED"
  | "STAFF_DISABLE_DENIED"
  | "ROLE_ASSIGNMENT_DENIED"
  | "INVALID_ROLE"
  | "EMAIL_ALREADY_EXISTS"
  | "BRANCH_SCOPE_DENIED"
  | "INVALID_PLAN_TYPE"
  | "PLAN_INACTIVE"
  | "ENTITLEMENT_NOT_FOUND"
  | "ENTITLEMENT_EXPIRED"
  | "ENTITLEMENT_EXHAUSTED"
  | "ELIGIBILITY_DENIED"
  | "NO_MATCHING_ENTITLEMENT"
  | "PASS_ADJUSTMENT_DENIED"
  | "CONTRACT_STATE_INVALID"
  | "INTERNAL_ERROR";

const ROLE_MANAGER_EQUIVALENTS = new Set<AppRole>(["manager", "supervisor", "branch_manager", "store_owner", "store_manager"]);
const ROLE_FRONTDESK_EQUIVALENTS = new Set<AppRole>(["frontdesk"]);
const ROLE_PLATFORM_ADMIN_EQUIVALENTS = new Set<AppRole>(["platform_admin"]);
const ROLE_COACH_EQUIVALENTS = new Set<AppRole>(["coach", "therapist"]);
const ROLE_MEMBER_EQUIVALENTS = new Set<AppRole>(["member", "customer"]);

function normalizeRole(input: unknown): AppRole | null {
  if (typeof input !== "string") return null;
  if (
    input === "platform_admin" ||
    input === "manager" ||
    input === "supervisor" ||
    input === "branch_manager" ||
    input === "store_owner" ||
    input === "store_manager" ||
    input === "frontdesk" ||
    input === "coach" ||
    input === "therapist" ||
    input === "sales" ||
    input === "member" ||
    input === "customer"
  ) {
    return input;
  }
  return null;
}

function roleMatchesAllowed(role: AppRole, allowedRoles: AppRole[]) {
  for (const allowed of allowedRoles) {
    if (allowed === role) return true;
    if (allowed === "manager" && ROLE_MANAGER_EQUIVALENTS.has(role)) return true;
    if (allowed === "frontdesk" && ROLE_FRONTDESK_EQUIVALENTS.has(role)) return true;
    if (allowed === "platform_admin" && ROLE_PLATFORM_ADMIN_EQUIVALENTS.has(role)) return true;
    if (allowed === "coach" && ROLE_COACH_EQUIVALENTS.has(role)) return true;
    if (allowed === "member" && ROLE_MEMBER_EQUIVALENTS.has(role)) return true;
  }
  return false;
}

export interface ProfileContext {
  userId: string;
  role: AppRole;
  tenantId: string | null;
  branchId: string | null;
  tenantStatus: TenantStatus;
  subscriptionStatus: TenantSubscriptionSnapshot["status"];
  subscriptionStartsAt: string | null;
  subscriptionEndsAt: string | null;
  subscriptionGraceEndsAt: string | null;
  subscriptionPlanCode: string | null;
  subscriptionPlanName: string | null;
  tenantAccessWarning: "SUBSCRIPTION_GRACE" | "SUBSCRIPTION_EXPIRING_SOON" | null;
  tenantRemainingDays: number | null;
}

export const TEMP_DISABLE_ROLE_GUARD = false;

interface ProfileRow {
  id: string;
  role: string;
  tenant_id: string | null;
  branch_id: string | null;
  is_active: boolean;
}

interface OpenShiftRow {
  id: string;
  opened_at: string;
  opened_by: string | null;
  opening_cash?: number | null;
}

type TenantSubscriptionRow = {
  status: TenantSubscriptionSnapshot["status"];
  starts_at: string | null;
  ends_at: string | null;
  grace_ends_at: string | null;
  plan_code: string | null;
  saas_plans: { name: string | null } | Array<{ name: string | null }> | null;
};

export function jsonError(status: number, error: string) {
  const code: ErrorCode =
    status === 401
      ? "UNAUTHORIZED"
      : status === 403
        ? "FORBIDDEN"
        : status === 500
          ? "INTERNAL_ERROR"
          : "FORBIDDEN";
  return apiError(status, code, error);
}

export function apiError(status: number, code: ErrorCode, message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message },
      code,
      message,
      // Legacy compatibility fields.
      errorMessage: message,
      legacyError: message,
    },
    { status },
  );
}

export function apiSuccess<TData>(data: TData) {
  const spreadable = typeof data === "object" && data !== null ? data : {};
  return NextResponse.json({
    ok: true,
    data,
    ...(spreadable as object),
  });
}

function readBearerToken(request?: Request) {
  if (!request) return null;
  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] || null;
}

async function recordSecurityAudit(params: {
  supabase: any;
  tenantId: string | null;
  actorId: string | null;
  action:
    | "role_denied"
    | "inactive_account_denied"
    | "branch_scope_denied"
    | "tenant_access_denied"
    | "cross_tenant_denied";
  reason: string;
  payload?: Record<string, unknown>;
}) {
  if (!params.tenantId || !params.actorId) return;
  await params.supabase
    .from("audit_logs")
    .insert({
      tenant_id: params.tenantId,
      actor_id: params.actorId,
      action: params.action,
      target_type: "auth_guard",
      target_id: params.actorId,
      reason: params.reason,
      payload: params.payload || {},
    })
    .then(() => null)
    .catch(() => null);
}

export async function requireProfile(allowedRoles?: AppRole[], request?: Request) {
  let supabase;
  try {
    supabase = await createSupabaseServerClient(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supabase client initialization failed";
    return { ok: false as const, response: jsonError(500, message) };
  }

  const bearerToken = readBearerToken(request);
  const authResult = bearerToken
    ? await createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        { auth: { persistSession: false, autoRefreshToken: false } },
      ).auth.getUser(bearerToken)
    : await supabase.auth.getUser();
  const user = authResult.data.user;

  if (authResult.error || !user) {
    return { ok: false as const, response: jsonError(401, "Unauthorized") };
  }

  const profileResult = await supabase
    .from("profiles")
    .select("id, role, tenant_id, branch_id, is_active")
    .eq("id", user.id)
    .maybeSingle();

  const profile = (profileResult.data as ProfileRow | null) ?? null;

  if (profileResult.error) {
    return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", profileResult.error.message) };
  }

  if (!profile) {
    return { ok: false as const, response: apiError(403, "FORBIDDEN", "Profile not found") };
  }

  const role = normalizeRole(profile.role);
  if (!role) {
    return { ok: false as const, response: apiError(403, "FORBIDDEN", "Invalid profile role") };
  }

  if (!profile.is_active && !TEMP_DISABLE_ROLE_GUARD) {
    await recordSecurityAudit({
      supabase,
      tenantId: profile.tenant_id,
      actorId: profile.id,
      action: "inactive_account_denied",
      reason: "profile_inactive",
    });
    return { ok: false as const, response: apiError(403, "INACTIVE_ACCOUNT", "Account is inactive") };
  }

  if (!TEMP_DISABLE_ROLE_GUARD && allowedRoles && !roleMatchesAllowed(role, allowedRoles)) {
    await recordSecurityAudit({
      supabase,
      tenantId: profile.tenant_id,
      actorId: profile.id,
      action: "role_denied",
      reason: "role_not_allowed",
      payload: {
        role,
        allowedRoles,
      },
    });
    return { ok: false as const, response: apiError(403, "FORBIDDEN", "Forbidden") };
  }

  if (!TEMP_DISABLE_ROLE_GUARD && role !== "platform_admin" && !profile.tenant_id) {
    await recordSecurityAudit({
      supabase,
      tenantId: profile.tenant_id,
      actorId: profile.id,
      action: "cross_tenant_denied",
      reason: "missing_tenant_context",
    });
    return { ok: false as const, response: apiError(403, "FORBIDDEN", "Missing tenant context") };
  }

  if (!TEMP_DISABLE_ROLE_GUARD && role === "frontdesk" && !profile.branch_id) {
    await recordSecurityAudit({
      supabase,
      tenantId: profile.tenant_id,
      actorId: profile.id,
      action: "branch_scope_denied",
      reason: "missing_branch_context",
    });
    return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "Missing branch context for frontdesk role") };
  }

  let tenantStatus: TenantStatus = null;
  let subscriptionSnapshot: TenantSubscriptionSnapshot | null = null;
  let tenantAccessWarning: ProfileContext["tenantAccessWarning"] = null;
  let tenantRemainingDays: number | null = null;
  if (!TEMP_DISABLE_ROLE_GUARD && role !== "platform_admin" && profile.tenant_id) {
    let admin;
    try {
      admin = createSupabaseAdminClient();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Admin client initialization failed";
      return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", message) };
    }

    const [tenantResult, subscriptionResult] = await Promise.all([
      admin.from("tenants").select("status").eq("id", profile.tenant_id).maybeSingle(),
      admin
        .from("tenant_subscriptions")
        .select("status, starts_at, ends_at, grace_ends_at, plan_code, saas_plans(name)")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_current", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (tenantResult.error) {
      return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", tenantResult.error.message) };
    }
    if (subscriptionResult.error) {
      return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", subscriptionResult.error.message) };
    }

    tenantStatus = (tenantResult.data?.status as TenantStatus) ?? null;
    const subscription = (subscriptionResult.data as TenantSubscriptionRow | null) ?? null;
    const planInfo = Array.isArray(subscription?.saas_plans) ? subscription?.saas_plans[0] : subscription?.saas_plans;
    subscriptionSnapshot = subscription
      ? {
          status: subscription.status ?? null,
          startsAt: subscription.starts_at ?? null,
          endsAt: subscription.ends_at ?? null,
          graceEndsAt: subscription.grace_ends_at ?? null,
          planCode: subscription.plan_code ?? null,
          planName: planInfo?.name ?? null,
        }
      : null;

    const access = evaluateTenantAccess({
      tenantStatus,
      subscription: subscriptionSnapshot,
    });
    if (!access.allowed && access.blockedCode) {
      await recordSecurityAudit({
        supabase,
        tenantId: profile.tenant_id,
        actorId: profile.id,
        action: "tenant_access_denied",
        reason: access.blockedCode,
        payload: {
          subscriptionStatus: subscriptionSnapshot?.status ?? null,
          tenantStatus,
        },
      });
      return {
        ok: false as const,
        response: apiError(403, access.blockedCode, access.message),
      };
    }
    tenantAccessWarning = access.warningCode;
    tenantRemainingDays = access.remainingDays;
  }

  const context: ProfileContext = {
    userId: profile.id,
    role,
    tenantId: profile.tenant_id,
    branchId: profile.branch_id,
    tenantStatus,
    subscriptionStatus: subscriptionSnapshot?.status ?? null,
    subscriptionStartsAt: subscriptionSnapshot?.startsAt ?? null,
    subscriptionEndsAt: subscriptionSnapshot?.endsAt ?? null,
    subscriptionGraceEndsAt: subscriptionSnapshot?.graceEndsAt ?? null,
    subscriptionPlanCode: subscriptionSnapshot?.planCode ?? null,
    subscriptionPlanName: subscriptionSnapshot?.planName ?? null,
    tenantAccessWarning,
    tenantRemainingDays,
  };

  return { ok: true as const, context, supabase };
}

export async function requireOpenShift(params: {
  supabase: any;
  context: ProfileContext;
  enforceRoles?: AppRole[];
}) {
  const roles = params.enforceRoles ?? ["frontdesk"];
  if (!roles.includes(params.context.role)) {
    return { ok: true as const, shift: null };
  }

  if (!params.context.tenantId) {
    return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant context") };
  }
  if (!params.context.branchId) {
    return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "Missing branch context") };
  }

  const openShiftResult = await params.supabase
    .from("frontdesk_shifts")
    .select("id, opened_at, opened_by, opening_cash")
    .eq("tenant_id", params.context.tenantId)
    .eq("branch_id", params.context.branchId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openShiftResult.error) {
    return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", openShiftResult.error.message) };
  }
  if (!openShiftResult.data) {
    return { ok: false as const, response: apiError(409, "FORBIDDEN", "Shift is not open") };
  }

  return { ok: true as const, shift: openShiftResult.data as OpenShiftRow };
}
