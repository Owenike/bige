import { NextResponse } from "next/server";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import {
  createStudentEmailVerificationToken,
  loadStudentEmailVerificationById,
  readPendingStudentRegistrationId,
  sendStudentEmailVerification,
  setPendingStudentRegistrationCookie,
  studentEmailVerificationExpiry,
} from "../../../../../lib/student-checkin-email-verification";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const RESEND_COOLDOWN_MS = 60 * 1000;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimitFixedWindow({
    key: `student-checkin-email-resend:${ip}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "重新寄送次數過多，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const registrationId = await readPendingStudentRegistrationId();
  if (!registrationId) {
    return NextResponse.json({ ok: false, error: "找不到待驗證申請，請返回重新填寫資料。" }, { status: 401 });
  }

  const pending = await loadStudentEmailVerificationById(registrationId);
  if (!pending || pending.status === "cancelled") {
    return NextResponse.json({ ok: false, error: "這筆申請已失效，請返回重新填寫資料。" }, { status: 404 });
  }
  if (pending.status === "completed") {
    return NextResponse.json({ ok: true, completed: true, email: pending.email });
  }
  if (pending.status === "verifying") {
    return NextResponse.json({ ok: false, error: "驗證正在處理中，請稍候。" }, { status: 409 });
  }

  const elapsed = Date.now() - new Date(pending.last_email_sent_at).getTime();
  if (elapsed < RESEND_COOLDOWN_MS) {
    const retryAfterSec = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000));
    return NextResponse.json(
      { ok: false, error: `請等待 ${retryAfterSec} 秒後再重新寄送。`, retryAfterSec },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  const admin = createSupabaseAdminClient();
  const { token, tokenHash } = createStudentEmailVerificationToken();
  const expiresAt = studentEmailVerificationExpiry();
  const now = new Date().toISOString();
  const updated = await admin
    .from("student_checkin_email_verifications")
    .update({
      verification_token_hash: tokenHash,
      expires_at: expiresAt,
      last_email_sent_at: now,
      email_send_count: pending.email_send_count + 1,
      updated_at: now,
    })
    .eq("id", registrationId)
    .eq("status", "pending");
  if (updated.error) {
    return NextResponse.json({ ok: false, error: "更新驗證信失敗，請稍後再試。" }, { status: 500 });
  }

  const sent = await sendStudentEmailVerification({
    request,
    email: pending.email,
    fullName: pending.full_name,
    token,
    entryMode: pending.entry_mode,
  });
  if (!sent.ok) {
    await admin
      .from("student_checkin_email_verifications")
      .update({
        verification_token_hash: pending.verification_token_hash,
        expires_at: pending.expires_at,
        last_email_sent_at: pending.last_email_sent_at,
        email_send_count: pending.email_send_count,
        updated_at: new Date().toISOString(),
      })
      .eq("id", registrationId)
      .eq("status", "pending");
    return NextResponse.json({ ok: false, error: "驗證信寄送失敗，請稍後再試。" }, { status: 502 });
  }

  const response = NextResponse.json({ ok: true, email: pending.email, expiresAt });
  setPendingStudentRegistrationCookie(response, registrationId);
  return response;
}
