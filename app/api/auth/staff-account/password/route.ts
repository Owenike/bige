import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import { verifyStaffCurrentPassword } from "../../../../../lib/staff-account-security";
import { canUseStaffAccountSettings } from "../../../../../lib/staff-credentials";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const STAFF_ACCOUNT_ROLES = [
  "platform_admin",
  "manager",
  "frontdesk",
  "coach",
  "sales",
] as const;
const PASSWORD_MIN_LENGTH = 6;

export async function POST(request: Request) {
  const auth = await requireProfile([...STAFF_ACCOUNT_ROLES], request);
  if (!auth.ok) return auth.response;

  const rateLimit = rateLimitFixedWindow({
    key: `staff_account_password:${auth.context.userId}`,
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.ok) {
    return apiError(429, "FORBIDDEN", "嘗試次數過多，請稍後再試");
  }

  const body = await request.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
    return apiError(400, "FORBIDDEN", `新密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元`);
  }
  if (currentPassword === newPassword) {
    return apiError(400, "FORBIDDEN", "新密碼不可與目前密碼相同");
  }

  const admin = createSupabaseAdminClient();
  const [profileResult, userResult] = await Promise.all([
    admin
      .from("profiles")
      .select("employee_number")
      .eq("id", auth.context.userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(auth.context.userId),
  ]);
  if (profileResult.error || !profileResult.data) {
    return apiError(404, "FORBIDDEN", "找不到員工帳號");
  }
  if (!canUseStaffAccountSettings(profileResult.data.employee_number)) {
    return apiError(403, "FORBIDDEN", "此帳號不提供密碼變更功能");
  }
  const email = userResult.data.user?.email || "";
  if (userResult.error || !email) {
    return apiError(500, "INTERNAL_ERROR", userResult.error?.message || "找不到登入信箱");
  }

  const verified = await verifyStaffCurrentPassword(email, currentPassword);
  if (!verified.ok) {
    return apiError(401, "UNAUTHORIZED", verified.error);
  }

  const updateResult = await admin.auth.admin.updateUserById(auth.context.userId, {
    password: newPassword,
  });
  if (updateResult.error) {
    return apiError(500, "INTERNAL_ERROR", updateResult.error.message);
  }

  const changedAt = new Date().toISOString();
  await admin.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "staff_password_changed",
    target_type: "profile",
    target_id: auth.context.userId,
    reason: "self_service",
    payload: { changedAt },
  });

  return apiSuccess({ changed: true, changedAt });
}
