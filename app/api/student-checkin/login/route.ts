import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";
import {
  isValidTaiwanMobile,
  isCompleteStudentProfile,
  loadStudentProfileByPhone,
  normalizePhone,
  setStudentAuthSession,
  verifyStudentPassword,
} from "../../../../lib/student-checkin";
import { recordSystemAuditEvent, type SystemAuditOutcome } from "../../../../lib/system-audit";

const loginSchema = z.object({
  phone: z.string().trim().min(8).max(20),
  password: z.string().min(5).max(100),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  let accountIdentifier: string | null = null;
  let profileId: string | null = null;
  const auditLogin = async (status: number, reason: string, outcome?: SystemAuditOutcome) =>
    recordSystemAuditEvent({
      request,
      accountType: "student",
      accountIdentifier,
      eventCategory: "authentication",
      action: "auth.student_login",
      outcome: outcome || (status === 429 ? "rate_limited" : status === 403 ? "denied" : "failure"),
      targetType: profileId ? "student_line_profile" : null,
      targetId: profileId,
      reason,
      metadata: { statusCode: status, authMethod: "phone" },
    });
  const limit = rateLimitFixedWindow({ key: `student-checkin-login:${ip}`, limit: 12, windowMs: 10 * 60 * 1000 });
  if (!limit.ok) {
    await auditLogin(429, "rate_limit_exceeded");
    return NextResponse.json(
      { ok: false, error: "嘗試次數過多，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const body = await request.json().catch(() => null);
  accountIdentifier = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) await auditLogin(400, "credentials_required");
  if (!parsed.success) return NextResponse.json({ ok: false, error: "請輸入正確的手機號碼與密碼。" }, { status: 400 });

  const phone = normalizePhone(parsed.data.phone);
  accountIdentifier = phone;
  if (!isValidTaiwanMobile(phone)) {
    await auditLogin(400, "invalid_phone_format");
    return NextResponse.json(
      { ok: false, error: "請輸入正確的 10 位手機號碼，例如 0912345678。" },
      { status: 400 },
    );
  }
  const profile = await loadStudentProfileByPhone(phone);
  if (!profile) {
    await auditLogin(404, "student_profile_not_found");
    return NextResponse.json(
      {
        ok: false,
        code: "profile_not_found",
        error: "查無此手機資料，請確認手機號碼。若是第一次使用，請點下方建立學員資料。",
      },
      { status: 404 },
    );
  }
  profileId = profile.id;

  const passwordMatches = await verifyStudentPassword(parsed.data.password, profile.password_hash);
  if (!passwordMatches || !isCompleteStudentProfile(profile)) {
    await auditLogin(401, passwordMatches ? "student_profile_incomplete" : "invalid_credentials");
    return NextResponse.json({ ok: false, error: "手機號碼或密碼不正確。" }, { status: 401 });
  }

  if (profile.must_complete_security_setup) {
    const response = NextResponse.json({
      ok: true,
      needsSecuritySetup: true,
      profile: { id: profile.id, fullName: profile.full_name, email: profile.email },
    });
    setStudentAuthSession(response, profile.id, "phone");
    await auditLogin(200, "security_setup_required", "success");
    return response;
  }

  const response = NextResponse.json({
    ok: true,
    authenticated: true,
    profile: { id: profile.id, fullName: profile.full_name },
  });
  setStudentAuthSession(response, profile.id, "phone");
  await auditLogin(200, "password_login", "success");
  return response;
}
