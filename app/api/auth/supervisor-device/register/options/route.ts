import { generateRegistrationOptions, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { rateLimitShared } from "../../../../../../lib/rate-limit";
import {
  SUPERVISOR_WEBAUTHN_CHALLENGE_TTL_MS,
  hashSupervisorSecret,
  isValidSupervisorSecret,
  isSupervisorPhoneUserAgent,
  requiresSupervisorBiometric,
} from "../../../../../../lib/supervisor-biometric";
import { passkeyRelyingPartyId } from "../../../../../../lib/student-checkin-passkeys";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";
import { supervisorWebPushPublicKey } from "../../../../../../lib/supervisor-web-push";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await rateLimitShared({ key: `supervisor-device-bind:${ip}`, limit: 10, windowMs: 10 * 60 * 1000 });
  if (!limited.ok) return NextResponse.json({ error: "操作過於頻繁，請稍後再試。" }, { status: 429 });
  if (!isSupervisorPhoneUserAgent(request.headers.get("user-agent"))) {
    return NextResponse.json({ error: "主管生物辨識只能綁定在手機，不能綁定電腦或平板。" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (!isValidSupervisorSecret(body?.token)) {
    return NextResponse.json({ error: "手機綁定連結格式不正確。" }, { status: 400 });
  }
  const publicKey = supervisorWebPushPublicKey();
  if (!publicKey) return NextResponse.json({ error: "手機通知尚未完成設定。" }, { status: 503 });

  const admin = createSupabaseAdminClient();
  const bindingResult = await admin
    .from("supervisor_biometric_bindings")
    .select("id, profile_id, created_by, expires_at, used_at, revoked_at")
    .eq("token_hash", hashSupervisorSecret(body.token))
    .maybeSingle();
  const binding = bindingResult.data;
  if (
    bindingResult.error ||
    !binding ||
    binding.used_at ||
    binding.revoked_at ||
    new Date(binding.expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "手機綁定連結已失效，請 01 重新產生。" }, { status: 410 });
  }
  const profileResult = await admin
    .from("profiles")
    .select("id, role, position, employee_number, display_name, english_name, is_active, staff_deleted_at, staff_activation_status")
    .eq("id", binding.profile_id)
    .maybeSingle();
  const profile = profileResult.data;
  if (
    profileResult.error ||
    !profile ||
    profile.is_active !== true ||
    profile.staff_deleted_at ||
    profile.staff_activation_status !== "completed" ||
    !requiresSupervisorBiometric(profile)
  ) {
    return NextResponse.json({ error: "此主管帳號目前不能綁定手機。" }, { status: 409 });
  }
  const existingResult = await admin
    .from("supervisor_biometric_devices")
    .select("credential_id, transports")
    .eq("profile_id", profile.id)
    .is("revoked_at", null);
  if (existingResult.error) return NextResponse.json({ error: "讀取原手機資料失敗。" }, { status: 500 });
  const options = await generateRegistrationOptions({
    rpName: "BIG E 主管驗證",
    rpID: passkeyRelyingPartyId(request),
    userID: new TextEncoder().encode(profile.id),
    userName: profile.employee_number || profile.id,
    userDisplayName: profile.display_name || profile.english_name || profile.employee_number || "BIG E 主管",
    attestationType: "none",
    timeout: 60_000,
    excludeCredentials: (existingResult.data || []).map((credential) => ({
      id: credential.credential_id,
      transports: (credential.transports || []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
    preferredAuthenticatorType: "localDevice",
  });
  const challengeResult = await admin
    .from("supervisor_biometric_challenges")
    .insert({
      profile_id: profile.id,
      binding_id: binding.id,
      flow: "registration",
      challenge: options.challenge,
      expires_at: new Date(Date.now() + SUPERVISOR_WEBAUTHN_CHALLENGE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (challengeResult.error) return NextResponse.json({ error: "建立生物辨識要求失敗。" }, { status: 500 });
  return NextResponse.json({
    ok: true,
    options,
    challengeId: challengeResult.data.id,
    vapidPublicKey: publicKey,
    profile: {
      employeeNumber: profile.employee_number,
      displayName: profile.display_name || profile.english_name || null,
    },
  });
}
