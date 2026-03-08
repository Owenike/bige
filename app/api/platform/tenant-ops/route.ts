import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { getPlatformTenantOpsDetail, getPlatformTenantOpsOverview } from "../../../../lib/platform-tenant-ops";

function parseRangeDays(value: string | null) {
  const parsed = Number(value || 14);
  if (!Number.isFinite(parsed)) return 14;
  return Math.min(90, Math.max(1, Math.floor(parsed)));
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const tenantId = params.get("tenantId");
  const rangeDays = parseRangeDays(params.get("days"));

  if (tenantId) {
    const detail = await getPlatformTenantOpsDetail({
      tenantId,
      rangeDays,
    });
    if (!detail.ok) {
      if (detail.error === "Tenant not found") {
        return apiError(404, "FORBIDDEN", detail.error);
      }
      return apiError(500, "INTERNAL_ERROR", detail.error);
    }
    return apiSuccess(detail.data);
  }

  const overview = await getPlatformTenantOpsOverview({
    rangeDays,
  });
  if (!overview.ok) return apiError(500, "INTERNAL_ERROR", overview.error);
  return apiSuccess(overview.data);
}
