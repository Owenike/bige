import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import {
  createCheckinRequest,
  hashStudentPassword,
  loadStudentProfileByEmail,
  loadStudentProfileByLine,
  loadStudentProfileByPhone,
  normalizePhone,
  readStudentLineSession,
  setStudentAuthSession,
} from "../../../../lib/student-checkin";

const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(40),
  phone: z.string().trim().min(8).max(20),
  email: z.string().trim().toLowerCase().email().max(254),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  password: z.string().min(6).max(100),
});

export async function POST(request: Request) {
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
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "請完整填寫姓名、電話、Email、生日與至少 6 碼密碼。" }, { status: 400 });
  }

  const birthday = new Date(`${parsed.data.birthDate}T00:00:00+08:00`);
  if (Number.isNaN(birthday.getTime()) || birthday > new Date() || parsed.data.birthDate < "1900-01-01") {
    return NextResponse.json({ ok: false, error: "生日格式不正確。" }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.phone);
  if (phone.length < 8 || phone.length > 12) {
    return NextResponse.json({ ok: false, error: "手機號碼格式不正確。" }, { status: 400 });
  }

  const lineSession = await readStudentLineSession();
  const email = parsed.data.email;
  const [phoneProfile, emailProfile, lineProfile] = await Promise.all([
    loadStudentProfileByPhone(phone),
    loadStudentProfileByEmail(email),
    lineSession ? loadStudentProfileByLine(lineSession.lineUserId) : Promise.resolve(null),
  ]);

  if (phoneProfile && phoneProfile.id !== lineProfile?.id) {
    return NextResponse.json({ ok: false, error: "這支手機已建立資料，請回登入頁使用手機與密碼報到。" }, { status: 409 });
  }

  if (emailProfile && emailProfile.id !== lineProfile?.id) {
    return NextResponse.json({ ok: false, error: "這個 Email 已建立學員資料，請使用原本的手機與密碼登入。" }, { status: 409 });
  }

  const profileId = lineProfile?.id || crypto.randomUUID();
  const admin = createSupabaseAdminClient();
  const passwordHash = await hashStudentPassword(parsed.data.password);
  let authUserId = lineProfile?.auth_user_id || null;
  let createdAuthUserId: string | null = null;

  if (authUserId) {
    const updatedAuth = await admin.auth.admin.updateUserById(authUserId, {
      email,
      password: parsed.data.password,
      email_confirm: true,
      app_metadata: { account_type: "student_checkin" },
    });
    if (updatedAuth.error) {
      return NextResponse.json({ ok: false, error: "Email 帳號連結失敗，請洽現場工作人員。" }, { status: 500 });
    }
  } else {
    const createdAuth = await admin.auth.admin.createUser({
      email,
      password: parsed.data.password,
      email_confirm: true,
      app_metadata: { account_type: "student_checkin" },
    });
    if (createdAuth.error || !createdAuth.data.user) {
      const duplicate = createdAuth.error?.message.toLowerCase().includes("already") || createdAuth.error?.status === 422;
      return NextResponse.json(
        { ok: false, error: duplicate ? "這個 Email 已被使用，請改用其他 Email 或洽現場人員。" : "Email 帳號建立失敗，請洽現場工作人員。" },
        { status: duplicate ? 409 : 500 },
      );
    }
    authUserId = createdAuth.data.user.id;
    createdAuthUserId = authUserId;
  }

  const profilePayload = {
    id: profileId,
    auth_user_id: authUserId,
    line_user_id: lineSession?.lineUserId || null,
    line_display_name: lineSession?.lineDisplayName || null,
    full_name: parsed.data.fullName,
    phone,
    email,
    birth_date: parsed.data.birthDate,
    password_hash: passwordHash,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const saved = lineProfile
    ? await admin.from("student_line_profiles").update(profilePayload).eq("id", profileId).select("id, full_name").single()
    : await admin.from("student_line_profiles").insert(profilePayload).select("id, full_name").single();

  if (saved.error) {
    if (createdAuthUserId) await admin.auth.admin.deleteUser(createdAuthUserId).catch(() => null);
    const message = saved.error.code === "23505" ? "這支手機或 LINE 已建立資料。" : "學員資料建立失敗，請洽現場工作人員。";
    return NextResponse.json({ ok: false, error: message }, { status: saved.error.code === "23505" ? 409 : 500 });
  }

  const authMethod = lineSession ? "line" : "phone";
  const checkinRequest = await createCheckinRequest({ profileId, authMethod, request });
  const response = NextResponse.json({
    ok: true,
    profile: { id: profileId, fullName: parsed.data.fullName },
    request: checkinRequest,
  });
  setStudentAuthSession(response, profileId, authMethod);
  return response;
}
