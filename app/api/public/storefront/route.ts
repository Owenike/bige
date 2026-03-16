import { apiError, apiSuccess } from "../../../../lib/auth-context";
import { resolveStorefrontPayload } from "../../../../lib/storefront";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

type BranchLookupRow = {
  id: string;
  tenant_id: string;
  code: string | null;
  is_active: boolean;
};

export async function GET(request: Request) {
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Admin client initialization failed");
  }

  const params = new URL(request.url).searchParams;
  const branchId = params.get("branchId");
  const branchCode = params.get("branchCode");

  let branchQuery = admin
    .from("branches")
    .select("id, tenant_id, code, is_active")
    .eq("is_active", true)
    .limit(1);

  if (branchId) branchQuery = branchQuery.eq("id", branchId);
  if (branchCode) branchQuery = branchQuery.eq("code", branchCode);
  if (!branchId && !branchCode) branchQuery = branchQuery.order("created_at", { ascending: true });

  const branchResult = await branchQuery.maybeSingle();
  if (branchResult.error) return apiError(500, "INTERNAL_ERROR", branchResult.error.message);

  const branch = branchResult.data as BranchLookupRow | null;
  if (!branch) return apiError(404, "FORBIDDEN", "Storefront branch not found");

  const storefront = await resolveStorefrontPayload({
    supabase: admin,
    tenantId: branch.tenant_id,
    branchId: branch.id,
  });

  if (!storefront.ok) return apiError(500, "INTERNAL_ERROR", storefront.error);

  return apiSuccess(storefront.data);
}
