import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { getPlatformOverview } from "../../../../lib/platform-admin-overview";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;

  try {
    const data = await getPlatformOverview({
      preset: params.get("preset"),
      dateFrom: params.get("date_from") || params.get("dateFrom"),
      dateTo: params.get("date_to") || params.get("dateTo"),
      search: params.get("search"),
      tenantStatus: params.get("tenant_status") || params.get("tenantStatus"),
      page: params.get("page") ? Number(params.get("page")) : null,
      pageSize: params.get("page_size") ? Number(params.get("page_size")) : params.get("pageSize") ? Number(params.get("pageSize")) : null,
    });
    return apiSuccess(data);
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to load platform overview");
  }
}
