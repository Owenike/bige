import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { parseNotificationOpsApiQuery, resolvePlatformOpsScope } from "../../../../../../lib/notification-ops-api";
import { getNotificationOpsReliabilitySnapshot } from "../../../../../../lib/notification-platform-ops-query";
import { requirePermission } from "../../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const parsed = parseNotificationOpsApiQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);

  const scoped = resolvePlatformOpsScope(parsed.query);
  const snapshot = await getNotificationOpsReliabilitySnapshot({
    scope: scoped.scope,
    tenantId: scoped.tenantId,
    limit: parsed.query.limit,
    staleAfterMinutes: parsed.query.staleAfterMinutes,
    defaultLocale: parsed.query.defaultLocale,
  });
  if (!snapshot.ok) return apiError(500, "INTERNAL_ERROR", snapshot.error);

  return apiSuccess({
    scope: scoped.scope,
    tenantId: scoped.tenantId,
    snapshot: snapshot.snapshot,
    warning: snapshot.warning || null,
  });
}
