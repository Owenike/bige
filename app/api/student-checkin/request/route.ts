import { NextResponse } from "next/server";
import {
  createCheckinRequest,
  encouragementFor,
  isCompleteStudentProfile,
  isStudentMembershipExpired,
  loadApprovedCheckin,
  loadRecentCheckinRequest,
  loadStudentProfileById,
  readStudentAuthSession,
} from "../../../../lib/student-checkin";

async function requestPayload(profileId: string) {
  const profile = await loadStudentProfileById(profileId);
  if (!isCompleteStudentProfile(profile)) return null;
  if (isStudentMembershipExpired(profile)) {
    return { expired: true as const, expiresOn: profile.membership_expires_on };
  }
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
  if ("expired" in payload) {
    return NextResponse.json(
      { ok: false, code: "membership_expired", error: "自主運動期限已到期，請洽現場人員協助續期。", expiresOn: payload.expiresOn },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true, ...payload });
}

export async function POST(request: Request) {
  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "請重新登入。" }, { status: 401 });
  const profile = await loadStudentProfileById(session.profileId);
  if (!isCompleteStudentProfile(profile)) {
    return NextResponse.json({ ok: false, error: "學員資料不完整。" }, { status: 409 });
  }
  if (isStudentMembershipExpired(profile)) {
    return NextResponse.json(
      { ok: false, code: "membership_expired", error: "自主運動期限已到期，請洽現場人員協助續期。", expiresOn: profile.membership_expires_on },
      { status: 403 },
    );
  }

  const checkinRequest = await createCheckinRequest({ profileId: profile.id, authMethod: session.authMethod, request });
  const checkIn = checkinRequest.status === "approved" ? await loadApprovedCheckin(checkinRequest.id) : null;
  return NextResponse.json({
    ok: true,
    profile: { id: profile.id, fullName: profile.full_name },
    request: checkinRequest,
    checkIn,
    encouragement: checkIn ? encouragementFor(profile.full_name, checkIn.month_sequence) : null,
  });
}
