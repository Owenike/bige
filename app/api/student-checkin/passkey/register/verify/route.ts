import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextRequest, NextResponse } from "next/server";
import {
  isCompleteStudentProfile,
  loadStudentProfileById,
  readStudentAuthSession,
} from "../../../../../../lib/student-checkin";
import {
  clearPasskeyChallengeCookie,
  verifyAndSavePasskeyRegistration,
} from "../../../../../../lib/student-checkin-passkeys";

export async function POST(request: NextRequest) {
  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "登入狀態已失效，請重新登入。" }, { status: 401 });
  const profile = await loadStudentProfileById(session.profileId);
  if (!isCompleteStudentProfile(profile) || profile.must_complete_security_setup) {
    return NextResponse.json({ ok: false, error: "請先完成帳號安全設定。" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { response?: RegistrationResponseJSON } | null;
  if (!body?.response?.id) {
    return NextResponse.json({ ok: false, error: "生物辨識資料格式不正確。" }, { status: 400 });
  }

  try {
    const result = await verifyAndSavePasskeyRegistration({ request, profile, response: body.response });
    const response = result.verified
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, error: "生物辨識驗證未完成，請再試一次。" }, { status: 400 });
    clearPasskeyChallengeCookie(response);
    return response;
  } catch (error) {
    console.error("student passkey registration verification failed", error);
    const response = NextResponse.json({ ok: false, error: "生物辨識驗證失敗，請再試一次。" }, { status: 400 });
    clearPasskeyChallengeCookie(response);
    return response;
  }
}
