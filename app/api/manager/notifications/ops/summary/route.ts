import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { parseNotificationOpsApiQuery, resolveManagerOpsScope } from "../../../../../../lib/notification-ops-api";
import { getNotificationOpsReliabilitySnapshot } from "../../../../../../lib/notification-platform-ops-query";
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

  const snapshot = await getNotificationOpsReliabilitySnapshot({
    scope: scoped.scope.scope,
    tenantId: scoped.scope.tenantId,
    limit: parsed.query.limit,
    staleAfterMinutes: parsed.query.staleAfterMinutes,
    defaultLocale: parsed.query.defaultLocale,
  });
  if (!snapshot.ok) return apiError(500, "INTERNAL_ERROR", snapshot.error);

  return apiSuccess({
    scope: scoped.scope.scope,
    tenantId: scoped.scope.tenantId,
    snapshot: snapshot.snapshot,
    warning: snapshot.warning || null,
  });
}
