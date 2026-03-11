import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { evaluateTenantNotificationConfigIntegrity } from "../../../../../lib/notification-config-integrity";
import { uuidLikeSchema } from "../../../../../lib/notification-productization";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const tenantIdRaw = params.get("tenantId");
  const tenantIdParsed = uuidLikeSchema.safeParse(tenantIdRaw);
  if (!tenantIdParsed.success) return apiError(400, "FORBIDDEN", "tenantId is required and must be UUID");
  const defaultLocale = String(params.get("defaultLocale") || "zh-TW").trim() || "zh-TW";

  const evaluated = await evaluateTenantNotificationConfigIntegrity({
    tenantId: tenantIdParsed.data,
    defaultLocale,
  });
  if (!evaluated.ok) return apiError(500, "INTERNAL_ERROR", evaluated.error);

  return apiSuccess({
    scope: "tenant",
    tenantId: tenantIdParsed.data,
    integrity: evaluated.integrity,
  });
}
