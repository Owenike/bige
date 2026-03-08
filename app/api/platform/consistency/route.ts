import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { runPlatformConsistencyChecks } from "../../../../lib/consistency-checks";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Admin client init failed");
  }

  const tenantId = new URL(request.url).searchParams.get("tenantId");
  const report = await runPlatformConsistencyChecks({
    supabase: admin,
    tenantId: tenantId || null,
  });

  return apiSuccess({ report });
}
