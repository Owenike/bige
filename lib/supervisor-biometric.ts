import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { AppRole } from "./auth-context";
import { normalizeEmployeeNumber } from "./staff-credentials";
import type { StaffPosition } from "./staff-organization";
import { createSupabaseAdminClient } from "./supabase/admin";

export const SUPERVISOR_LOGIN_REQUEST_TTL_MS = 2 * 60 * 1000;
export const SUPERVISOR_BINDING_TTL_MS = 15 * 60 * 1000;
export const SUPERVISOR_WEBAUTHN_CHALLENGE_TTL_MS = 2 * 60 * 1000;
export const SUPERVISOR_LOGIN_COOKIE = "bige_supervisor_login_request";

const SUPERVISOR_ROLES = new Set<AppRole>([
  "platform_admin",
  "manager",
  "supervisor",
  "branch_manager",
  "store_owner",
  "store_manager",
]);

const SUPERVISOR_POSITIONS = new Set<StaffPosition>([
  "administrative_director",
  "general_affairs_assistant_manager",
  "general_affairs_manager",
  "coach_team_lead",
  "coach_director",
  "coach_assistant_manager",
  "coach_manager",
  "coach_city_manager",
]);

export type SupervisorBiometricProfile = {
  id: string;
  role: string | null;
  position?: string | null;
  employee_number?: string | null;
  staff_activation_status?: string | null;
  supervisor_biometric_enforced_at?: string | null;
};

export function requiresSupervisorBiometric(
  profile: Pick<SupervisorBiometricProfile, "role" | "position">,
) {
  return (
    SUPERVISOR_ROLES.has(profile.role as AppRole) ||
    SUPERVISOR_POSITIONS.has(profile.position as StaffPosition)
  );
}

export function isSupervisorBiometricEnforced(profile: SupervisorBiometricProfile) {
  return (
    requiresSupervisorBiometric(profile) &&
    profile.staff_activation_status === "completed" &&
    Boolean(profile.supervisor_biometric_enforced_at)
  );
}

export function createSupervisorSecret() {
  return randomBytes(32).toString("base64url");
}

export function hashSupervisorSecret(secret: string) {
  return createHash("sha256").update(secret).digest("base64url");
}

export function isValidSupervisorSecret(secret: unknown): secret is string {
  return typeof secret === "string" && /^[A-Za-z0-9_-]{43}$/.test(secret);
}

export function secretsMatch(secret: string, expectedHash: string) {
  const actual = Buffer.from(hashSupervisorSecret(secret));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function supervisorRequestPlatform(request: Request) {
  const explicit = request.headers
    .get("sec-ch-ua-platform")
    ?.replace(/^"+|"+$/g, "")
    .trim();
  if (explicit) return explicit.slice(0, 80);
  const userAgent = request.headers.get("user-agent") || "";
  if (/iphone|ipad|ios/i.test(userAgent)) return "iOS";
  if (/android/i.test(userAgent)) return "Android";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/macintosh|mac os/i.test(userAgent)) return "macOS";
  return "未知裝置";
}

export function supervisorBrowserLabel(userAgent: string | null | undefined) {
  const value = userAgent || "";
  if (/edg\//i.test(value)) return "Microsoft Edge";
  if (/crios|chrome|chromium/i.test(value)) return "Google Chrome";
  if (/firefox|fxios/i.test(value)) return "Firefox";
  if (/safari/i.test(value)) return "Safari";
  return "網頁瀏覽器";
}

export function isSupervisorPhoneUserAgent(userAgent: string | null | undefined) {
  const value = userAgent || "";
  return /iphone/i.test(value) || (/android/i.test(value) && /mobile/i.test(value));
}

export function supervisorLoginCookieValue(requestId: string, secret: string) {
  return `${requestId}.${secret}`;
}

export function readSupervisorLoginCookie(request: NextRequest, requestId: string) {
  const value = request.cookies.get(SUPERVISOR_LOGIN_COOKIE)?.value || "";
  const separator = value.indexOf(".");
  if (separator < 1) return null;
  const cookieRequestId = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (cookieRequestId !== requestId || !isValidSupervisorSecret(secret)) return null;
  return secret;
}

export function attachSupervisorLoginCookie(
  response: NextResponse,
  requestId: string,
  secret: string,
) {
  response.cookies.set(
    SUPERVISOR_LOGIN_COOKIE,
    supervisorLoginCookieValue(requestId, secret),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/auth/supervisor-login",
      maxAge: Math.ceil(SUPERVISOR_LOGIN_REQUEST_TTL_MS / 1000),
    },
  );
}

export function clearSupervisorLoginCookie(response: NextResponse) {
  response.cookies.set(SUPERVISOR_LOGIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/supervisor-login",
    maxAge: 0,
  });
}

export function readJwtSessionId(accessToken: string | null | undefined) {
  if (!accessToken) return null;
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      session_id?: unknown;
    };
    return typeof payload.session_id === "string" && payload.session_id
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

export async function hasApprovedSupervisorSession(input: {
  profile: SupervisorBiometricProfile;
  authSessionId: string | null | undefined;
}) {
  if (!isSupervisorBiometricEnforced(input.profile)) return true;
  if (!input.authSessionId) return false;
  const result = await createSupabaseAdminClient()
    .from("supervisor_biometric_sessions")
    .select("id")
    .eq("profile_id", input.profile.id)
    .eq("auth_session_id", input.authSessionId)
    .is("revoked_at", null)
    .maybeSingle();
  return !result.error && Boolean(result.data);
}

export function normalizedSupervisorEmployeeNumber(value: unknown) {
  return normalizeEmployeeNumber(value);
}
