import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { parseNotificationPreflightQuery } from "../../../../../lib/notification-preflight-query";
import {
  buildNotificationRuntimeReadinessFixtureReport,
  buildNotificationRuntimeReadinessLiveReport,
} from "../../../../../lib/notification-runtime-readiness-report";
import { parseNotificationRuntimeSimulationScenarioId } from "../../../../../lib/notification-runtime-simulation-fixtures";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const scenarioId = parseNotificationRuntimeSimulationScenarioId(params.get("scenarioId"));
  if (scenarioId) {
    const fixture = buildNotificationRuntimeReadinessFixtureReport({
      scenarioId,
      tenantIdOverride: params.get("tenantId"),
    });
    if (!fixture.ok) return apiError(400, "FORBIDDEN", fixture.error);
    return apiSuccess({
      scope: "platform",
      tenantId: fixture.result.report.eventInput.tenantId,
      source: fixture.result.source,
      scenarioId: fixture.result.scenarioId,
      report: fixture.result.report,
    });
  }

  const parsed = parseNotificationPreflightQuery(params);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);
  if (!parsed.query.tenantId) return apiError(400, "FORBIDDEN", "tenantId is required for live runtime readiness report");

  const report = await buildNotificationRuntimeReadinessLiveReport({
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
    tenantId: report.result.report.eventInput.tenantId,
    source: report.result.source,
    scenarioId: report.result.scenarioId,
    report: report.result.report,
  });
}
