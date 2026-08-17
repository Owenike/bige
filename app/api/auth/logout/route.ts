import { NextResponse } from "next/server";
import { getClientIp } from "../../../../lib/observability";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { recordSystemAuditEvent } from "../../../../lib/system-audit";

function tableMissing(message: string | undefined, tableName: string) {
  const text = (message || "").toLowerCase();
  return text.includes(`relation "${tableName.toLowerCase()}" does not exist`) || text.includes(`relation '${tableName.toLowerCase()}' does not exist`);
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient(request);
  const authResult = await supabase.auth.getUser();
  const user = authResult.data.user;
  const ip = getClientIp(request) || null;
  const userAgent = request.headers.get("user-agent") || null;
  let tenantId: string | null = null;
  let branchId: string | null = null;
  let actorRole: string | null = null;
  let revokedMemberDeviceCount = 0;
  let memberDeviceRevokeError: string | null = null;

  if (user?.id) {
    const admin = createSupabaseAdminClient();
    const profileResult = await admin
      .from("profiles")
      .select("role, tenant_id, branch_id")
      .eq("id", user.id)
      .maybeSingle();
    tenantId = profileResult.data?.tenant_id || null;
    branchId = profileResult.data?.branch_id || null;
    actorRole = profileResult.data?.role || null;

    if (!profileResult.error && profileResult.data?.role === "member" && profileResult.data.tenant_id) {
      const memberResult = await admin
        .from("members")
        .select("id")
        .eq("tenant_id", profileResult.data.tenant_id)
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (!memberResult.error && memberResult.data?.id) {
        const now = new Date().toISOString();
        let query = admin
          .from("member_device_sessions")
          .update({ revoked_at: now, updated_at: now })
          .eq("tenant_id", profileResult.data.tenant_id)
          .eq("member_id", memberResult.data.id)
          .is("revoked_at", null);

        if (userAgent) query = query.eq("user_agent", userAgent);
        if (ip) query = query.eq("ip_address", ip);

        const revokeResult = await query.select("id");
        revokedMemberDeviceCount = revokeResult.data?.length || 0;
        if (revokeResult.error && !tableMissing(revokeResult.error.message, "member_device_sessions")) {
          memberDeviceRevokeError = revokeResult.error.message;
        }
      }
    }
  }

  const signOutResult = await supabase.auth.signOut();
  await recordSystemAuditEvent({
    request,
    tenantId,
    branchId,
    actorId: user?.id || null,
    actorRole,
    accountType: actorRole === "member" ? "member" : user?.id ? "staff" : "unknown",
    accountIdentifier: user?.email || null,
    eventCategory: "authentication",
    action: "auth.logout",
    outcome: signOutResult.error ? "failure" : "success",
    targetType: user?.id ? "auth_user" : null,
    targetId: user?.id || null,
    reason: signOutResult.error
      ? "supabase_signout_failed"
      : user?.id
        ? "user_requested_logout"
        : "no_authenticated_user",
    metadata: {
      memberDeviceSessionsRevoked: revokedMemberDeviceCount,
      memberDeviceRevokeError,
      signOutError: signOutResult.error?.message || null,
    },
  });
  return new NextResponse(null, { status: 204 });
}
