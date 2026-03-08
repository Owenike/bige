import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import { listDeliveryRows, listRecentJobRuns } from "../../../../../lib/notification-ops";
import { runNotificationSweep } from "../../../../../lib/in-app-notifications";
import { runOpportunitySweep } from "../../../../../lib/opportunities";
import { dispatchNotificationDeliveries } from "../../../../../lib/notification-dispatch";
import { completeJobRun, createJobRun } from "../../../../../lib/notification-ops";

function toRecordCount(items: Array<{ key: string }>) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.key] = (acc[item.key] || 0) + 1;
    return acc;
  }, {});
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId && auth.context.role !== "platform_admin") {
    return apiError(400, "FORBIDDEN", "Missing tenant scope");
  }

  const permission = requirePermission(auth.context, "reports.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const requestedTenantId = params.get("tenantId");
  const tenantId = auth.context.role === "platform_admin" ? requestedTenantId : auth.context.tenantId;
  if (!tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const limit = Math.min(200, Math.max(1, Number(params.get("limit") || 80)));

  const [jobRuns, deliveries] = await Promise.all([
    listRecentJobRuns({ tenantId, limit }),
    listDeliveryRows({ tenantId, limit: limit * 2 }),
  ]);
  if (!jobRuns.ok) return apiError(500, "INTERNAL_ERROR", jobRuns.error);
  if (!deliveries.ok) return apiError(500, "INTERNAL_ERROR", deliveries.error);

  const byStatus = toRecordCount(deliveries.items.map((item) => ({ key: item.status })));
  const byChannel = toRecordCount(deliveries.items.map((item) => ({ key: item.channel })));
  const externalDeliveries = deliveries.items.filter((item) => item.channel !== "in_app");
  const externalByStatus = toRecordCount(externalDeliveries.map((item) => ({ key: item.status })));
  const externalByChannel = toRecordCount(externalDeliveries.map((item) => ({ key: item.channel })));
  const channelNotConfigured = externalDeliveries.filter((item) => item.error_code === "CHANNEL_NOT_CONFIGURED").length;
  const providerErrors = toRecordCount(
    externalDeliveries
      .filter((item) => item.error_code && item.error_code !== "CHANNEL_POLICY_SKIPPED")
      .map((item) => ({ key: item.error_code || "UNKNOWN" })),
  );

  return apiSuccess({
    tenantId,
    summary: {
      jobRuns: jobRuns.items.length,
      deliveryRows: deliveries.items.length,
      failed: byStatus.failed || 0,
      retrying: byStatus.retrying || 0,
      sent: byStatus.sent || 0,
      skipped: byStatus.skipped || 0,
      byStatus,
      byChannel,
      external: {
        total: externalDeliveries.length,
        sent: externalByStatus.sent || 0,
        failed: externalByStatus.failed || 0,
        retrying: externalByStatus.retrying || 0,
        skipped: externalByStatus.skipped || 0,
        pending: externalByStatus.pending || 0,
        channelNotConfigured,
        byStatus: externalByStatus,
        byChannel: externalByChannel,
        providerErrors,
      },
    },
    runs: jobRuns.items,
    failedDeliveries: deliveries.items.filter((item) => item.status === "failed").slice(0, 80),
    retryingDeliveries: deliveries.items.filter((item) => item.status === "retrying").slice(0, 80),
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "crm.write");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim() : "";

  if (action === "run_sweep") {
    const notificationRun = await createJobRun({
      tenantId: auth.context.tenantId,
      jobType: "notification_sweep",
      triggerMode: "manual",
      initiatedBy: auth.context.userId,
      payload: { source: "manager_notifications_ops" },
    });
    const opportunityRun = await createJobRun({
      tenantId: auth.context.tenantId,
      jobType: "opportunity_sweep",
      triggerMode: "manual",
      initiatedBy: auth.context.userId,
      payload: { source: "manager_notifications_ops" },
    });
    const [notificationSweep, opportunitySweep] = await Promise.all([
      runNotificationSweep({
        actorRole: auth.context.role,
        actorUserId: auth.context.userId,
        tenantId: auth.context.tenantId,
      }),
      runOpportunitySweep({
        actorRole: auth.context.role,
        actorUserId: auth.context.userId,
        tenantId: auth.context.tenantId,
      }),
    ]);
    await completeJobRun({
      jobRunId: notificationRun.ok ? notificationRun.jobRunId : null,
      status: notificationSweep.ok ? "success" : "failed",
      affectedCount: notificationSweep.ok ? notificationSweep.summary.generated : 0,
      errorCount: notificationSweep.ok ? 0 : 1,
      errorSummary: notificationSweep.ok ? null : notificationSweep.error,
      payload: notificationSweep.ok ? { byEventType: notificationSweep.summary.byEventType } : {},
    });
    await completeJobRun({
      jobRunId: opportunityRun.ok ? opportunityRun.jobRunId : null,
      status: opportunitySweep.ok ? "success" : "failed",
      affectedCount: opportunitySweep.ok ? opportunitySweep.summary.inserted : 0,
      errorCount: opportunitySweep.ok ? 0 : 1,
      errorSummary: opportunitySweep.ok ? null : opportunitySweep.error,
      payload: opportunitySweep.ok
        ? { byType: opportunitySweep.summary.byType, reminders: opportunitySweep.summary.reminders }
        : {},
    });
    if (!notificationSweep.ok) return apiError(500, "INTERNAL_ERROR", notificationSweep.error);
    if (!opportunitySweep.ok) return apiError(500, "INTERNAL_ERROR", opportunitySweep.error);
    return apiSuccess({
      action,
      notificationGenerated: notificationSweep.summary.generated,
      notificationByEventType: notificationSweep.summary.byEventType,
      opportunityInserted: opportunitySweep.summary.inserted,
      opportunityByType: opportunitySweep.summary.byType,
      opportunityReminders: opportunitySweep.summary.reminders,
    });
  }

  if (action === "retry_deliveries") {
    const dispatchRun = await createJobRun({
      tenantId: auth.context.tenantId,
      jobType: "delivery_dispatch",
      triggerMode: "manual",
      initiatedBy: auth.context.userId,
      payload: { source: "manager_notifications_ops" },
    });
    const dispatch = await dispatchNotificationDeliveries({
      tenantId: auth.context.tenantId,
      mode: "job",
      includeFailed: true,
      limit: Math.min(500, Math.max(1, Number(body?.limit || 150))),
    });
    await completeJobRun({
      jobRunId: dispatchRun.ok ? dispatchRun.jobRunId : null,
      status: !dispatch.ok
        ? "failed"
        : dispatch.summary.failed > 0
          ? dispatch.summary.sent > 0
            ? "partial"
            : "failed"
          : "success",
      affectedCount: dispatch.ok ? dispatch.summary.processed : 0,
      errorCount: dispatch.ok ? dispatch.summary.failed : 1,
      errorSummary: dispatch.ok ? (dispatch.summary.failed > 0 ? "Some deliveries failed" : null) : dispatch.error,
      payload: dispatch.ok
        ? {
            sent: dispatch.summary.sent,
            skipped: dispatch.summary.skipped,
            failed: dispatch.summary.failed,
            retrying: dispatch.summary.retrying,
          }
        : {},
    });
    if (!dispatch.ok) return apiError(500, "INTERNAL_ERROR", dispatch.error);
    return apiSuccess({
      action,
      summary: dispatch.summary,
    });
  }

  return apiError(400, "FORBIDDEN", "Unsupported action");
}
