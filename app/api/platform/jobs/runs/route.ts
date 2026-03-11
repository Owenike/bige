import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import { listPlatformJobRuns, parsePlatformJobRunsQuery } from "../../../../../lib/platform-jobs-monitor";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const parsed = parsePlatformJobRunsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);

  const listed = await listPlatformJobRuns(parsed.query);
  if (!listed.ok) return apiError(500, "INTERNAL_ERROR", listed.error);

  return apiSuccess({
    query: parsed.query,
    ...listed.data,
  });
}

