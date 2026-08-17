import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "./supabase/admin";
import type { StudentProfileRow } from "./student-checkin";

const PASSKEY_CHALLENGE_COOKIE = "bige_student_passkey_challenge";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type PasskeyFlow = "registration" | "authentication";

type PasskeyRow = {
  id: string;
  profile_id: string;
  credential_id: string;
  public_key: string;
  counter: number | string;
  transports: string[] | null;
  device_type: string | null;
  backed_up: boolean;
  revoked_at: string | null;
};

type ChallengeRow = {
  id: string;
  profile_id: string | null;
  flow: PasskeyFlow;
  challenge: string;
  expires_at: string;
  used_at: string | null;
};

function requestHost(request: Request) {
  return new URL(request.url).hostname.toLowerCase();
}

export function passkeyRelyingPartyId(request: Request) {
  const configured = process.env.WEBAUTHN_RP_ID?.trim();
  if (configured) return configured;
  const host = requestHost(request);
  if (host === "bigefitness.com" || host.endsWith(".bigefitness.com")) return "bigefitness.com";
  return host;
}

export function passkeyExpectedOrigins(request: Request) {
  const configured = process.env.WEBAUTHN_ORIGINS?.split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (configured?.length) return configured;
  const host = requestHost(request);
  if (host === "bigefitness.com" || host.endsWith(".bigefitness.com")) {
    return ["https://bigefitness.com", "https://www.bigefitness.com"];
  }
  return [new URL(request.url).origin];
}

function setChallengeCookie(response: NextResponse, challengeId: string) {
  response.cookies.set(PASSKEY_CHALLENGE_COOKIE, challengeId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/student-checkin/passkey",
    maxAge: Math.ceil(CHALLENGE_TTL_MS / 1000),
  });
}

export function clearPasskeyChallengeCookie(response: NextResponse) {
  response.cookies.set(PASSKEY_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/student-checkin/passkey",
    maxAge: 0,
  });
}

async function saveChallenge(input: {
  profileId?: string;
  flow: PasskeyFlow;
  challenge: string;
}) {
  const result = await createSupabaseAdminClient()
    .from("student_checkin_passkey_challenges")
    .insert({
      profile_id: input.profileId || null,
      flow: input.flow,
      challenge: input.challenge,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (result.error) throw new Error(result.error.message);
  return String(result.data.id);
}

async function claimChallenge(request: NextRequest, flow: PasskeyFlow, profileId?: string) {
  const challengeId = request.cookies.get(PASSKEY_CHALLENGE_COOKIE)?.value;
  if (!challengeId) return null;
  const admin = createSupabaseAdminClient();
  const loaded = await admin
    .from("student_checkin_passkey_challenges")
    .select("id, profile_id, flow, challenge, expires_at, used_at")
    .eq("id", challengeId)
    .eq("flow", flow)
    .is("used_at", null)
    .maybeSingle();
  if (loaded.error) throw new Error(loaded.error.message);
  const row = (loaded.data || null) as ChallengeRow | null;
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (profileId && row.profile_id !== profileId) return null;

  const claimedAt = new Date().toISOString();
  const claimed = await admin
    .from("student_checkin_passkey_challenges")
    .update({ used_at: claimedAt })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return null;
  return row;
}

async function activePasskeysForProfile(profileId: string) {
  const result = await createSupabaseAdminClient()
    .from("student_checkin_passkeys")
    .select("id, profile_id, credential_id, public_key, counter, transports, device_type, backed_up, revoked_at")
    .eq("profile_id", profileId)
    .is("revoked_at", null);
  if (result.error) throw new Error(result.error.message);
  return (result.data || []) as PasskeyRow[];
}

export async function createPasskeyRegistrationOptions(
  request: Request,
  profile: StudentProfileRow,
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }> {
  const existing = await activePasskeysForProfile(profile.id);
  const options = await generateRegistrationOptions({
    rpName: "BigE Fitness",
    rpID: passkeyRelyingPartyId(request),
    userID: new TextEncoder().encode(profile.id),
    userName: profile.phone,
    userDisplayName: profile.full_name || profile.phone,
    attestationType: "none",
    timeout: 60_000,
    excludeCredentials: existing.map((credential) => ({
      id: credential.credential_id,
      transports: (credential.transports || []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    preferredAuthenticatorType: "localDevice",
  });
  const challengeId = await saveChallenge({
    profileId: profile.id,
    flow: "registration",
    challenge: options.challenge,
  });
  return { options, challengeId };
}

export async function verifyAndSavePasskeyRegistration(input: {
  request: NextRequest;
  profile: StudentProfileRow;
  response: RegistrationResponseJSON;
}) {
  const challenge = await claimChallenge(input.request, "registration", input.profile.id);
  if (!challenge) return { verified: false as const, reason: "challenge_invalid" as const };

  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: passkeyExpectedOrigins(input.request),
    expectedRPID: passkeyRelyingPartyId(input.request),
    requireUserVerification: true,
  });
  if (!verification.verified) return { verified: false as const, reason: "verification_failed" as const };

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const result = await createSupabaseAdminClient()
    .from("student_checkin_passkeys")
    .insert({
      profile_id: input.profile.id,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports || [],
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      revoked_at: null,
    })
    .select("id")
    .single();
  if (result.error) throw new Error(result.error.message);
  return { verified: true as const };
}

export async function createPasskeyAuthenticationOptions(
  request: Request,
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }> {
  const options = await generateAuthenticationOptions({
    rpID: passkeyRelyingPartyId(request),
    timeout: 60_000,
    userVerification: "required",
  });
  const challengeId = await saveChallenge({ flow: "authentication", challenge: options.challenge });
  return { options, challengeId };
}

export async function verifyPasskeyAuthentication(input: {
  request: NextRequest;
  response: AuthenticationResponseJSON;
}) {
  const challenge = await claimChallenge(input.request, "authentication");
  if (!challenge) return { verified: false as const, reason: "challenge_invalid" as const };

  const admin = createSupabaseAdminClient();
  const loaded = await admin
    .from("student_checkin_passkeys")
    .select("id, profile_id, credential_id, public_key, counter, transports, device_type, backed_up, revoked_at")
    .eq("credential_id", input.response.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (loaded.error) throw new Error(loaded.error.message);
  const passkey = (loaded.data || null) as PasskeyRow | null;
  if (!passkey) return { verified: false as const, reason: "credential_not_found" as const };

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: passkeyExpectedOrigins(input.request),
    expectedRPID: passkeyRelyingPartyId(input.request),
    credential: {
      id: passkey.credential_id,
      publicKey: Uint8Array.from(Buffer.from(passkey.public_key, "base64url")),
      counter: Number(passkey.counter),
      transports: (passkey.transports || []) as AuthenticatorTransportFuture[],
    },
    requireUserVerification: true,
    advancedFIDOConfig: { userVerification: "required" },
  });
  if (!verification.verified) return { verified: false as const, reason: "verification_failed" as const };

  const updated = await admin
    .from("student_checkin_passkeys")
    .update({
      counter: verification.authenticationInfo.newCounter,
      device_type: verification.authenticationInfo.credentialDeviceType,
      backed_up: verification.authenticationInfo.credentialBackedUp,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", passkey.id);
  if (updated.error) throw new Error(updated.error.message);
  return { verified: true as const, profileId: passkey.profile_id };
}

export function attachPasskeyChallengeCookie(response: NextResponse, challengeId: string) {
  setChallengeCookie(response, challengeId);
}
