import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { dispatchNotificationDeliveries } from "../../../../../lib/notification-dispatch";
import { completeJobRun, createJobRun } from "../../../../../lib/notification-ops";

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : null;
  const limit = Math.min(1000, Math.max(1, Number(body?.limit || 300)));
  const includeFailed = body?.includeFailed !== false;
  const jobRun = await createJobRun({
    tenantId,
    jobType: "delivery_dispatch",
    triggerMode: "manual",
    initiatedBy: auth.context.userId,
    payload: {
      source: "platform_notifications_dispatch",
      includeFailed,
      limit,
    },
  });

  const result = await dispatchNotificationDeliveries({
    tenantId,
    mode: "job",
    includeFailed,
    limit,
    deliveryIds: Array.isArray(body?.deliveryIds)
      ? body.deliveryIds.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined,
  });
  if (!result.ok) {
    await completeJobRun({
      jobRunId: jobRun.ok ? jobRun.jobRunId : null,
      status: "failed",
      affectedCount: 0,
      errorCount: 1,
      errorSummary: result.error,
      payload: {},
    });
    return apiError(500, "INTERNAL_ERROR", result.error);
  }

  await completeJobRun({
    jobRunId: jobRun.ok ? jobRun.jobRunId : null,
    status: result.summary.failed > 0 ? (result.summary.sent > 0 ? "partial" : "failed") : "success",
    affectedCount: result.summary.processed,
    errorCount: result.summary.failed,
    errorSummary: result.summary.failed > 0 ? "Some deliveries failed" : null,
    payload: {
      sent: result.summary.sent,
      skipped: result.summary.skipped,
      failed: result.summary.failed,
      retrying: result.summary.retrying,
    },
  });

  return apiSuccess({
    tenantId,
    includeFailed,
    summary: result.summary,
  });
}
