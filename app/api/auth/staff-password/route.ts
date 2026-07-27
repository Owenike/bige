import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { isStaffPlaceholderEmail } from "../../../../lib/staff-credentials";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export async function POST(request: Request) {
  const auth = await requireProfile(
    ["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk", "coach", "sales"],
    request,
    { allowIncompleteStaffActivation: true },
  );
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const passwordChanged = body?.passwordChanged === true;
  if (!passwordChanged) return apiError(400, "FORBIDDEN", "passwordChanged confirmation is required");

  const admin = createSupabaseAdminClient();
  const userResult = await admin.auth.admin.getUserById(auth.context.userId);
  if (userResult.error || !userResult.data.user) {
    return apiError(500, "INTERNAL_ERROR", userResult.error?.message || "User not found");
  }
  const userEmail = userResult.data.user.email || "";
  if (!userResult.data.user.email_confirmed_at || !userEmail || isStaffPlaceholderEmail(userEmail)) {
    return apiError(403, "FORBIDDEN", "請先完成本人 Email 驗證");
  }

  const profileResult = await admin
    .from("profiles")
    .select("staff_email_verified_at, staff_activation_status")
    .eq("id", auth.context.userId)
    .maybeSingle();
  if (profileResult.error || !profileResult.data?.staff_email_verified_at) {
    return apiError(403, "FORBIDDEN", "請先完成本人 Email 驗證");
  }
  if (
    profileResult.data.staff_activation_status !== "identity_confirmed" &&
    profileResult.data.staff_activation_status !== "completed"
  ) {
    return apiError(403, "FORBIDDEN", "請先完成本人確認");
  }

  const now = new Date().toISOString();
  const updateResult = await admin
    .from("profiles")
    .update({
      must_change_password: false,
      password_reset_required_at: null,
      staff_email_verified_at: userResult.data.user.email_confirmed_at || now,
      staff_activation_status: "completed",
      staff_activation_completed_at: now,
      updated_at: now,
    })
    .eq("id", auth.context.userId);
  if (updateResult.error) return apiError(500, "INTERNAL_ERROR", updateResult.error.message);

  await admin.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "staff_password_changed",
    target_type: "profile",
    target_id: auth.context.userId,
    reason: null,
    payload: { emailVerifiedAt: userResult.data.user.email_confirmed_at || now },
  });

  const home =
    auth.context.role === "platform_admin"
      ? "/platform-admin"
      : auth.context.role === "frontdesk"
        ? "/frontdesk/fitness"
        : auth.context.role === "coach"
          ? "/coach/fitness"
          : "/manager/fitness";
  return apiSuccess({ home });
}
