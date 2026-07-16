import { NextResponse } from "next/server";
import { loadStudentProfile, readStudentLineSession } from "../../../../lib/student-checkin";

export async function GET() {
  const session = await readStudentLineSession();
  if (!session) return NextResponse.json({ ok: true, authenticated: false });

  const profile = await loadStudentProfile(session.lineUserId);
  return NextResponse.json({
    ok: true,
    authenticated: true,
    lineDisplayName: session.lineDisplayName,
    profile,
  });
}
