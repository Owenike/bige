import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import { loadStudentProfileById, readStudentAuthSession } from "../../../../../lib/student-checkin";
import {
  createStudentSecuritySetupToken,
  loadActiveStudentSecuritySetup,
  sendStudentSecuritySetupVerification,
  STUDENT_SECURITY_SETUP_MAX_EMAIL_SENDS,
  studentSecuritySetupExpiry,
} from "../../../../../lib/student-checkin-security-setup";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimitFixedWindow({
    key: `student-checkin-security-setup-resend:${ip}`,
    limit: 5,
    windowMs: 30 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "重新寄送次數過多，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "登入已逾時，請重新登入。" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const entryMode = z.enum(["autonomous", "drop_in"]).catch("autonomous").parse(body?.entryMode);

  const [profile, setup] = await Promise.all([
    loadStudentProfileById(session.profileId),
    loadActiveStudentSecuritySetup(session.profileId),
  ]);
  if (!profile?.must_complete_security_setup || !setup) {
    return NextResponse.json({ ok: false, error: "找不到待驗證的安全設定，請重新填寫。" }, { status: 404 });
  }
  if (setup.status === "verifying") {
    return NextResponse.json({ ok: false, error: "驗證正在處理中，請稍候。" }, { status: 409 });
  }
  if (setup.email_send_count >= STUDENT_SECURITY_SETUP_MAX_EMAIL_SENDS) {
    return NextResponse.json({ ok: false, error: "驗證信寄送次數已達上限，請洽現場人員協助。" }, { status: 429 });
  }

  const admin = createSupabaseAdminClient();
  const { token, tokenHash } = createStudentSecuritySetupToken();
  const now = new Date().toISOString();
  const expiresAt = studentSecuritySetupExpiry();
  const updated = await admin
    .from("student_checkin_security_setups")
    .update({
      verification_token_hash: tokenHash,
      expires_at: expiresAt,
      last_email_sent_at: now,
      email_send_count: setup.email_send_count + 1,
      updated_at: now,
    })
    .eq("id", setup.id)
    .eq("status", "pending");
  if (updated.error) {
    return NextResponse.json({ ok: false, error: "驗證信狀態更新失敗，請稍後再試。" }, { status: 500 });
  }

  const emailResult = await sendStudentSecuritySetupVerification({
    request,
    email: setup.pending_email,
    fullName: profile.full_name,
    token,
    entryMode,
  });
  if (!emailResult.ok) {
    await admin
      .from("student_checkin_security_setups")
      .update({
        verification_token_hash: setup.verification_token_hash,
        expires_at: setup.expires_at,
        last_email_sent_at: setup.last_email_sent_at,
        email_send_count: setup.email_send_count,
        updated_at: new Date().toISOString(),
      })
      .eq("id", setup.id)
      .eq("status", "pending");
    return NextResponse.json({ ok: false, error: "驗證信寄送失敗，請稍後再試。" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, email: setup.pending_email, expiresAt });
}
