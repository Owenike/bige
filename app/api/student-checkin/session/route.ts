import { NextResponse } from "next/server";
import {
  isCompleteStudentProfile,
  loadRecentCheckinRequest,
  loadStudentProfileById,
  loadStudentProfileByLine,
  readStudentAuthSession,
  readStudentLineSession,
  setStudentAuthSession,
} from "../../../../lib/student-checkin";

function publicProfile(profile: Awaited<ReturnType<typeof loadStudentProfileById>>) {
  if (!profile) return null;
  return {
    id: profile.id,
    fullName: profile.full_name,
    phone: profile.phone,
    birthDate: profile.birth_date,
    lineDisplayName: profile.line_display_name,
  };
}

export async function GET() {
  const authSession = await readStudentAuthSession();
  if (authSession) {
    const profile = await loadStudentProfileById(authSession.profileId);
    if (isCompleteStudentProfile(profile)) {
      const request = await loadRecentCheckinRequest(profile.id);
      return NextResponse.json({
        ok: true,
        authenticated: true,
        authMethod: authSession.authMethod,
        profile: publicProfile(profile),
        request,
      });
    }
  }

  const lineSession = await readStudentLineSession();
  if (!lineSession) return NextResponse.json({ ok: true, authenticated: false });

  const profile = await loadStudentProfileByLine(lineSession.lineUserId);
  if (!isCompleteStudentProfile(profile)) {
    return NextResponse.json({
      ok: true,
      authenticated: true,
      authMethod: "line",
      needsProfile: true,
      lineDisplayName: lineSession.lineDisplayName,
    });
  }

  const request = await loadRecentCheckinRequest(profile.id);
  const response = NextResponse.json({
    ok: true,
    authenticated: true,
    authMethod: "line",
    profile: publicProfile(profile),
    request,
  });
  setStudentAuthSession(response, profile.id, "line");
  return response;
}
