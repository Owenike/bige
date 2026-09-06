import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { rateLimitShared } from "../../../../../../lib/rate-limit";
import {
  SUPERVISOR_WEBAUTHN_CHALLENGE_TTL_MS,
  hashSupervisorSecret,
  isValidSupervisorSecret,
  supervisorBrowserLabel,
} from "../../../../../../lib/supervisor-biometric";
import {
  passkeyRelyingPartyId,
} from "../../../../../../lib/student-checkin-passkeys";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await rateLimitShared({
    key: `supervisor-login-approval:${ip}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json({ error: "操作過於頻繁，請稍後再試。" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  const token = body?.token;
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !isValidSupervisorSecret(token)) {
    return NextResponse.json({ error: "登入核准連結格式不正確。" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const loginResult = await admin
    .from("supervisor_biometric_login_requests")
    .select("id, profile_id, device_id, status, expires_at, requested_platform, requested_user_agent, approval_secret_hash")
    .eq("id", requestId)
    .eq("approval_secret_hash", hashSupervisorSecret(token))
    .maybeSingle();
  const login = loginResult.data;
  if (loginResult.error || !login) {
    return NextResponse.json({ error: "登入核准連結無效。" }, { status: 401 });
  }
  if (login.status !== "pending" || new Date(login.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "登入要求已失效，請回電腦重新操作。" }, { status: 409 });
  }

  const [deviceResult, profileResult] = await Promise.all([
    admin
      .from("supervisor_biometric_devices")
      .select("id, credential_id, transports")
      .eq("id", login.device_id)
      .eq("profile_id", login.profile_id)
      .is("revoked_at", null)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("employee_number, display_name, english_name")
      .eq("id", login.profile_id)
      .maybeSingle(),
  ]);
  if (deviceResult.error || !deviceResult.data || profileResult.error || !profileResult.data) {
    return NextResponse.json({ error: "綁定的主管手機已失效，請聯絡 01。" }, { status: 409 });
  }

  const options = await generateAuthenticationOptions({
    rpID: passkeyRelyingPartyId(request),
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: [
      {
        id: deviceResult.data.credential_id,
        transports: deviceResult.data.transports || [],
      },
    ],
  });
  const challengeResult = await admin
    .from("supervisor_biometric_challenges")
    .insert({
      profile_id: login.profile_id,
      login_request_id: login.id,
      flow: "authentication",
      challenge: options.challenge,
      expires_at: new Date(Date.now() + SUPERVISOR_WEBAUTHN_CHALLENGE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (challengeResult.error) {
    return NextResponse.json({ error: "目前無法啟動生物辨識，請稍後再試。" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    options,
    challengeId: challengeResult.data.id,
    request: {
      employeeNumber: profileResult.data.employee_number,
      displayName: profileResult.data.display_name || profileResult.data.english_name || null,
      platform: login.requested_platform || "未知裝置",
      browser: supervisorBrowserLabel(login.requested_user_agent),
      expiresAt: login.expires_at,
    },
  });
}
