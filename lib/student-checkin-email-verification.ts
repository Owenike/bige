import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { sendNotification } from "./integrations/notify";
import {
  studentCheckInEntryLabel,
  type StudentCheckInEntryMode,
} from "./student-checkin-entry";
import { appOrigin } from "./student-checkin";
import { createSupabaseAdminClient } from "./supabase/admin";

export const STUDENT_EMAIL_VERIFICATION_COOKIE = "bige_student_email_verification";
export const STUDENT_EMAIL_VERIFICATION_TTL_SECONDS = 30 * 60;
const STUDENT_PENDING_REGISTRATION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

export type StudentEmailVerificationRow = {
  id: string;
  profile_id: string;
  auth_user_id: string | null;
  full_name: string;
  phone: string;
  email: string;
  birth_date: string;
  password_hash: string;
  entry_mode: StudentCheckInEntryMode;
  verification_token_hash: string;
  status: "pending" | "verifying" | "completed" | "cancelled";
  expires_at: string;
  last_email_sent_at: string;
  email_send_count: number;
  verified_at: string | null;
  completed_at: string | null;
};

export const studentEmailVerificationSelect =
  "id, profile_id, auth_user_id, full_name, phone, email, birth_date, password_hash, entry_mode, verification_token_hash, status, expires_at, last_email_sent_at, email_send_count, verified_at, completed_at";

type PendingRegistrationCookie = {
  registrationId: string;
  issuedAt: number;
};

function readCookieSecret() {
  const secret =
    process.env.LINE_LOGIN_SESSION_SECRET ||
    process.env.LINE_LOGIN_CHANNEL_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing student email verification secret");
  return secret;
}

function signPayload(payload: string) {
  return crypto.createHmac("sha256", readCookieSecret()).update(payload).digest("base64url");
}

function createPendingCookie(registrationId: string) {
  const payload = Buffer.from(
    JSON.stringify({ registrationId, issuedAt: Date.now() } satisfies PendingRegistrationCookie),
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

function verifyPendingCookie(value: string | undefined | null) {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = signPayload(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PendingRegistrationCookie;
    if (!parsed.registrationId || typeof parsed.issuedAt !== "number") return null;
    if (Date.now() - parsed.issuedAt > STUDENT_PENDING_REGISTRATION_COOKIE_MAX_AGE_SECONDS * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createStudentEmailVerificationToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashStudentEmailVerificationToken(token) };
}

export function hashStudentEmailVerificationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function studentEmailVerificationExpiry() {
  return new Date(Date.now() + STUDENT_EMAIL_VERIFICATION_TTL_SECONDS * 1000).toISOString();
}

export function setPendingStudentRegistrationCookie(response: NextResponse, registrationId: string) {
  response.cookies.set(STUDENT_EMAIL_VERIFICATION_COOKIE, createPendingCookie(registrationId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STUDENT_PENDING_REGISTRATION_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearPendingStudentRegistrationCookie(response: NextResponse) {
  response.cookies.delete(STUDENT_EMAIL_VERIFICATION_COOKIE);
}

export async function readPendingStudentRegistrationId() {
  const cookieStore = await cookies();
  return verifyPendingCookie(cookieStore.get(STUDENT_EMAIL_VERIFICATION_COOKIE)?.value)?.registrationId || null;
}

export async function loadStudentEmailVerificationById(registrationId: string) {
  const result = await createSupabaseAdminClient()
    .from("student_checkin_email_verifications")
    .select(studentEmailVerificationSelect)
    .eq("id", registrationId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentEmailVerificationRow | null;
}

export async function cancelStudentEmailVerification(registrationId: string) {
  const admin = createSupabaseAdminClient();
  const current = await loadStudentEmailVerificationById(registrationId);
  if (!current || current.status === "completed" || current.status === "cancelled") return current;

  const now = new Date().toISOString();
  const updated = await admin
    .from("student_checkin_email_verifications")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", registrationId)
    .in("status", ["pending", "verifying"]);
  if (updated.error) throw new Error(updated.error.message);

  if (current.auth_user_id) {
    await admin.auth.admin.deleteUser(current.auth_user_id).catch(() => null);
  }
  return { ...current, status: "cancelled" as const };
}

export async function sendStudentEmailVerification(input: {
  request: Request;
  email: string;
  fullName: string;
  token: string;
  entryMode: StudentCheckInEntryMode;
}) {
  const verificationUrl = new URL("/check-in/verify", appOrigin(input.request));
  verificationUrl.searchParams.set("token", input.token);
  verificationUrl.searchParams.set("entry", input.entryMode);
  const entryLabel = studentCheckInEntryLabel(input.entryMode);

  const message = [
    `${input.fullName} 您好：`,
    "",
    `您正在建立 BIG E FITNESS ${entryLabel}報到資料。`,
    `請點擊下方連結驗證 Email；驗證完成後，系統會開啟${entryLabel}入口。`,
    "",
    verificationUrl.toString(),
    "",
    "此連結 30 分鐘內有效，且僅能完成一次驗證。",
    "若不是您本人提出申請，請忽略這封信。",
  ].join("\n");

  return sendNotification({
    channel: "email",
    target: input.email,
    templateKey: `【BIG E FITNESS】${entryLabel} Email 驗證`,
    message,
  });
}
