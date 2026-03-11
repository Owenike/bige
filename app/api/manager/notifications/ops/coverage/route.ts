import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { parseNotificationOpsApiQuery, resolveManagerOpsScope } from "../../../../../../lib/notification-ops-api";
import {
  getPreferenceCoverageSummary,
  getRetryOperationsSummary,
  getTemplateCoverageSummary,
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

  const [templateCoverage, preferenceCoverage, retryOperations] = await Promise.all([
    getTemplateCoverageSummary({
      scope: scoped.scope.scope,
      tenantId: scoped.scope.tenantId,
      limit: parsed.query.limit,
      defaultLocale: parsed.query.defaultLocale,
    }),
    getPreferenceCoverageSummary({
      scope: scoped.scope.scope,
      tenantId: scoped.scope.tenantId,
      limit: parsed.query.limit,
    }),
    getRetryOperationsSummary({
      scope: scoped.scope.scope,
      tenantId: scoped.scope.tenantId,
      limit: parsed.query.limit,
    }),
  ]);
  if (!templateCoverage.ok) return apiError(500, "INTERNAL_ERROR", templateCoverage.error);
  if (!preferenceCoverage.ok) return apiError(500, "INTERNAL_ERROR", preferenceCoverage.error);
  if (!retryOperations.ok) return apiError(500, "INTERNAL_ERROR", retryOperations.error);

  return apiSuccess({
    scope: scoped.scope.scope,
    tenantId: scoped.scope.tenantId,
    templateCoverage: templateCoverage.summary,
    preferenceCoverage: preferenceCoverage.summary,
    retryOperations: retryOperations.summary,
    warning: retryOperations.warning || null,
  });
}
