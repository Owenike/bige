import crypto from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "./supabase/admin";

export const STUDENT_LINE_SESSION_COOKIE = "bige_student_line_session";
export const STUDENT_LINE_STATE_COOKIE = "bige_student_line_state";
export const STUDENT_AUTH_SESSION_COOKIE = "bige_student_auth_session";
export const STUDENT_PHOTO_BUCKET = "student-checkin-photos";

const STUDENT_SESSION_MAX_AGE_SECONDS = 30 * 60;
const scryptAsync = promisify(crypto.scrypt);

type StudentLineSession = {
  lineUserId: string;
  lineDisplayName: string | null;
  issuedAt: number;
};

export type StudentAuthMethod = "line" | "phone";

type StudentAuthSession = {
  profileId: string;
  authMethod: StudentAuthMethod;
  issuedAt: number;
};

export type StudentProfileRow = {
  id: string;
  line_user_id: string | null;
  line_display_name: string | null;
  full_name: string;
  phone: string;
  birth_date: string | null;
  password_hash: string | null;
  photo_path: string | null;
  is_active: boolean;
  bound_at: string;
  last_checkin_at: string | null;
};

export type StudentCheckinRequestRow = {
  id: string;
  student_profile_id: string;
  status: "pending" | "approved" | "rejected";
  auth_method: StudentAuthMethod;
  requested_at: string;
  reviewed_at: string | null;
};

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function readSessionSecret() {
  const secret = process.env.LINE_LOGIN_SESSION_SECRET || process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing student session secret");
  return secret;
}

function signPayload(payload: string) {
  return crypto.createHmac("sha256", readSessionSecret()).update(payload).digest("base64url");
}

function createSignedCookie<T extends object>(data: T) {
  const payload = base64url(JSON.stringify(data));
  return `${payload}.${signPayload(payload)}`;
}

function verifySignedCookie<T extends { issuedAt: number }>(value: string | undefined | null): T | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = signPayload(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
    if (typeof parsed.issuedAt !== "number") return null;
    if (Date.now() - parsed.issuedAt > STUDENT_SESSION_MAX_AGE_SECONDS * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createStudentLineSessionCookie(input: { lineUserId: string; lineDisplayName?: string | null }) {
  return createSignedCookie<StudentLineSession>({
    lineUserId: input.lineUserId,
    lineDisplayName: input.lineDisplayName || null,
    issuedAt: Date.now(),
  });
}

export function verifyStudentLineSessionCookie(value: string | undefined | null) {
  const session = verifySignedCookie<StudentLineSession>(value);
  return session?.lineUserId ? session : null;
}

export async function readStudentLineSession() {
  const cookieStore = await cookies();
  return verifyStudentLineSessionCookie(cookieStore.get(STUDENT_LINE_SESSION_COOKIE)?.value);
}

export function setStudentLineSession(response: NextResponse, sessionValue: string) {
  response.cookies.set(STUDENT_LINE_SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STUDENT_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearStudentLineSession(response: NextResponse) {
  response.cookies.delete(STUDENT_LINE_SESSION_COOKIE);
}

export function createStudentAuthSessionCookie(profileId: string, authMethod: StudentAuthMethod) {
  return createSignedCookie<StudentAuthSession>({ profileId, authMethod, issuedAt: Date.now() });
}

export async function readStudentAuthSession() {
  const cookieStore = await cookies();
  const session = verifySignedCookie<StudentAuthSession>(cookieStore.get(STUDENT_AUTH_SESSION_COOKIE)?.value);
  if (!session?.profileId || !["line", "phone"].includes(session.authMethod)) return null;
  return session;
}

export function setStudentAuthSession(response: NextResponse, profileId: string, authMethod: StudentAuthMethod) {
  response.cookies.set(STUDENT_AUTH_SESSION_COOKIE, createStudentAuthSessionCookie(profileId, authMethod), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STUDENT_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearStudentAuthSession(response: NextResponse) {
  response.cookies.delete(STUDENT_AUTH_SESSION_COOKIE);
}

export function appOrigin(request: Request) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    `${new URL(request.url).protocol}//${new URL(request.url).host}`
  ).replace(/\/$/, "");
}

export function checkInUrl(request: Request) {
  return `${appOrigin(request)}/check-in`;
}

export function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("886") && digits.length === 12) return `0${digits.slice(3)}`;
  return digits;
}

export function taipeiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${map.year}-${map.month}-${map.day}`;
  return { localDate, localMonth: `${map.year}-${map.month}` };
}

export function isCompleteStudentProfile(profile: StudentProfileRow | null): profile is StudentProfileRow {
  return Boolean(
    profile &&
      profile.is_active &&
      profile.full_name &&
      profile.phone &&
      profile.birth_date &&
      profile.password_hash &&
      profile.photo_path,
  );
}

const profileSelect =
  "id, line_user_id, line_display_name, full_name, phone, birth_date, password_hash, photo_path, is_active, bound_at, last_checkin_at";

export async function loadStudentProfileById(profileId: string) {
  const result = await createSupabaseAdminClient()
    .from("student_line_profiles")
    .select(profileSelect)
    .eq("id", profileId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentProfileRow | null;
}

export async function loadStudentProfileByLine(lineUserId: string) {
  const result = await createSupabaseAdminClient()
    .from("student_line_profiles")
    .select(profileSelect)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentProfileRow | null;
}

export async function loadStudentProfileByPhone(phoneInput: string) {
  const result = await createSupabaseAdminClient()
    .from("student_line_profiles")
    .select(profileSelect)
    .eq("phone", normalizePhone(phoneInput))
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentProfileRow | null;
}

export async function hashStudentPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyStudentPassword(password: string, storedHash: string | null) {
  if (!storedHash) return false;
  const [algorithm, saltText, hashText] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;

  try {
    const expected = Buffer.from(hashText, "base64url");
    const derived = (await scryptAsync(password, Buffer.from(saltText, "base64url"), expected.length)) as Buffer;
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export async function createCheckinRequest(input: {
  profileId: string;
  authMethod: StudentAuthMethod;
  request: Request;
}) {
  const admin = createSupabaseAdminClient();
  const existing = await admin
    .from("student_checkin_requests")
    .select("id, student_profile_id, status, auth_method, requested_at, reviewed_at")
    .eq("student_profile_id", input.profileId)
    .eq("status", "pending")
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as StudentCheckinRequestRow;

  const inserted = await admin
    .from("student_checkin_requests")
    .insert({
      student_profile_id: input.profileId,
      auth_method: input.authMethod,
      user_agent: input.request.headers.get("user-agent") || null,
      ip_address: input.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    })
    .select("id, student_profile_id, status, auth_method, requested_at, reviewed_at")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const raced = await admin
        .from("student_checkin_requests")
        .select("id, student_profile_id, status, auth_method, requested_at, reviewed_at")
        .eq("student_profile_id", input.profileId)
        .eq("status", "pending")
        .single();
      if (!raced.error) return raced.data as StudentCheckinRequestRow;
    }
    throw new Error(inserted.error.message);
  }
  return inserted.data as StudentCheckinRequestRow;
}

export async function loadRecentCheckinRequest(profileId: string) {
  const cutoff = new Date(Date.now() - STUDENT_SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const result = await createSupabaseAdminClient()
    .from("student_checkin_requests")
    .select("id, student_profile_id, status, auth_method, requested_at, reviewed_at")
    .eq("student_profile_id", profileId)
    .gte("requested_at", cutoff)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentCheckinRequestRow | null;
}

export async function loadApprovedCheckin(requestId: string) {
  const result = await createSupabaseAdminClient()
    .from("student_check_ins")
    .select("id, checked_in_at, local_date, local_month, month_sequence")
    .eq("request_id", requestId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data || null;
}

export function encouragementFor(name: string, monthSequence: number) {
  if (monthSequence <= 1) return `${name}，第一次來 BigE 自主運動就很棒。今天願意開始，就是最重要的一步！`;
  if (monthSequence <= 4) return `${name}，這個月已經第 ${monthSequence} 次來運動了。你正在把照顧自己變成很好的習慣！`;
  if (monthSequence <= 8) return `${name}，第 ${monthSequence} 次達成。你的穩定累積正在慢慢變成看得見的力量！`;
  return `${name}，這個月第 ${monthSequence} 次報到。這份自律非常不簡單，今天也為自己好好加油！`;
}
