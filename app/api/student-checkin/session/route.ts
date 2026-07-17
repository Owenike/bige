import { NextResponse } from "next/server";
import {
  isCompleteStudentProfile,
  loadPendingCheckinRequest,
  loadStudentProfileById,
  readStudentAuthSession,
  studentMembershipPeriodStatus,
} from "../../../../lib/student-checkin";

function publicProfile(profile: Awaited<ReturnType<typeof loadStudentProfileById>>) {
  if (!profile) return null;
  return {
    id: profile.id,
    fullName: profile.full_name,
    phone: profile.phone,
    birthDate: profile.birth_date,
  };
}

export async function GET() {
  const authSession = await readStudentAuthSession();
  if (authSession?.authMethod === "phone") {
    const profile = await loadStudentProfileById(authSession.profileId);
    if (isCompleteStudentProfile(profile)) {
      const periodStatus = studentMembershipPeriodStatus(profile);
      if (periodStatus !== "active") {
        return NextResponse.json({
          ok: false,
          authenticated: false,
          code: periodStatus === "not_started" ? "membership_not_started" : "membership_expired",
          error: periodStatus === "not_started"
            ? "自主運動期限尚未開始，請依後台設定的開始日期再來報到。"
            : "自主運動期限已到期，請洽現場人員協助。",
          startsOn: profile.membership_starts_on,
          expiresOn: profile.membership_expires_on,
          profile: publicProfile(profile),
        }, { status: 403 });
      }
      const request = await loadPendingCheckinRequest(profile.id);
      return NextResponse.json({
        ok: true,
        authenticated: true,
        authMethod: authSession.authMethod,
        profile: publicProfile(profile),
        request,
      });
    }
  }
  return NextResponse.json({ ok: true, authenticated: false });
}
