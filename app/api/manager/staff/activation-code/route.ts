import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { createInAppNotifications } from "../../../../../lib/in-app-notifications";
import { requirePermission } from "../../../../../lib/permissions";
import { verifySensitiveOperator } from "../../../../../lib/sensitive-reauth";
import {
  generateInternalStaffPassword,
  generateStaffActivationCode,
  staffActivationCodeHash,
  staffActivationExpiresAt,
  staffActivationSecret,
} from "../../../../../lib/staff-activation";
import {
  canManagePosition,
  normalizeStaffDepartment,
  normalizeStaffPosition,
} from "../../../../../lib/staff-organization";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const STAFF_ROLES = ["manager", "supervisor", "branch_manager", "frontdesk", "coach", "sales"] as const;

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const reauth = await verifySensitiveOperator({
    session: auth.context,
    credentials: body?.reauth,
  });
  if (!reauth.ok) return apiError(401, "UNAUTHORIZED", reauth.message);
  const permission = requirePermission(reauth.operator, "staff.update");
  if (!permission.ok) return permission.response;

  const profileId = typeof body?.id === "string" ? body.id.trim() : "";
  if (!profileId) return apiError(400, "FORBIDDEN", "id is required");

  const tenantId =
    auth.context.role === "platform_admin"
      ? (typeof body?.tenantId === "string" ? body.tenantId.trim() : "") || auth.context.tenantId || ""
      : auth.context.tenantId || "";
  if (!tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const admin = createSupabaseAdminClient();
  const targetResult = await admin
    .from("profiles")
    .select("id, role, department, position, branch_id, tenant_id, display_name, english_name, employee_number, is_active, staff_deleted_at, staff_activation_status")
    .eq("tenant_id", tenantId)
    .eq("id", profileId)
    .in("role", [...STAFF_ROLES])
    .maybeSingle();
  if (targetResult.error) return apiError(500, "INTERNAL_ERROR", targetResult.error.message);
  const target = targetResult.data;
  if (!target || !target.is_active || target.staff_deleted_at) {
    return apiError(404, "FORBIDDEN", "staff not found");
  }
  if (target.staff_activation_status === "completed") {
    return apiError(409, "FORBIDDEN", "此員工已完成首次啟用，請使用忘記密碼流程");
  }

  if (
    reauth.operator.role !== "platform_admin" &&
    !canManagePosition(
      {
        role: reauth.operator.role,
        department: reauth.operator.department || null,
        position: reauth.operator.position || null,
        branchId: reauth.operator.branchId,
      },
      normalizeStaffDepartment(target.department),
      normalizeStaffPosition(target.position),
    )
  ) {
    return apiError(403, "ROLE_ASSIGNMENT_DENIED", "You cannot reset this employee's activation");
  }
  if (
    reauth.operator.role !== "platform_admin" &&
    reauth.operator.branchId &&
    String(target.branch_id || "") !== reauth.operator.branchId
  ) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Cannot reset activation outside your branch scope");
  }

  const activationCode = generateStaffActivationCode();
  const expiresAt = staffActivationExpiresAt();
  let tokenHash = "";
  try {
    tokenHash = staffActivationCodeHash(activationCode, staffActivationSecret());
  } catch (error) {
    return apiError(
      500,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Staff activation configuration is missing",
    );
  }

  const now = new Date().toISOString();
  const authUpdate = await admin.auth.admin.updateUserById(profileId, {
    password: generateInternalStaffPassword(),
  });
  if (authUpdate.error) return apiError(500, "INTERNAL_ERROR", authUpdate.error.message);

  const revokeResult = await admin
    .from("staff_activation_tokens")
    .update({ revoked_at: now })
    .eq("profile_id", profileId)
    .is("revoked_at", null);
  if (revokeResult.error) return apiError(500, "INTERNAL_ERROR", revokeResult.error.message);

  const tokenResult = await admin.from("staff_activation_tokens").insert({
    profile_id: profileId,
    tenant_id: tenantId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    failed_attempts: 0,
    created_by: reauth.operator.userId,
  });
  if (tokenResult.error) return apiError(500, "INTERNAL_ERROR", tokenResult.error.message);

  const profileUpdate = await admin
    .from("profiles")
    .update({
      staff_activation_status: "pending_identity",
      staff_identity_confirmed_at: null,
      staff_identity_denied_at: null,
      must_change_password: true,
      password_reset_required_at: now,
      updated_by: reauth.operator.userId,
      updated_at: now,
    })
    .eq("id", profileId)
    .eq("tenant_id", tenantId);
  if (profileUpdate.error) return apiError(500, "INTERNAL_ERROR", profileUpdate.error.message);

  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: reauth.operator.userId,
    action: "staff_activation_code_regenerated",
    target_type: "profile",
    target_id: profileId,
    reason: reauth.reason,
    payload: {
      employeeNumber: target.employee_number,
      expiresAt,
      previousStatus: target.staff_activation_status,
    },
  });

  await createInAppNotifications({
    supabase: admin,
    tenantId,
    branchId: target.branch_id,
    recipientUserIds: [profileId],
    title: "主管已重新開放首次啟用",
    message: "主管已確認並重新產生一次性啟用碼。請取得新啟用碼後完成本人確認、Email 驗證與正式密碼設定。",
    severity: "warning",
    eventType: "staff_activation_reset",
    targetType: "profile",
    targetId: profileId,
    actionUrl: "/staff/activate",
    dedupeKey: `staff-activation-reset:${profileId}:${now}`,
    createdBy: reauth.operator.userId,
  }).catch(() => null);

  return apiSuccess({
    id: profileId,
    employeeNumber: target.employee_number,
    displayName: target.display_name,
    englishName: target.english_name,
    activation: {
      code: activationCode,
      expiresAt,
      shownOnce: true,
    },
  });
}
