import { apiError, requireProfile } from "./auth-context";
import { canManageStaffAccounts } from "./staff-credentials";

export async function requireStaffAccountAdministrator(request?: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth;

  if (!canManageStaffAccounts(auth.context)) {
    return {
      ok: false as const,
      response: apiError(
        403,
        "FORBIDDEN",
        "僅限 01 系統管理員使用員工帳號管理",
      ),
    };
  }

  return auth;
}
