import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const STAFF_ROLES = ["manager", "supervisor", "branch_manager", "frontdesk", "coach", "sales"] as const;

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  const head = name.slice(0, 2);
  return `${head}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;

  const permission = requirePermission(auth.context, "staff.update");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const profileId = typeof body?.id === "string" ? body.id.trim() : "";
  if (!profileId) return apiError(400, "FORBIDDEN", "id is required");

  const tenantId = auth.context.role === "platform_admin"
    ? (typeof body?.tenantId === "string" ? body.tenantId.trim() : "")
    : auth.context.tenantId || "";
  if (!tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const targetResult = await auth.supabase
    .from("profiles")
    .select("id, role, branch_id, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("id", profileId)
    .in("role", [...STAFF_ROLES])
    .maybeSingle();
  if (targetResult.error) return apiError(500, "INTERNAL_ERROR", targetResult.error.message);
  if (!targetResult.data) return apiError(404, "FORBIDDEN", "staff not found");

  if (
    auth.context.role !== "platform_admin" &&
    auth.context.branchId &&
    String(targetResult.data.branch_id || "") !== auth.context.branchId
  ) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Cannot reset password outside your branch scope");
  }

  const admin = createSupabaseAdminClient();
  const userResult = await admin.auth.admin.getUserById(profileId);
  if (userResult.error || !userResult.data.user?.email) {
    return apiError(500, "INTERNAL_ERROR", userResult.error?.message || "User email not found");
  }

  const redirectTo = `${new URL(request.url).origin}/reset-password`;
  const linkResult = await admin.auth.admin.generateLink({
    type: "recovery",
    email: userResult.data.user.email,
    options: { redirectTo },
  });
  if (linkResult.error || !linkResult.data.properties?.action_link) {
    return apiError(500, "INTERNAL_ERROR", linkResult.error?.message || "Failed to create reset link");
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: auth.context.userId,
    action: "staff_password_reset_link_generated",
    target_type: "profile",
    target_id: profileId,
    reason: null,
    payload: {
      maskedEmail: maskEmail(userResult.data.user.email),
    },
  });

  return apiSuccess({
    id: profileId,
    maskedEmail: maskEmail(userResult.data.user.email),
    resetLink: linkResult.data.properties.action_link,
  });
}
