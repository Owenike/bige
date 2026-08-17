import { NextRequest, NextResponse } from "next/server";
import { rateLimitFixedWindow } from "../../../../../../lib/rate-limit";
import {
  isCompleteStudentProfile,
  loadStudentProfileById,
  readStudentAuthSession,
} from "../../../../../../lib/student-checkin";
import {
  attachPasskeyChallengeCookie,
  createPasskeyRegistrationOptions,
} from "../../../../../../lib/student-checkin-passkeys";

export async function POST(request: NextRequest) {
  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "請先使用手機與密碼登入。" }, { status: 401 });
  const limit = rateLimitFixedWindow({
    key: `student-passkey-register:${session.profileId}`,
    limit: 6,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "操作過於頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const profile = await loadStudentProfileById(session.profileId);
  if (!isCompleteStudentProfile(profile) || profile.must_complete_security_setup) {
    return NextResponse.json({ ok: false, error: "請先完成帳號安全設定。" }, { status: 403 });
  }
  try {
    const { options, challengeId } = await createPasskeyRegistrationOptions(request, profile);
    const response = NextResponse.json({ ok: true, options });
    attachPasskeyChallengeCookie(response, challengeId);
    return response;
  } catch (error) {
    console.error("student passkey registration options failed", error);
    return NextResponse.json({ ok: false, error: "目前無法啟用生物辨識，請稍後再試。" }, { status: 500 });
  }
}
