import { NextRequest, NextResponse } from "next/server";
import { recordSystemAuditEvent } from "../../../../../lib/system-audit";
import {
  clearSupervisorLoginCookie,
  hashSupervisorSecret,
  readJwtSessionId,
  readSupervisorLoginCookie,
} from "../../../../../lib/supervisor-biometric";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

function terminalResponse(status: "denied" | "expired" | "delivery_failed") {
  const message =
    status === "denied"
      ? "手機已拒絕這次登入。"
      : status === "delivery_failed"
        ? "手機通知傳送失敗，請重新操作。"
        : "登入要求已逾時，請重新操作。";
  const response = NextResponse.json({ ok: false, status, error: message }, { status: 409 });
  clearSupervisorLoginCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get("requestId")?.trim() || "";
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return NextResponse.json({ error: "登入要求格式不正確。" }, { status: 400 });
  }
  const browserSecret = readSupervisorLoginCookie(request, requestId);
  if (!browserSecret) {
    return NextResponse.json({ error: "這次登入要求不屬於目前的瀏覽器。" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const loaded = await admin
    .from("supervisor_biometric_login_requests")
    .select("id, profile_id, device_id, browser_secret_hash, status, expires_at, requested_user_agent, requested_ip")
    .eq("id", requestId)
    .maybeSingle();
  if (loaded.error || !loaded.data) {
    return NextResponse.json({ error: "找不到這次登入要求。" }, { status: 404 });
  }
  const row = loaded.data;
  if (row.browser_secret_hash !== hashSupervisorSecret(browserSecret)) {
    return NextResponse.json({ error: "這次登入要求不屬於目前的瀏覽器。" }, { status: 401 });
  }

  if (new Date(row.expires_at).getTime() <= Date.now() && ["pending", "approved", "consuming"].includes(row.status)) {
    await admin
      .from("supervisor_biometric_login_requests")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .in("status", ["pending", "approved", "consuming"]);
    return terminalResponse("expired");
  }
  if (row.status === "denied" || row.status === "expired" || row.status === "delivery_failed") {
    return terminalResponse(row.status);
  }
  if (row.status === "pending" || row.status === "consuming") {
    return NextResponse.json({ ok: true, status: "pending" });
  }
  if (row.status === "consumed") {
    return NextResponse.json({ ok: true, status: "consumed" });
  }

  const claimedAt = new Date().toISOString();
  const claimed = await admin
    .from("supervisor_biometric_login_requests")
    .update({ status: "consuming", updated_at: claimedAt })
    .eq("id", requestId)
    .eq("status", "approved")
    .select("id")
    .maybeSingle();
  if (claimed.error) {
    return NextResponse.json({ error: "建立登入狀態失敗，請稍後再試。" }, { status: 500 });
  }
  if (!claimed.data) {
    return NextResponse.json({ ok: true, status: "pending" });
  }

  const [profileResult, userResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id, tenant_id, branch_id, role, employee_number, is_active, staff_deleted_at, staff_activation_status, supervisor_biometric_enforced_at")
      .eq("id", row.profile_id)
      .maybeSingle(),
    admin.auth.admin.getUserById(row.profile_id),
  ]);
  const profile = profileResult.data;
  const email = userResult.data.user?.email?.trim().toLowerCase() || "";
  if (
    profileResult.error ||
    !profile ||
    profile.is_active !== true ||
    profile.staff_deleted_at ||
    profile.staff_activation_status !== "completed" ||
    !profile.supervisor_biometric_enforced_at ||
    userResult.error ||
    !email
  ) {
    await admin
      .from("supervisor_biometric_login_requests")
      .update({ status: "denied", denied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "consuming");
    return terminalResponse("denied");
  }

  const linkResult = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashedToken = linkResult.data.properties?.hashed_token;
  if (linkResult.error || !hashedToken) {
    await admin
      .from("supervisor_biometric_login_requests")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "consuming");
    return NextResponse.json({ error: "建立登入狀態失敗，請重新操作。" }, { status: 500 });
  }

  const supabase = await createSupabaseServerClient(request);
  const signedIn = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: "magiclink" });
  const authSessionId = readJwtSessionId(signedIn.data.session?.access_token);
  if (signedIn.error || !signedIn.data.user || !authSessionId) {
    await admin
      .from("supervisor_biometric_login_requests")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "consuming");
    return NextResponse.json({ error: "建立登入狀態失敗，請重新操作。" }, { status: 500 });
  }

  const sessionInsert = await admin.from("supervisor_biometric_sessions").insert({
    profile_id: profile.id,
    auth_session_id: authSessionId,
    login_request_id: requestId,
    device_id: row.device_id,
    created_at: claimedAt,
    last_seen_at: claimedAt,
  });
  if (sessionInsert.error) {
    await supabase.auth.signOut().catch(() => null);
    await admin
      .from("supervisor_biometric_login_requests")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "consuming");
    return NextResponse.json({ error: "安全登入狀態建立失敗，請重新操作。" }, { status: 500 });
  }

  const consumedAt = new Date().toISOString();
  await Promise.all([
    admin
      .from("supervisor_biometric_login_requests")
      .update({ status: "consumed", consumed_at: consumedAt, updated_at: consumedAt })
      .eq("id", requestId)
      .eq("status", "consuming"),
    admin.from("profiles").update({ last_login_at: consumedAt, updated_at: consumedAt }).eq("id", profile.id),
    profile.tenant_id
      ? admin.from("staff_login_events").insert({
          tenant_id: profile.tenant_id,
          profile_id: profile.id,
          employee_number: profile.employee_number,
          event_type: "login",
          user_agent: row.requested_user_agent,
          ip_address: row.requested_ip,
          created_at: consumedAt,
        })
      : Promise.resolve({ error: null }),
  ]);
  await recordSystemAuditEvent({
    request,
    tenantId: profile.tenant_id,
    branchId: profile.branch_id,
    actorId: profile.id,
    actorRole: profile.role,
    accountType: "staff",
    accountIdentifier: profile.employee_number,
    eventCategory: "authentication",
    action: "auth.supervisor_login",
    outcome: "success",
    reason: "bound_device_biometric_approved",
    targetType: "supervisor_biometric_session",
    targetId: authSessionId,
  });

  const response = NextResponse.json({ ok: true, status: "consumed", authenticated: true });
  clearSupervisorLoginCookie(response);
  return response;
}
