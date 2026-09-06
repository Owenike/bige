import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import {
  hashSupervisorSecret,
  isValidSupervisorSecret,
  isSupervisorPhoneUserAgent,
} from "../../../../../../lib/supervisor-biometric";
import {
  passkeyExpectedOrigins,
  passkeyRelyingPartyId,
} from "../../../../../../lib/student-checkin-passkeys";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

type SubscriptionInput = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown } | null;
};

function validSubscription(value: SubscriptionInput | null | undefined) {
  const endpoint = typeof value?.endpoint === "string" ? value.endpoint.trim() : "";
  const p256dh = typeof value?.keys?.p256dh === "string" ? value.keys.p256dh.trim() : "";
  const auth = typeof value?.keys?.auth === "string" ? value.keys.auth.trim() : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 2048) return null;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

export async function POST(request: Request) {
  if (!isSupervisorPhoneUserAgent(request.headers.get("user-agent"))) {
    return NextResponse.json({ error: "主管生物辨識只能在已授權的手機完成綁定。" }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    challengeId?: string;
    response?: RegistrationResponseJSON;
    subscription?: SubscriptionInput;
  } | null;
  const challengeId = body?.challengeId?.trim() || "";
  const subscription = validSubscription(body?.subscription);
  if (
    !isValidSupervisorSecret(body?.token) ||
    !/^[0-9a-f-]{36}$/i.test(challengeId) ||
    !body?.response?.id ||
    !subscription
  ) {
    return NextResponse.json({ error: "手機綁定資料格式不正確。" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const bindingResult = await admin
    .from("supervisor_biometric_bindings")
    .select("id, profile_id, created_by, created_via, reason, expires_at, used_at, revoked_at")
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

  const challengeResult = await admin
    .from("supervisor_biometric_challenges")
    .select("id, challenge, expires_at")
    .eq("id", challengeId)
    .eq("binding_id", binding.id)
    .eq("profile_id", binding.profile_id)
    .eq("flow", "registration")
    .is("used_at", null)
    .maybeSingle();
  if (
    challengeResult.error ||
    !challengeResult.data ||
    new Date(challengeResult.data.expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "生物辨識要求已失效，請重新操作。" }, { status: 409 });
  }
  const challengeClaim = await admin
    .from("supervisor_biometric_challenges")
    .update({ used_at: new Date().toISOString() })
    .eq("id", challengeId)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (challengeClaim.error || !challengeClaim.data) {
    return NextResponse.json({ error: "生物辨識要求已使用，請重新操作。" }, { status: 409 });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challengeResult.data.challenge,
      expectedOrigin: passkeyExpectedOrigins(request),
      expectedRPID: passkeyRelyingPartyId(request),
      requireUserVerification: true,
    });
    if (!verification.verified) throw new Error("not_verified");

    const usedAt = new Date().toISOString();
    const bindingClaim = await admin
      .from("supervisor_biometric_bindings")
      .update({ used_at: usedAt })
      .eq("id", binding.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (bindingClaim.error || !bindingClaim.data) {
      return NextResponse.json({ error: "手機綁定連結已使用。" }, { status: 409 });
    }

    const previousResult = await admin
      .from("supervisor_biometric_devices")
      .select("id")
      .eq("profile_id", binding.profile_id)
      .is("revoked_at", null);
    if (previousResult.error) throw new Error(previousResult.error.message);
    const previousIds = (previousResult.data || []).map((row) => row.id);
    if (previousIds.length) {
      const revoked = await admin
        .from("supervisor_biometric_devices")
        .update({ revoked_at: usedAt, revoke_reason: "replaced_by_authorized_binding" })
        .in("id", previousIds)
        .is("revoked_at", null);
      if (revoked.error) throw new Error(revoked.error.message);
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const inserted = await admin
      .from("supervisor_biometric_devices")
      .insert({
        profile_id: binding.profile_id,
        credential_id: credential.id,
        public_key: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports || [],
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
        push_endpoint: subscription.endpoint,
        push_p256dh: subscription.p256dh,
        push_auth: subscription.auth,
        user_agent: request.headers.get("user-agent") || null,
        created_by: binding.created_by,
        created_at: usedAt,
      })
      .select("id")
      .single();
    if (inserted.error) {
      if (previousIds.length) {
        await admin
          .from("supervisor_biometric_devices")
          .update({ revoked_at: null, revoke_reason: null })
          .in("id", previousIds)
          .eq("revoked_at", usedAt);
      }
      await admin
        .from("supervisor_biometric_bindings")
        .update({ used_at: null })
        .eq("id", binding.id)
        .eq("used_at", usedAt);
      throw new Error(inserted.error.message);
    }

    await Promise.all([
      admin
        .from("profiles")
        .update({ supervisor_biometric_enforced_at: usedAt, updated_at: usedAt })
        .eq("id", binding.profile_id),
      admin
        .from("supervisor_biometric_sessions")
        .update({ revoked_at: usedAt, revoke_reason: "device_replaced" })
        .eq("profile_id", binding.profile_id)
        .is("revoked_at", null),
      admin
        .from("supervisor_biometric_login_requests")
        .update({ status: "expired", updated_at: usedAt })
        .eq("profile_id", binding.profile_id)
        .in("status", ["pending", "approved", "consuming"]),
    ]);
    const profileResult = await admin
      .from("profiles")
      .select("tenant_id, employee_number")
      .eq("id", binding.profile_id)
      .maybeSingle();
    await admin.from("audit_logs").insert({
      tenant_id: profileResult.data?.tenant_id || null,
      actor_id: binding.created_by,
      action: "supervisor_biometric_device_bound",
      target_type: "profile",
      target_id: binding.profile_id,
      reason: binding.reason,
      payload: {
        employeeNumber: profileResult.data?.employee_number || null,
        deviceId: inserted.data.id,
        createdVia: binding.created_via,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      },
    });
    return NextResponse.json({ ok: true, bound: true });
  } catch (error) {
    console.error("supervisor biometric device registration failed", error);
    return NextResponse.json({ error: "手機生物辨識綁定失敗，請重新操作。" }, { status: 400 });
  }
}
