import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import { verifySensitiveOperator } from "../../../../../lib/sensitive-reauth";
import { canManagePosition, normalizeStaffDepartment, normalizeStaffPosition } from "../../../../../lib/staff-organization";
import { isStaffPlaceholderEmail } from "../../../../../lib/staff-credentials";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const STAFF_ROLES = ["manager", "supervisor", "branch_manager", "frontdesk", "coach", "sales"] as const;

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  const head = name.slice(0, 2);
  return `${head}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

function resolveCanonicalAppUrl(request: Request) {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  try {
    return new URL(request.url).origin.replace(/\/+$/, "");
  } catch {
    return "http://localhost:3000";
  }
}

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

  const targetResult = await auth.supabase
    .from("profiles")
    .select("id, role, department, position, branch_id, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("id", profileId)
    .in("role", [...STAFF_ROLES])
    .maybeSingle();
  if (targetResult.error) return apiError(500, "INTERNAL_ERROR", targetResult.error.message);
  if (!targetResult.data) return apiError(404, "FORBIDDEN", "staff not found");
  if (
    reauth.operator.role !== "platform_admin" &&
    !canManagePosition(
      {
        role: reauth.operator.role,
        department: reauth.operator.department || null,
        position: reauth.operator.position || null,
        branchId: reauth.operator.branchId,
      },
      normalizeStaffDepartment(targetResult.data.department),
      normalizeStaffPosition(targetResult.data.position),
    )
  ) {
    return apiError(403, "ROLE_ASSIGNMENT_DENIED", "You cannot reset this employee's password");
  }

  if (
    reauth.operator.role !== "platform_admin" &&
    reauth.operator.branchId &&
    String(targetResult.data.branch_id || "") !== reauth.operator.branchId
  ) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Cannot reset password outside your branch scope");
  }

  const admin = createSupabaseAdminClient();
  const userResult = await admin.auth.admin.getUserById(profileId);
  if (userResult.error || !userResult.data.user?.email) {
    return apiError(500, "INTERNAL_ERROR", userResult.error?.message || "User email not found");
  }
  if (isStaffPlaceholderEmail(userResult.data.user.email)) {
    return apiError(409, "FORBIDDEN", "此員工尚未完成本人 Email 驗證，無法寄送忘記密碼信");
  }

  const redirectTo = `${resolveCanonicalAppUrl(request)}/staff/change-password?recovery=1`;
  const linkResult = await admin.auth.resetPasswordForEmail(userResult.data.user.email, { redirectTo });
  if (linkResult.error) {
    return apiError(500, "INTERNAL_ERROR", linkResult.error?.message || "Failed to create reset link");
  }

  const profileUpdate = await admin
    .from("profiles")
    .update({
      must_change_password: true,
      password_reset_required_at: new Date().toISOString(),
      updated_by: reauth.operator.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId)
    .eq("tenant_id", tenantId);
  if (profileUpdate.error) return apiError(500, "INTERNAL_ERROR", profileUpdate.error.message);

  await auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: reauth.operator.userId,
    action: "staff_password_reset_link_generated",
    target_type: "profile",
    target_id: profileId,
    reason: reauth.reason,
    payload: {
      maskedEmail: maskEmail(userResult.data.user.email),
    },
  });

  return apiSuccess({
    id: profileId,
    maskedEmail: maskEmail(userResult.data.user.email),
    resetLink: null,
    deliveryStatus: "sent",
  });
}
