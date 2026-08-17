import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { NextRequest, NextResponse } from "next/server";
import {
  isCompleteStudentProfile,
  loadStudentProfileById,
  setStudentAuthSession,
} from "../../../../../../lib/student-checkin";
import {
  clearPasskeyChallengeCookie,
  verifyPasskeyAuthentication,
} from "../../../../../../lib/student-checkin-passkeys";
import { recordSystemAuditEvent } from "../../../../../../lib/system-audit";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { response?: AuthenticationResponseJSON } | null;
  let profileId: string | null = null;
  const auditLogin = async (status: number, reason: string, outcome: "success" | "failure" | "denied" = "failure") =>
    recordSystemAuditEvent({
      request,
      accountType: "student",
      accountIdentifier: body?.response?.id || null,
      eventCategory: "authentication",
      action: "auth.student_login",
      outcome,
      targetType: profileId ? "student_line_profile" : null,
      targetId: profileId,
      reason,
      metadata: { statusCode: status, authMethod: "passkey" },
    });
  if (!body?.response?.id) {
    await auditLogin(400, "passkey_response_required");
    return NextResponse.json({ ok: false, error: "生物辨識資料格式不正確。" }, { status: 400 });
  }

  try {
    const verified = await verifyPasskeyAuthentication({ request, response: body.response });
    if (!verified.verified) {
      const response = NextResponse.json(
        { ok: false, error: "找不到此裝置的生物辨識登入資料，請改用手機與密碼登入。" },
        { status: 401 },
      );
      clearPasskeyChallengeCookie(response);
      await auditLogin(401, "passkey_verification_failed");
      return response;
    }
    profileId = verified.profileId;

    const profile = await loadStudentProfileById(verified.profileId);
    if (!isCompleteStudentProfile(profile) || profile.must_complete_security_setup) {
      const response = NextResponse.json({ ok: false, error: "請先使用手機與密碼完成帳號安全設定。" }, { status: 403 });
      clearPasskeyChallengeCookie(response);
      await auditLogin(403, "student_profile_incomplete", "denied");
      return response;
    }
    const response = NextResponse.json({
      ok: true,
      authenticated: true,
      profile: { id: profile.id, fullName: profile.full_name },
    });
    setStudentAuthSession(response, profile.id, "passkey");
    clearPasskeyChallengeCookie(response);
    await auditLogin(200, "passkey_login", "success");
    return response;
  } catch (error) {
    console.error("student passkey authentication verification failed", error);
    const response = NextResponse.json(
      { ok: false, error: "生物辨識登入失敗，請改用手機與密碼登入。" },
      { status: 401 },
    );
    clearPasskeyChallengeCookie(response);
    await auditLogin(401, "passkey_authentication_error");
    return response;
  }
}
