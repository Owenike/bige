import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { parseNotificationOpsApiQuery, resolvePlatformOpsScope } from "../../../../../../lib/notification-ops-api";
import {
  getTenantNotificationHealthSummary,
  getTenantScheduledHealthSummary,
} from "../../../../../../lib/notification-platform-ops-query";
import { requirePermission } from "../../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const parsed = parseNotificationOpsApiQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);

  const scoped = resolvePlatformOpsScope(parsed.query);
  const [notificationHealth, scheduledHealth] = await Promise.all([
    getTenantNotificationHealthSummary({
      scope: scoped.scope,
      tenantId: scoped.tenantId,
      limit: parsed.query.limit,
    }),
    getTenantScheduledHealthSummary({
      scope: scoped.scope,
      tenantId: scoped.tenantId,
      limit: parsed.query.limit,
      staleAfterMinutes: parsed.query.staleAfterMinutes,
    }),
  ]);
  if (!notificationHealth.ok) return apiError(500, "INTERNAL_ERROR", notificationHealth.error);
  if (!scheduledHealth.ok) return apiError(500, "INTERNAL_ERROR", scheduledHealth.error);

  return apiSuccess({
    scope: scoped.scope,
    tenantId: scoped.tenantId,
    notificationHealth: notificationHealth.summary,
    scheduledHealth: scheduledHealth.summary,
  });
}
