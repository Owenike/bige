import { NextResponse } from "next/server";
import { getClientIp } from "../../../../lib/observability";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

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

  if (user?.id) {
    const admin = createSupabaseAdminClient();
    const profileResult = await admin
      .from("profiles")
      .select("role, tenant_id")
      .eq("id", user.id)
      .maybeSingle();

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

        const revokeResult = await query;
        if (revokeResult.error && !tableMissing(revokeResult.error.message, "member_device_sessions")) {
          // no-op: logout should still complete
        }
      }
    }
  }

  await supabase.auth.signOut();
  return new NextResponse(null, { status: 204 });
}
