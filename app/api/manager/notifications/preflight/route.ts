import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { buildNotificationPreflightReport } from "../../../../../lib/notification-preflight-report";
import { parseNotificationPreflightQuery } from "../../../../../lib/notification-preflight-query";
import { isManagerTenantScopeAllowed } from "../../../../../lib/notification-productization";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "reports.read");
  if (!permission.ok) return permission.response;

  const parsed = parseNotificationPreflightQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);
  if (!isManagerTenantScopeAllowed(auth.context.tenantId, parsed.query.tenantId)) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "tenantId mismatch");
  }

  const report = await buildNotificationPreflightReport({
    tenantId: auth.context.tenantId,
    eventKey: parsed.query.eventKey,
    roleKey: parsed.query.roleKey,
    userId: parsed.query.userId,
    channelHint: parsed.query.channelHint,
    locale: parsed.query.locale,
    defaultLocale: parsed.query.defaultLocale,
    recipientLimit: parsed.query.recipientLimit,
  });
  if (!report.ok) return apiError(500, "INTERNAL_ERROR", report.error);

  return apiSuccess({
    scope: "tenant",
    tenantId: auth.context.tenantId,
    preflight: report.report,
  });
}
