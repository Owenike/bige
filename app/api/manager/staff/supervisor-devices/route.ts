import { NextResponse } from "next/server";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import type { SensitiveCredentials } from "../../../../../lib/sensitive-reauth";
import { verifySensitiveOperator } from "../../../../../lib/sensitive-reauth";
import { canManageStaffAccounts } from "../../../../../lib/staff-credentials";
import {
  SUPERVISOR_BINDING_TTL_MS,
  createSupervisorSecret,
  hashSupervisorSecret,
  requiresSupervisorBiometric,
} from "../../../../../lib/supervisor-biometric";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

async function requireAccount01(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth;
  if (!canManageStaffAccounts(auth.context)) {
    return { ok: false as const, response: apiError(403, "FORBIDDEN", "只有 01 可以管理主管手機") };
  }
  return auth;
}

export async function GET(request: Request) {
  const auth = await requireAccount01(request);
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  const [devicesResult, enforcedProfilesResult] = await Promise.all([
    admin
      .from("supervisor_biometric_devices")
      .select("id, profile_id, device_type, backed_up, user_agent, created_at, last_used_at, last_push_at")
      .is("revoked_at", null),
    admin
      .from("profiles")
      .select("id")
      .not("supervisor_biometric_enforced_at", "is", null),
  ]);
  if (devicesResult.error) return apiError(500, "INTERNAL_ERROR", devicesResult.error.message);
  if (enforcedProfilesResult.error) return apiError(500, "INTERNAL_ERROR", enforcedProfilesResult.error.message);
  return apiSuccess({
    items: devicesResult.data || [],
    enforcedProfileIds: (enforcedProfilesResult.data || []).map((profile) => profile.id),
  });
}

export async function POST(request: Request) {
  const auth = await requireAccount01(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    profileId?: string;
    reauth?: SensitiveCredentials;
  } | null;
  const reauth = await verifySensitiveOperator({
    session: auth.context,
    credentials: body?.reauth,
  });
  if (!reauth.ok) return apiError(401, "UNAUTHORIZED", reauth.message);
  if (!canManageStaffAccounts(reauth.operator)) {
    return apiError(403, "FORBIDDEN", "只有 01 可以建立主管手機綁定");
  }
  const profileId = body?.profileId?.trim() || "";
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) {
    return apiError(400, "FORBIDDEN", "主管帳號格式不正確");
  }

  const admin = createSupabaseAdminClient();
  const targetResult = await admin
    .from("profiles")
    .select("id, tenant_id, branch_id, role, position, employee_number, display_name, english_name, is_active, staff_deleted_at, staff_activation_status")
    .eq("id", profileId)
    .maybeSingle();
  const target = targetResult.data;
  if (
    targetResult.error ||
    !target ||
    target.is_active !== true ||
    target.staff_deleted_at ||
    target.staff_activation_status !== "completed" ||
    !requiresSupervisorBiometric(target)
  ) {
    return apiError(409, "FORBIDDEN", "此帳號不是已啟用的主管帳號");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  await admin
    .from("supervisor_biometric_bindings")
    .update({ revoked_at: nowIso })
    .eq("profile_id", target.id)
    .is("used_at", null)
    .is("revoked_at", null);
  const token = createSupervisorSecret();
  const expiresAt = new Date(now.getTime() + SUPERVISOR_BINDING_TTL_MS).toISOString();
  const reason = reauth.reason || `01 為 ${target.employee_number || target.id} 建立主管手機綁定`;
  const bindingResult = await admin
    .from("supervisor_biometric_bindings")
    .insert({
      profile_id: target.id,
      token_hash: hashSupervisorSecret(token),
      created_by: reauth.operator.userId,
      created_via: "platform_admin",
      reason,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (bindingResult.error) return apiError(500, "INTERNAL_ERROR", bindingResult.error.message);

  await admin.from("audit_logs").insert({
    tenant_id: target.tenant_id,
    actor_id: reauth.operator.userId,
    action: "supervisor_biometric_binding_created",
    target_type: "profile",
    target_id: target.id,
    reason,
    payload: { employeeNumber: target.employee_number, expiresAt },
  });
  const origin = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  return apiSuccess({
    profileId: target.id,
    employeeNumber: target.employee_number,
    displayName: target.display_name || target.english_name || null,
    expiresAt,
    bindingUrl: `${origin}/staff/supervisor-device#token=${token}`,
  });
}

export async function DELETE(request: Request) {
  const auth = await requireAccount01(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    profileId?: string;
    reauth?: SensitiveCredentials;
  } | null;
  const reauth = await verifySensitiveOperator({ session: auth.context, credentials: body?.reauth });
  if (!reauth.ok) return apiError(401, "UNAUTHORIZED", reauth.message);
  if (!canManageStaffAccounts(reauth.operator)) {
    return apiError(403, "FORBIDDEN", "只有 01 可以解除主管手機綁定");
  }
  const profileId = body?.profileId?.trim() || "";
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) {
    return apiError(400, "FORBIDDEN", "主管帳號格式不正確");
  }

  const admin = createSupabaseAdminClient();
  const targetResult = await admin
    .from("profiles")
    .select("id, tenant_id, employee_number")
    .eq("id", profileId)
    .maybeSingle();
  if (targetResult.error || !targetResult.data) return apiError(404, "FORBIDDEN", "找不到主管帳號");
  const now = new Date().toISOString();
  const [devices, sessions, requests, bindings] = await Promise.all([
    admin
      .from("supervisor_biometric_devices")
      .update({ revoked_at: now, revoke_reason: reauth.reason })
      .eq("profile_id", profileId)
      .is("revoked_at", null)
      .select("id"),
    admin
      .from("supervisor_biometric_sessions")
      .update({ revoked_at: now, revoke_reason: reauth.reason })
      .eq("profile_id", profileId)
      .is("revoked_at", null),
    admin
      .from("supervisor_biometric_login_requests")
      .update({ status: "expired", updated_at: now })
      .eq("profile_id", profileId)
      .in("status", ["pending", "approved", "consuming"]),
    admin
      .from("supervisor_biometric_bindings")
      .update({ revoked_at: now })
      .eq("profile_id", profileId)
      .is("used_at", null)
      .is("revoked_at", null),
  ]);
  const failure = [devices, sessions, requests, bindings].find((result) => result.error);
  if (failure?.error) return apiError(500, "INTERNAL_ERROR", failure.error.message);
  await admin.from("audit_logs").insert({
    tenant_id: targetResult.data.tenant_id,
    actor_id: reauth.operator.userId,
    action: "supervisor_biometric_device_revoked",
    target_type: "profile",
    target_id: profileId,
    reason: reauth.reason,
    payload: { employeeNumber: targetResult.data.employee_number, revokedDeviceCount: devices.data?.length || 0 },
  });
  return apiSuccess({ revoked: true, revokedDeviceCount: devices.data?.length || 0 });
}
