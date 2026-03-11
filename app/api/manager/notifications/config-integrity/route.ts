import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { evaluateTenantNotificationConfigIntegrity } from "../../../../../lib/notification-config-integrity";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "reports.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const defaultLocale = String(params.get("defaultLocale") || "zh-TW").trim() || "zh-TW";
  const evaluated = await evaluateTenantNotificationConfigIntegrity({
    tenantId: auth.context.tenantId,
    defaultLocale,
  });
  if (!evaluated.ok) return apiError(500, "INTERNAL_ERROR", evaluated.error);

  return apiSuccess({
    scope: "tenant",
    tenantId: auth.context.tenantId,
    integrity: evaluated.integrity,
  });
}
