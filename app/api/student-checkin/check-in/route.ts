import { NextResponse } from "next/server";
import {
  encouragementFor,
  loadStudentProfile,
  readStudentLineSession,
  recordStudentCheckin,
} from "../../../../lib/student-checkin";

export async function POST(request: Request) {
  const session = await readStudentLineSession();
  if (!session) return NextResponse.json({ ok: false, error: "LINE_LOGIN_REQUIRED" }, { status: 401 });

  const profile = await loadStudentProfile(session.lineUserId);
  if (!profile) {
    return NextResponse.json({ ok: true, needsProfile: true, lineDisplayName: session.lineDisplayName });
  }

  const result = await recordStudentCheckin({ profile, request });
  return NextResponse.json({
    ok: true,
    profile: result.profile,
    checkIn: result.checkIn,
    reused: result.reused,
    encouragement: encouragementFor(result.profile.full_name, result.checkIn.month_sequence),
  });
}
