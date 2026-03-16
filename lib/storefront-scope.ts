import { apiError } from "./auth-context";

export function isBranchScopedRole(role: string) {
  return role === "branch_manager" || role === "store_manager" || role === "frontdesk";
}

export async function resolveScopedBranchId(params: {
  requestedBranchId: string | null;
  tenantId: string;
  auth: {
    context: {
      role: string;
      branchId: string | null;
    };
    supabase: {
      from: (...args: unknown[]) => any;
    };
  };
}) {
  if (isBranchScopedRole(params.auth.context.role) && params.auth.context.branchId) {
    if (params.requestedBranchId && params.requestedBranchId !== params.auth.context.branchId) {
      return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "Branch scope mismatch") };
    }
    return { ok: true as const, branchId: params.auth.context.branchId };
  }

  if (!params.requestedBranchId) {
    return { ok: true as const, branchId: null };
  }

  const branchResult = await params.auth.supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.requestedBranchId)
    .maybeSingle();

  if (branchResult.error) return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", branchResult.error.message) };
  if (!branchResult.data) return { ok: false as const, response: apiError(404, "BRANCH_SCOPE_DENIED", "Branch not found in tenant scope") };

  return { ok: true as const, branchId: params.requestedBranchId };
}
