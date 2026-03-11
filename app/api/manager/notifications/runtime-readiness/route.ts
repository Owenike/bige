import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { parseNotificationPreflightQuery } from "../../../../../lib/notification-preflight-query";
import { isManagerTenantScopeAllowed } from "../../../../../lib/notification-productization";
import {
  buildNotificationRuntimeReadinessFixtureReport,
  buildNotificationRuntimeReadinessLiveReport,
} from "../../../../../lib/notification-runtime-readiness-report";
import { parseNotificationRuntimeSimulationScenarioId } from "../../../../../lib/notification-runtime-simulation-fixtures";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "reports.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = parseNotificationPreflightQuery(params);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);
  if (!isManagerTenantScopeAllowed(auth.context.tenantId, parsed.query.tenantId)) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "tenantId mismatch");
  }

  const scenarioId = parseNotificationRuntimeSimulationScenarioId(params.get("scenarioId"));
  if (scenarioId) {
    const fixture = buildNotificationRuntimeReadinessFixtureReport({
      scenarioId,
      tenantIdOverride: auth.context.tenantId,
      eventKeyOverride: parsed.query.eventKey,
      roleKeyOverride: parsed.query.roleKey,
      userIdOverride: parsed.query.userId,
      channelHintOverride: parsed.query.channelHint,
      localeOverride: parsed.query.locale,
      defaultLocaleOverride: parsed.query.defaultLocale,
      recipientLimitOverride: parsed.query.recipientLimit,
    });
    if (!fixture.ok) return apiError(400, "FORBIDDEN", fixture.error);
    return apiSuccess({
      scope: "tenant",
      tenantId: auth.context.tenantId,
      source: fixture.result.source,
      scenarioId: fixture.result.scenarioId,
      report: fixture.result.report,
    });
  }

  const report = await buildNotificationRuntimeReadinessLiveReport({
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
    source: report.result.source,
    scenarioId: report.result.scenarioId,
    report: report.result.report,
  });
}
