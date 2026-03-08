import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { requirePermission } from "../../../../lib/permissions";
import { runManagerConsistencyChecks } from "../../../../lib/consistency-checks";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Admin client init failed");
  }

  const report = await runManagerConsistencyChecks({
    supabase: admin,
    tenantId: auth.context.tenantId,
  });

  return apiSuccess({ report });
}
