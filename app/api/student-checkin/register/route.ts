import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bigeFacilityClosedMessage, isBigeFacilityClosed } from "../../../../lib/bige-business-day";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import {
  hashStudentPassword,
  isValidTaiwanMobile,
  loadStudentProfileByEmail,
  loadStudentProfileByPhone,
  normalizePhone,
} from "../../../../lib/student-checkin";
import {
  cancelStudentEmailVerification,
  createStudentEmailVerificationToken,
  readPendingStudentRegistrationId,
  sendStudentEmailVerification,
  setPendingStudentRegistrationCookie,
  studentEmailVerificationExpiry,
} from "../../../../lib/student-checkin-email-verification";
import {
  findFormalMemberForIdentity,
  STUDENT_NOT_OFFICIAL_MEMBER,
} from "../../../../lib/student-entry-access";

const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(40),
  phone: z.string().trim().min(8).max(20),
  email: z.string().trim().toLowerCase().email().max(254),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  password: z.string().min(6).max(100),
  entryMode: z.enum(["autonomous", "drop_in"]).default("autonomous"),
});

export async function POST(request: Request) {
  const facility = await isBigeFacilityClosed({});
  if (facility.closed) {
    return NextResponse.json(
      { ok: false, code: "facility_closed", error: bigeFacilityClosedMessage(facility.setting) },
      { status: 409 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimitFixedWindow({ key: `student-checkin-register:${ip}`, limit: 8, windowMs: 60 * 60 * 1000 });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "建立資料次數過多，請洽現場工作人員。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "資料格式不正確。" }, { status: 400 });

  const parsed = registrationSchema.safeParse({
    fullName: form.get("fullName"),
    phone: form.get("phone"),
    email: form.get("email"),
    birthDate: form.get("birthDate"),
    password: form.get("password"),
    entryMode: form.get("entryMode") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "請完整填寫姓名、電話、Email、生日與至少 6 碼密碼。" }, { status: 400 });
  }

  const birthday = new Date(`${parsed.data.birthDate}T00:00:00+08:00`);
  if (Number.isNaN(birthday.getTime()) || birthday > new Date() || parsed.data.birthDate < "1900-01-01") {
    return NextResponse.json({ ok: false, error: "生日格式不正確。" }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!isValidTaiwanMobile(phone)) {
    return NextResponse.json(
      { ok: false, error: "請輸入正確的 10 位手機號碼，例如 0912345678。" },
      { status: 400 },
    );
  }

  const email = parsed.data.email;
  const [phoneProfile, emailProfile] = await Promise.all([
    loadStudentProfileByPhone(phone),
    loadStudentProfileByEmail(email),
  ]);

  if (phoneProfile) {
    return NextResponse.json({ ok: false, error: "這支手機已建立資料，請回登入頁使用手機與密碼報到。" }, { status: 409 });
  }

  if (emailProfile) {
    return NextResponse.json({ ok: false, error: "這個 Email 已建立學員資料，請使用原本的手機與密碼登入。" }, { status: 409 });
  }

  if (parsed.data.entryMode === "autonomous") {
    const formalMember = await findFormalMemberForIdentity({
      fullName: parsed.data.fullName,
      phone,
      email,
      birthDate: parsed.data.birthDate,
    });
    if (!formalMember) {
      return NextResponse.json({ ok: false, ...STUDENT_NOT_OFFICIAL_MEMBER }, { status: 403 });
    }
  }

  const currentRegistrationId = await readPendingStudentRegistrationId();
  if (currentRegistrationId) {
    await cancelStudentEmailVerification(currentRegistrationId).catch(() => null);
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const [pendingPhone, pendingEmail] = await Promise.all([
    admin
      .from("student_checkin_email_verifications")
      .select("id, expires_at")
      .eq("phone", phone)
      .in("status", ["pending", "verifying"])
      .limit(1)
      .maybeSingle(),
    admin
      .from("student_checkin_email_verifications")
      .select("id, expires_at")
      .eq("email", email)
      .in("status", ["pending", "verifying"])
      .limit(1)
      .maybeSingle(),
  ]);
  if (pendingPhone.error || pendingEmail.error) {
    return NextResponse.json({ ok: false, error: "檢查待驗證資料失敗，請稍後再試。" }, { status: 500 });
  }

  const pendingRows = [pendingPhone.data, pendingEmail.data].filter(
    (row, index, rows): row is { id: string; expires_at: string } =>
      Boolean(row) && rows.findIndex((candidate) => candidate?.id === row?.id) === index,
  );
  for (const pending of pendingRows) {
    if (pending.expires_at <= now) {
      await cancelStudentEmailVerification(pending.id).catch(() => null);
      continue;
    }
    return NextResponse.json(
      { ok: false, error: "這支手機或 Email 已有一封驗證信等待確認，請回到原申請畫面重新寄送，或於 30 分鐘後再試。" },
      { status: 409 },
    );
  }

  const registrationId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const passwordHash = await hashStudentPassword(parsed.data.password);
  const { token, tokenHash } = createStudentEmailVerificationToken();
  const expiresAt = studentEmailVerificationExpiry();

  const createdAuth = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: false,
    app_metadata: {
      account_type: "student_checkin",
      registration_id: registrationId,
      entry_mode: parsed.data.entryMode,
    },
  });
  const duplicateAuthEmail =
    createdAuth.error?.message.toLowerCase().includes("already") || createdAuth.error?.status === 422;
  if (createdAuth.error && !duplicateAuthEmail) {
    return NextResponse.json(
      { ok: false, error: "Email 帳號建立失敗，請洽現場工作人員。" },
      { status: 500 },
    );
  }

  // A staff/admin account may already own this email. Student check-in uses its
  // own phone/password authentication, so never attach that existing Auth user
  // to the student profile or overwrite the employee account's credentials.
  const createdAuthUserId = createdAuth.data.user?.id || null;
  if (!duplicateAuthEmail && !createdAuthUserId) {
    return NextResponse.json(
      { ok: false, error: "Email 帳號建立失敗，請洽現場工作人員。" },
      { status: 500 },
    );
  }

  const saved = await admin.from("student_checkin_email_verifications").insert({
    id: registrationId,
    profile_id: profileId,
    auth_user_id: createdAuthUserId,
    full_name: parsed.data.fullName,
    phone,
    email,
    birth_date: parsed.data.birthDate,
    password_hash: passwordHash,
    entry_mode: parsed.data.entryMode,
    verification_token_hash: tokenHash,
    expires_at: expiresAt,
    last_email_sent_at: now,
    updated_at: now,
  });

  if (saved.error) {
    if (createdAuthUserId) await admin.auth.admin.deleteUser(createdAuthUserId).catch(() => null);
    const message = saved.error.code === "23505" ? "這支手機或 Email 已有待驗證資料。" : "待驗證資料建立失敗，請稍後再試。";
    return NextResponse.json({ ok: false, error: message }, { status: saved.error.code === "23505" ? 409 : 500 });
  }

  const emailResult = await sendStudentEmailVerification({
    request,
    email,
    fullName: parsed.data.fullName,
    token,
    entryMode: parsed.data.entryMode,
  });
  if (!emailResult.ok) {
    await cancelStudentEmailVerification(registrationId).catch(() => null);
    return NextResponse.json(
      { ok: false, error: "驗證信寄送失敗，請確認 Email 後再試，或洽現場工作人員。" },
      { status: 502 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    verificationRequired: true,
    email,
    expiresAt,
  });
  setPendingStudentRegistrationCookie(response, registrationId);
  return response;
}
