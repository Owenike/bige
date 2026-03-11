import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { parseNotificationOpsApiQuery, resolvePlatformOpsScope } from "../../../../../../lib/notification-ops-api";
import {
  getPreferenceCoverageSummary,
  getRetryOperationsSummary,
  getTemplateCoverageSummary,
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
  const [templateCoverage, preferenceCoverage, retryOperations] = await Promise.all([
    getTemplateCoverageSummary({
      scope: scoped.scope,
      tenantId: scoped.tenantId,
      limit: parsed.query.limit,
      defaultLocale: parsed.query.defaultLocale,
    }),
    getPreferenceCoverageSummary({
      scope: scoped.scope,
      tenantId: scoped.tenantId,
      limit: parsed.query.limit,
    }),
    getRetryOperationsSummary({
      scope: scoped.scope,
      tenantId: scoped.tenantId,
      limit: parsed.query.limit,
    }),
  ]);
  if (!templateCoverage.ok) return apiError(500, "INTERNAL_ERROR", templateCoverage.error);
  if (!preferenceCoverage.ok) return apiError(500, "INTERNAL_ERROR", preferenceCoverage.error);
  if (!retryOperations.ok) return apiError(500, "INTERNAL_ERROR", retryOperations.error);

  return apiSuccess({
    scope: scoped.scope,
    tenantId: scoped.tenantId,
    templateCoverage: templateCoverage.summary,
    preferenceCoverage: preferenceCoverage.summary,
    retryOperations: retryOperations.summary,
    warning: retryOperations.warning || null,
  });
}
