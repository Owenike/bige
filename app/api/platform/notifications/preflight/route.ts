import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { buildNotificationPreflightReport } from "../../../../../lib/notification-preflight-report";
import { parseNotificationPreflightQuery } from "../../../../../lib/notification-preflight-query";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const parsed = parseNotificationPreflightQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);
  if (!parsed.query.tenantId) return apiError(400, "FORBIDDEN", "tenantId is required for platform preflight");

  const report = await buildNotificationPreflightReport({
    tenantId: parsed.query.tenantId,
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
    scope: "platform",
    tenantId: parsed.query.tenantId,
    preflight: report.report,
  });
}
