import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";
import {
  hashStudentPassword,
  loadStudentProfileByEmail,
  loadStudentProfileById,
  readStudentAuthSession,
  verifyStudentPassword,
} from "../../../../lib/student-checkin";
import {
  cancelActiveStudentSecuritySetup,
  createStudentSecuritySetupToken,
  isAuthEmailUsedByAnotherUser,
  sendStudentSecuritySetupVerification,
  studentSecuritySetupExpiry,
} from "../../../../lib/student-checkin-security-setup";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const setupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(6).max(100),
  passwordConfirmation: z.string().min(6).max(100),
  entryMode: z.enum(["autonomous", "drop_in"]).default("autonomous"),
}).refine((value) => value.password === value.passwordConfirmation, {
  message: "兩次輸入的新密碼不一致。",
  path: ["passwordConfirmation"],
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimitFixedWindow({
    key: `student-checkin-security-setup:${ip}`,
    limit: 8,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "安全設定嘗試次數過多，請稍後再試或洽現場人員。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "登入已逾時，請使用暫時密碼重新登入。" }, { status: 401 });

  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message || "請填寫正確的 Email 與至少 6 碼新密碼。" },
      { status: 400 },
    );
  }

  const profile = await loadStudentProfileById(session.profileId);
  if (!profile?.must_complete_security_setup || !profile.auth_user_id) {
    return NextResponse.json({ ok: false, error: "此帳號目前不需要進行安全設定。" }, { status: 409 });
  }

  if (await verifyStudentPassword(parsed.data.password, profile.password_hash)) {
    return NextResponse.json({ ok: false, error: "新密碼不可與暫時密碼相同。" }, { status: 400 });
  }

  const email = parsed.data.email;
  const profileWithEmail = await loadStudentProfileByEmail(email);
  if (profileWithEmail && profileWithEmail.id !== profile.id) {
    return NextResponse.json({ ok: false, error: "這個 Email 已由其他自主運動帳號使用，請改用其他 Email。" }, { status: 409 });
  }

  try {
    if (await isAuthEmailUsedByAnotherUser(email, profile.auth_user_id)) {
      return NextResponse.json({ ok: false, error: "這個 Email 已由其他系統帳號使用，請改用其他 Email。" }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Email 唯一性檢查失敗，請稍後再試。" },
      { status: 500 },
    );
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const passwordHash = await hashStudentPassword(parsed.data.password);
  const { token, tokenHash } = createStudentSecuritySetupToken();
  const expiresAt = studentSecuritySetupExpiry();

  try {
    await cancelActiveStudentSecuritySetup(profile.id);
    const inserted = await admin.from("student_checkin_security_setups").insert({
      profile_id: profile.id,
      auth_user_id: profile.auth_user_id,
      previous_email: profile.email,
      pending_email: email,
      pending_password_hash: passwordHash,
      verification_token_hash: tokenHash,
      expires_at: expiresAt,
      last_email_sent_at: now,
      updated_at: now,
    });
    if (inserted.error) {
      const conflict = inserted.error.code === "23505";
      return NextResponse.json(
        { ok: false, error: conflict ? "這個 Email 已有待驗證的安全設定，請改用其他 Email 或稍後再試。" : "安全設定資料建立失敗，請稍後再試。" },
        { status: conflict ? 409 : 500 },
      );
    }

    const passwordUpdate = await admin.auth.admin.updateUserById(profile.auth_user_id, {
      password: parsed.data.password,
    });
    if (passwordUpdate.error) {
      await cancelActiveStudentSecuritySetup(profile.id).catch(() => null);
      return NextResponse.json({ ok: false, error: "新密碼設定失敗，請改用其他密碼後再試。" }, { status: 500 });
    }

    const emailResult = await sendStudentSecuritySetupVerification({
      request,
      email,
      fullName: profile.full_name,
      token,
      entryMode: parsed.data.entryMode,
    });
    if (!emailResult.ok) {
      await cancelActiveStudentSecuritySetup(profile.id).catch(() => null);
      return NextResponse.json(
        { ok: false, error: "驗證信寄送失敗，請確認 Email 後再試，或洽現場人員。" },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, verificationRequired: true, email, expiresAt });
  } catch {
    await cancelActiveStudentSecuritySetup(profile.id).catch(() => null);
    return NextResponse.json({ ok: false, error: "安全設定暫時無法使用，請稍後再試。" }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "登入已逾時，請重新登入。" }, { status: 401 });
  await cancelActiveStudentSecuritySetup(session.profileId);
  return NextResponse.json({ ok: true });
}
