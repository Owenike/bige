import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { canUseStaffAccountSettings } from "../../../../lib/staff-credentials";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const STAFF_ACCOUNT_ROLES = [
  "platform_admin",
  "manager",
  "frontdesk",
  "coach",
  "sales",
] as const;

function accountHome(role: string) {
  if (role === "frontdesk") return "/frontdesk/fitness";
  if (role === "coach" || role === "therapist") return "/coach/fitness";
  return "/manager/fitness";
}

export async function GET(request: Request) {
  const auth = await requireProfile([...STAFF_ACCOUNT_ROLES], request);
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  const [profileResult, userResult] = await Promise.all([
    admin
      .from("profiles")
      .select("display_name, english_name, employee_number")
      .eq("id", auth.context.userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(auth.context.userId),
  ]);
  if (profileResult.error || !profileResult.data) {
    return apiError(404, "FORBIDDEN", "找不到員工帳號");
  }
  if (userResult.error || !userResult.data.user) {
    return apiError(500, "INTERNAL_ERROR", userResult.error?.message || "找不到登入帳號");
  }
  if (!canUseStaffAccountSettings(profileResult.data.employee_number)) {
    return apiError(403, "FORBIDDEN", "此帳號不提供信箱與密碼變更功能");
  }

  return apiSuccess({
    displayName: profileResult.data.display_name,
    englishName: profileResult.data.english_name,
    employeeNumber: profileResult.data.employee_number,
    email: userResult.data.user.email || null,
    home: accountHome(auth.context.role),
  });
}
