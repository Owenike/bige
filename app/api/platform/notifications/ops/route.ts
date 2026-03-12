import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { listDeliveryRows, listRecentJobRuns } from "../../../../../lib/notification-ops";

function toRecordCount(items: Array<{ key: string }>) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.key] = (acc[item.key] || 0) + 1;
    return acc;
  }, {});
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const tenantId = params.get("tenantId");
  const limit = Math.min(300, Math.max(1, Number(params.get("limit") || 100)));

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
  const failedTotal = (byStatus.failed || 0) + (byStatus.dead_letter || 0);
  const externalFailedTotal = (externalByStatus.failed || 0) + (externalByStatus.dead_letter || 0);
  const channelNotConfigured = externalDeliveries.filter((item) => item.error_code === "CHANNEL_NOT_CONFIGURED").length;
  const providerErrors = toRecordCount(
    externalDeliveries
      .filter((item) => item.error_code && item.error_code !== "CHANNEL_POLICY_SKIPPED")
      .map((item) => ({ key: item.error_code || "UNKNOWN" })),
  );
  const retrying = deliveries.items.filter((item) => item.status === "retrying").slice(0, 100);

  return apiSuccess({
    tenantId: tenantId || null,
    summary: {
      jobRuns: jobRuns.items.length,
      deliveryRows: deliveries.items.length,
      failed: failedTotal,
      deadLetter: byStatus.dead_letter || 0,
      retrying: byStatus.retrying || 0,
      sent: byStatus.sent || 0,
      skipped: byStatus.skipped || 0,
      pending: byStatus.pending || 0,
      byStatus,
      byChannel,
      external: {
        total: externalDeliveries.length,
        sent: externalByStatus.sent || 0,
        failed: externalFailedTotal,
        deadLetter: externalByStatus.dead_letter || 0,
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
    failedDeliveries: deliveries.items.filter((item) => item.status === "failed" || item.status === "dead_letter").slice(0, 100),
    retryingDeliveries: retrying,
  });
}
