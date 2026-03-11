import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { parseNotificationOpsApiQuery, resolveManagerOpsScope } from "../../../../../../lib/notification-ops-api";
import {
  getTenantNotificationHealthSummary,
  getTenantScheduledHealthSummary,
} from "../../../../../../lib/notification-platform-ops-query";
import { requirePermission } from "../../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "reports.read");
  if (!permission.ok) return permission.response;

  const parsed = parseNotificationOpsApiQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);

  const scoped = resolveManagerOpsScope({
    context: auth.context,
    query: parsed.query,
  });
  if (!scoped.ok) return apiError(403, scoped.code, scoped.message);

  const [notificationHealth, scheduledHealth] = await Promise.all([
    getTenantNotificationHealthSummary({
      scope: scoped.scope.scope,
      tenantId: scoped.scope.tenantId,
      limit: parsed.query.limit,
    }),
    getTenantScheduledHealthSummary({
      scope: scoped.scope.scope,
      tenantId: scoped.scope.tenantId,
      limit: parsed.query.limit,
      staleAfterMinutes: parsed.query.staleAfterMinutes,
    }),
  ]);
  if (!notificationHealth.ok) return apiError(500, "INTERNAL_ERROR", notificationHealth.error);
  if (!scheduledHealth.ok) return apiError(500, "INTERNAL_ERROR", scheduledHealth.error);

  return apiSuccess({
    scope: scoped.scope.scope,
    tenantId: scoped.scope.tenantId,
    notificationHealth: notificationHealth.summary,
    scheduledHealth: scheduledHealth.summary,
  });
}
