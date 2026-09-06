import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { recordSystemAuditEvent } from "../../../../../../lib/system-audit";
import {
  hashSupervisorSecret,
  isValidSupervisorSecret,
} from "../../../../../../lib/supervisor-biometric";
import {
  passkeyExpectedOrigins,
  passkeyRelyingPartyId,
} from "../../../../../../lib/student-checkin-passkeys";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    requestId?: string;
    token?: string;
    challengeId?: string;
    response?: AuthenticationResponseJSON;
  } | null;
  const requestId = body?.requestId?.trim() || "";
  const challengeId = body?.challengeId?.trim() || "";
  if (
    !/^[0-9a-f-]{36}$/i.test(requestId) ||
    !/^[0-9a-f-]{36}$/i.test(challengeId) ||
    !isValidSupervisorSecret(body?.token) ||
    !body?.response?.id
  ) {
    return NextResponse.json({ error: "生物辨識資料格式不正確。" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const loginResult = await admin
    .from("supervisor_biometric_login_requests")
    .select("id, profile_id, device_id, status, expires_at, approval_secret_hash")
    .eq("id", requestId)
    .eq("approval_secret_hash", hashSupervisorSecret(body.token))
    .maybeSingle();
  const login = loginResult.data;
  if (
    loginResult.error ||
    !login ||
    login.status !== "pending" ||
    new Date(login.expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "登入要求已失效，請回電腦重新操作。" }, { status: 409 });
  }

  const challengeResult = await admin
    .from("supervisor_biometric_challenges")
    .select("id, challenge, expires_at, used_at")
    .eq("id", challengeId)
    .eq("profile_id", login.profile_id)
    .eq("login_request_id", login.id)
    .eq("flow", "authentication")
    .is("used_at", null)
    .maybeSingle();
  if (
    challengeResult.error ||
    !challengeResult.data ||
    new Date(challengeResult.data.expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "生物辨識要求已失效，請重新操作。" }, { status: 409 });
  }
  const claimed = await admin
    .from("supervisor_biometric_challenges")
    .update({ used_at: new Date().toISOString() })
    .eq("id", challengeId)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (claimed.error || !claimed.data) {
    return NextResponse.json({ error: "生物辨識要求已使用，請重新操作。" }, { status: 409 });
  }

  const deviceResult = await admin
    .from("supervisor_biometric_devices")
    .select("id, credential_id, public_key, counter, transports")
    .eq("id", login.device_id)
    .eq("profile_id", login.profile_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (deviceResult.error || !deviceResult.data || deviceResult.data.credential_id !== body.response.id) {
    return NextResponse.json({ error: "這不是該主管綁定的手機。" }, { status: 401 });
  }
  const device = deviceResult.data;

  try {
    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challengeResult.data.challenge,
      expectedOrigin: passkeyExpectedOrigins(request),
      expectedRPID: passkeyRelyingPartyId(request),
      credential: {
        id: device.credential_id,
        publicKey: Uint8Array.from(Buffer.from(device.public_key, "base64url")),
        counter: Number(device.counter),
        transports: (device.transports || []) as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
      advancedFIDOConfig: { userVerification: "required" },
    });
    if (!verification.verified) throw new Error("not_verified");

    const approvedAt = new Date().toISOString();
    const approved = await admin
      .from("supervisor_biometric_login_requests")
      .update({ status: "approved", approved_at: approvedAt, updated_at: approvedAt })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (approved.error || !approved.data) {
      return NextResponse.json({ error: "登入要求已被處理，請回電腦確認。" }, { status: 409 });
    }
    await admin
      .from("supervisor_biometric_devices")
      .update({
        counter: verification.authenticationInfo.newCounter,
        device_type: verification.authenticationInfo.credentialDeviceType,
        backed_up: verification.authenticationInfo.credentialBackedUp,
        last_used_at: approvedAt,
      })
      .eq("id", device.id);
    const profileResult = await admin
      .from("profiles")
      .select("tenant_id, branch_id, role, employee_number")
      .eq("id", login.profile_id)
      .maybeSingle();
    await recordSystemAuditEvent({
      request,
      tenantId: profileResult.data?.tenant_id || null,
      branchId: profileResult.data?.branch_id || null,
      actorId: login.profile_id,
      actorRole: profileResult.data?.role || null,
      accountType: "staff",
      accountIdentifier: profileResult.data?.employee_number || null,
      eventCategory: "authentication",
      action: "auth.supervisor_login_approved",
      outcome: "success",
      reason: "device_user_verification_passed",
      targetType: "supervisor_biometric_login_request",
      targetId: requestId,
    });
    return NextResponse.json({ ok: true, approved: true });
  } catch (error) {
    console.warn("supervisor biometric approval failed", error);
    return NextResponse.json({ error: "生物辨識未通過，登入未核准。" }, { status: 401 });
  }
}
