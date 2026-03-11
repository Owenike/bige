import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { requirePermission } from "../../../../../../lib/permissions";
import { getPlatformJobRunDetail } from "../../../../../../lib/platform-jobs-monitor";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const { id } = await context.params;
  const detail = await getPlatformJobRunDetail({ id });
  if (!detail.ok && detail.code === "invalid_id") return apiError(400, "FORBIDDEN", detail.error);
  if (!detail.ok && detail.code === "not_found") return apiError(404, "FORBIDDEN", detail.error);
  if (!detail.ok) return apiError(500, "INTERNAL_ERROR", detail.error);

  return apiSuccess(detail.data);
}

