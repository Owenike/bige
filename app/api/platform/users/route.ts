import { NextResponse } from "next/server";
import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const ROLES = ["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk", "coach", "sales", "member"] as const;
type AppRole = (typeof ROLES)[number];

function ok<TData extends Record<string, unknown>>(data: TData) {
  return apiSuccess(data);
}

function fail(status: number, code: "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_ERROR", message: string) {
  return apiError(status, code, message);
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const searchParams = new URL(request.url).searchParams;
  const tenantId = searchParams.get("tenantId");
  const role = (searchParams.get("role") || "").trim();
  const activeOnly = searchParams.get("activeOnly");
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") || 200)));

  let query = auth.supabase
    .from("profiles")
    .select("id, tenant_id, branch_id, role, display_name, is_active, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (tenantId) query = query.eq("tenant_id", tenantId);
  if (ROLES.includes(role as AppRole)) query = query.eq("role", role as AppRole);
  if (activeOnly === "1") query = query.eq("is_active", true);
  if (q) query = query.or(`display_name.ilike.%${q}%,id.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return fail(500, "INTERNAL_ERROR", error.message);
  return ok({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = (typeof body?.role === "string" ? body.role : "") as AppRole;
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId : null;
  const branchId = typeof body?.branchId === "string" ? body.branchId : null;
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : null;
  const isActive = body?.isActive === false ? false : true;

  const createMember = body?.createMember === true;
  const memberFullName = typeof body?.memberFullName === "string" ? body.memberFullName.trim() : "";
  const memberPhone = typeof body?.memberPhone === "string" ? body.memberPhone.trim() : null;

  if (!email || !password || !ROLES.includes(role)) {
    return fail(400, "FORBIDDEN", "email, password, role are required");
  }

  // Tenant context is required for all non-platform roles.
  if (role !== "platform_admin" && !tenantId) {
    return fail(400, "FORBIDDEN", "tenantId is required for non-platform users");
  }

  if (role === "member" && createMember && !memberFullName) {
    return fail(400, "FORBIDDEN", "memberFullName is required when createMember=true");
  }

  const admin = createSupabaseAdminClient();

  const userResult = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userResult.error || !userResult.data.user) {
    return fail(500, "INTERNAL_ERROR", userResult.error?.message || "Create user failed");
  }

  const userId = userResult.data.user.id;

  const profileResult = await admin
    .from("profiles")
    .insert({
      id: userId,
      tenant_id: tenantId,
      branch_id: branchId,
      role,
      display_name: displayName,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .select("id, tenant_id, branch_id, role, display_name, is_active")
    .maybeSingle();

  if (profileResult.error || !profileResult.data) {
    return fail(500, "INTERNAL_ERROR", profileResult.error?.message || "Create profile failed");
  }

  let memberRow: any = null;
  if (role === "member" && createMember) {
    const memberResult = await admin
      .from("members")
      .insert({
        tenant_id: tenantId,
        store_id: branchId,
        auth_user_id: userId,
        full_name: memberFullName,
        phone: memberPhone,
      })
      .select("id, full_name, phone")
      .maybeSingle();

    if (memberResult.error) {
      return fail(500, "INTERNAL_ERROR", memberResult.error.message);
    }
    memberRow = memberResult.data;
  }

  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: auth.context.userId,
    action: "platform_user_create",
    target_type: "profile",
    target_id: userId,
    reason: null,
    payload: { role, branchId, displayName, isActive, email, createdMember: Boolean(memberRow) },
  });

  return NextResponse.json(
    {
      ok: true,
      data: {
        user: { id: userId, email },
        profile: profileResult.data,
        member: memberRow,
      },
      user: { id: userId, email },
      profile: profileResult.data,
      member: memberRow,
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const profileId = typeof body?.profileId === "string" ? body.profileId.trim() : "";
  const role = (typeof body?.role === "string" ? body.role : "") as AppRole;
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId : null;
  const branchId = typeof body?.branchId === "string" ? body.branchId : null;
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : null;
  const isActive = body?.isActive === false ? false : true;

  if (!profileId || !ROLES.includes(role)) {
    return fail(400, "FORBIDDEN", "profileId and valid role are required");
  }
  if (role !== "platform_admin" && !tenantId) {
    return fail(400, "FORBIDDEN", "tenantId is required for non-platform users");
  }

  const { data, error } = await auth.supabase
    .from("profiles")
    .update({
      role,
      tenant_id: role === "platform_admin" ? null : tenantId,
      branch_id: branchId || null,
      display_name: displayName || null,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId)
    .select("id, tenant_id, branch_id, role, display_name, is_active, created_at, updated_at")
    .maybeSingle();

  if (error) return fail(500, "INTERNAL_ERROR", error.message);
  if (!data) return fail(404, "FORBIDDEN", "Profile not found");

  await auth.supabase.from("audit_logs").insert({
    tenant_id: role === "platform_admin" ? null : tenantId,
    actor_id: auth.context.userId,
    action: "platform_user_updated",
    target_type: "profile",
    target_id: profileId,
    reason: null,
    payload: {
      role,
      tenantId: role === "platform_admin" ? null : tenantId,
      branchId: branchId || null,
      displayName: displayName || null,
      isActive,
    },
  });

  return ok({ profile: data });
}
