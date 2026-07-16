import { NextResponse } from "next/server";
import {
  createCheckinRequest,
  encouragementFor,
  isCompleteStudentProfile,
  loadApprovedCheckin,
  loadRecentCheckinRequest,
  loadStudentProfileById,
  readStudentAuthSession,
} from "../../../../lib/student-checkin";

async function requestPayload(profileId: string) {
  const profile = await loadStudentProfileById(profileId);
  if (!isCompleteStudentProfile(profile)) return null;
  const checkinRequest = await loadRecentCheckinRequest(profileId);
  if (!checkinRequest) return { profile, request: null, checkIn: null, encouragement: null };
  const checkIn = checkinRequest.status === "approved" ? await loadApprovedCheckin(checkinRequest.id) : null;
  return {
    profile: { id: profile.id, fullName: profile.full_name },
    request: checkinRequest,
    checkIn,
    encouragement: checkIn ? encouragementFor(profile.full_name, checkIn.month_sequence) : null,
  };
}

export async function GET() {
  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "請重新登入。" }, { status: 401 });
  const payload = await requestPayload(session.profileId);
  if (!payload) return NextResponse.json({ ok: false, error: "學員資料不完整。" }, { status: 409 });
  return NextResponse.json({ ok: true, ...payload });
}

export async function POST(request: Request) {
  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "請重新登入。" }, { status: 401 });
  const profile = await loadStudentProfileById(session.profileId);
  if (!isCompleteStudentProfile(profile)) {
    return NextResponse.json({ ok: false, error: "學員資料不完整。" }, { status: 409 });
  }

  const recent = await loadRecentCheckinRequest(profile.id);
  const checkinRequest = recent || (await createCheckinRequest({ profileId: profile.id, authMethod: session.authMethod, request }));
  const checkIn = checkinRequest.status === "approved" ? await loadApprovedCheckin(checkinRequest.id) : null;
  return NextResponse.json({
    ok: true,
    profile: { id: profile.id, fullName: profile.full_name },
    request: checkinRequest,
    checkIn,
    encouragement: checkIn ? encouragementFor(profile.full_name, checkIn.month_sequence) : null,
  });
}
