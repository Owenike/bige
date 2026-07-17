import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";
import {
  createCheckinRequest,
  isCompleteStudentProfile,
  loadStudentProfileByPhone,
  normalizePhone,
  setStudentAuthSession,
  studentMembershipPeriodStatus,
  verifyStudentPassword,
} from "../../../../lib/student-checkin";

const loginSchema = z.object({
  phone: z.string().trim().min(8).max(20),
  password: z.string().min(6).max(100),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimitFixedWindow({ key: `student-checkin-login:${ip}`, limit: 12, windowMs: 10 * 60 * 1000 });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "嘗試次數過多，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "請輸入正確的手機號碼與密碼。" }, { status: 400 });

  const phone = normalizePhone(parsed.data.phone);
  const profile = await loadStudentProfileByPhone(phone);
  if (!profile) {
    return NextResponse.json({ ok: true, needsProfile: true, phone });
  }

  const passwordMatches = await verifyStudentPassword(parsed.data.password, profile.password_hash);
  if (!passwordMatches || !isCompleteStudentProfile(profile)) {
    return NextResponse.json({ ok: false, error: "手機號碼或密碼不正確。" }, { status: 401 });
  }

  const periodStatus = studentMembershipPeriodStatus(profile);
  if (periodStatus !== "active") {
    return NextResponse.json(
      {
        ok: false,
        code: periodStatus === "not_started" ? "membership_not_started" : "membership_expired",
        error: periodStatus === "not_started"
          ? "自主運動期限尚未開始，請依後台設定的開始日期再來報到。"
          : "自主運動期限已到期，請洽現場人員協助。",
        startsOn: profile.membership_starts_on,
        expiresOn: profile.membership_expires_on,
      },
      { status: 403 },
    );
  }

  const checkinRequest = await createCheckinRequest({ profileId: profile.id, authMethod: "phone", request });
  const response = NextResponse.json({
    ok: true,
    profile: { id: profile.id, fullName: profile.full_name },
    request: checkinRequest,
  });
  setStudentAuthSession(response, profile.id, "phone");
  return response;
}
