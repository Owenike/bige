import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "./supabase/admin";

export const STUDENT_LINE_SESSION_COOKIE = "bige_student_line_session";
export const STUDENT_LINE_STATE_COOKIE = "bige_student_line_state";

type StudentLineSession = {
  lineUserId: string;
  lineDisplayName: string | null;
  issuedAt: number;
};

type StudentProfileRow = {
  id: string;
  line_user_id: string;
  line_display_name: string | null;
  full_name: string;
  phone: string;
  bound_at: string;
  last_checkin_at: string | null;
};

export type StudentCheckinResult = {
  profile: StudentProfileRow;
  checkIn: {
    id: string;
    checked_in_at: string;
    local_date: string;
    local_month: string;
    month_sequence: number;
  };
  reused: boolean;
};

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function readSessionSecret() {
  const secret = process.env.LINE_LOGIN_SESSION_SECRET || process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing LINE_LOGIN_SESSION_SECRET or LINE_LOGIN_CHANNEL_SECRET");
  return secret;
}

function signPayload(payload: string) {
  return crypto.createHmac("sha256", readSessionSecret()).update(payload).digest("base64url");
}

export function createStudentLineSessionCookie(input: { lineUserId: string; lineDisplayName?: string | null }) {
  const payload = base64url(
    JSON.stringify({
      lineUserId: input.lineUserId,
      lineDisplayName: input.lineDisplayName || null,
      issuedAt: Date.now(),
    } satisfies StudentLineSession),
  );
  return `${payload}.${signPayload(payload)}`;
}

export function verifyStudentLineSessionCookie(value: string | undefined | null): StudentLineSession | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = signPayload(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StudentLineSession;
  if (!parsed.lineUserId || typeof parsed.issuedAt !== "number") return null;
  if (Date.now() - parsed.issuedAt > 30 * 60 * 1000) return null;
  return parsed;
}

export async function readStudentLineSession() {
  const cookieStore = await cookies();
  return verifyStudentLineSessionCookie(cookieStore.get(STUDENT_LINE_SESSION_COOKIE)?.value);
}

export function setStudentLineSession(response: NextResponse, sessionValue: string) {
  response.cookies.set(STUDENT_LINE_SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 60,
  });
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
  return input.replace(/\D/g, "");
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

export async function loadStudentProfile(lineUserId: string) {
  const admin = createSupabaseAdminClient();
  const result = await admin
    .from("student_line_profiles")
    .select("id, line_user_id, line_display_name, full_name, phone, bound_at, last_checkin_at")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data || null) as StudentProfileRow | null;
}

export async function upsertStudentProfile(input: {
  lineUserId: string;
  lineDisplayName: string | null;
  fullName: string;
  phone: string;
}) {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const result = await admin
    .from("student_line_profiles")
    .upsert(
      {
        line_user_id: input.lineUserId,
        line_display_name: input.lineDisplayName,
        full_name: input.fullName,
        phone: normalizePhone(input.phone),
        updated_at: nowIso,
      },
      { onConflict: "line_user_id" },
    )
    .select("id, line_user_id, line_display_name, full_name, phone, bound_at, last_checkin_at")
    .single();
  if (result.error) throw new Error(result.error.message);
  return result.data as StudentProfileRow;
}

export async function recordStudentCheckin(params: {
  profile: StudentProfileRow;
  request: Request;
}): Promise<StudentCheckinResult> {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const { localDate, localMonth } = taipeiDateParts(now);

  const recentResult = await admin
    .from("student_check_ins")
    .select("id, checked_in_at, local_date, local_month, month_sequence")
    .eq("student_profile_id", params.profile.id)
    .gte("checked_in_at", new Date(now.getTime() - 5 * 60 * 1000).toISOString())
    .order("checked_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentResult.error) throw new Error(recentResult.error.message);
  if (recentResult.data) {
    return { profile: params.profile, checkIn: recentResult.data as StudentCheckinResult["checkIn"], reused: true };
  }

  const countResult = await admin
    .from("student_check_ins")
    .select("id", { count: "exact", head: true })
    .eq("student_profile_id", params.profile.id)
    .eq("local_month", localMonth);
  if (countResult.error) throw new Error(countResult.error.message);

  const monthSequence = (countResult.count || 0) + 1;
  const insertResult = await admin
    .from("student_check_ins")
    .insert({
      student_profile_id: params.profile.id,
      line_user_id: params.profile.line_user_id,
      full_name: params.profile.full_name,
      phone: params.profile.phone,
      checked_in_at: nowIso,
      local_date: localDate,
      local_month: localMonth,
      month_sequence: monthSequence,
      user_agent: params.request.headers.get("user-agent") || null,
      ip_address: params.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    })
    .select("id, checked_in_at, local_date, local_month, month_sequence")
    .single();
  if (insertResult.error) throw new Error(insertResult.error.message);

  await admin
    .from("student_line_profiles")
    .update({ last_checkin_at: nowIso, updated_at: nowIso })
    .eq("id", params.profile.id);

  return { profile: params.profile, checkIn: insertResult.data as StudentCheckinResult["checkIn"], reused: false };
}

export function encouragementFor(name: string, monthSequence: number) {
  if (monthSequence <= 1) return `${name}，歡迎回到 BigE。這個月的第一步已經完成了，很棒。`;
  if (monthSequence <= 4) return `${name}，你這個月已經第 ${monthSequence} 次來自主運動了，穩定出現就是最強的累積。`;
  if (monthSequence <= 8) return `${name}，第 ${monthSequence} 次了。你不是偶爾努力，你是真的在養成自己的節奏。`;
  return `${name}，這個月第 ${monthSequence} 次自主運動。這份自律很帥，身體一定會記得。`;
}
