import { NextResponse } from "next/server";
import { bigeFacilityClosedMessage, isBigeFacilityClosed } from "../../../../lib/bige-business-day";
import {
  createCheckinRequest,
  encouragementFor,
  isCompleteStudentProfile,
  loadApprovedCheckin,
  loadRecentCheckinRequest,
  loadStudentProfileById,
  readStudentAuthSession,
  studentMembershipPeriodStatus,
} from "../../../../lib/student-checkin";
import {
  evaluateStudentEntryAccess,
  studentEntryAccessDatabaseCode,
  studentEntryAccessPublicError,
} from "../../../../lib/student-entry-access";

function entryAccessErrorResponse(code: Parameters<typeof studentEntryAccessPublicError>[0]) {
  const publicError = studentEntryAccessPublicError(code);
  return publicError
    ? NextResponse.json({ ok: false, ...publicError }, { status: 403 })
    : NextResponse.json({ ok: false, error: "無法確認入場資格，請洽現場人員。" }, { status: 403 });
}

async function requestPayload(profileId: string) {
  const profile = await loadStudentProfileById(profileId);
  if (!isCompleteStudentProfile(profile)) return null;
  if (profile.must_complete_security_setup) return { securitySetupRequired: true as const };
  const access = await evaluateStudentEntryAccess({
    studentProfileId: profile.id,
    mode: "autonomous",
    autonomousEnabled: profile.autonomous_checkin_enabled,
  });
  if (!access.allowed) return { entryAccessCode: access.code };
  const periodStatus = studentMembershipPeriodStatus(profile);
  if (periodStatus !== "active") {
    return {
      unavailable: true as const,
      periodStatus,
      startsOn: profile.membership_starts_on,
      expiresOn: profile.membership_expires_on,
    };
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
  const facility = await isBigeFacilityClosed({});
  if (facility.closed) {
    return NextResponse.json(
      { ok: false, code: "facility_closed", error: bigeFacilityClosedMessage(facility.setting) },
      { status: 409 },
    );
  }

  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "請重新登入。" }, { status: 401 });
  const payload = await requestPayload(session.profileId);
  if (!payload) return NextResponse.json({ ok: false, error: "學員資料不完整。" }, { status: 409 });
  if ("securitySetupRequired" in payload) {
    return NextResponse.json(
      { ok: false, code: "security_setup_required", error: "請先完成新密碼、Email 與信箱驗證。" },
      { status: 403 },
    );
  }
  if ("entryAccessCode" in payload && payload.entryAccessCode) {
    return entryAccessErrorResponse(payload.entryAccessCode);
  }
  if ("unavailable" in payload) {
    return NextResponse.json(
      {
        ok: false,
        code: payload.periodStatus === "not_started" ? "membership_not_started" : "membership_expired",
        error: payload.periodStatus === "not_started"
          ? "自主運動期限尚未開始，請依後台設定的開始日期再來報到。"
          : "自主運動期限已到期，請洽現場人員協助。",
        startsOn: payload.startsOn,
        expiresOn: payload.expiresOn,
      },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true, ...payload });
}

export async function POST(request: Request) {
  const facility = await isBigeFacilityClosed({});
  if (facility.closed) {
    return NextResponse.json(
      { ok: false, code: "facility_closed", error: bigeFacilityClosedMessage(facility.setting) },
      { status: 409 },
    );
  }

  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "請重新登入。" }, { status: 401 });
  const profile = await loadStudentProfileById(session.profileId);
  if (!isCompleteStudentProfile(profile)) {
    return NextResponse.json({ ok: false, error: "學員資料不完整。" }, { status: 409 });
  }
  if (profile.must_complete_security_setup) {
    return NextResponse.json(
      { ok: false, code: "security_setup_required", error: "請先完成新密碼、Email 與信箱驗證。" },
      { status: 403 },
    );
  }
  const access = await evaluateStudentEntryAccess({
    studentProfileId: profile.id,
    mode: "autonomous",
    autonomousEnabled: profile.autonomous_checkin_enabled,
  });
  if (!access.allowed) return entryAccessErrorResponse(access.code);
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

  let checkinRequest;
  try {
    checkinRequest = await createCheckinRequest({ profileId: profile.id, authMethod: session.authMethod, request });
  } catch (error) {
    const accessCode = studentEntryAccessDatabaseCode(error);
    if (accessCode) return entryAccessErrorResponse(accessCode);
    throw error;
  }
  const checkIn = checkinRequest.status === "approved" ? await loadApprovedCheckin(checkinRequest.id) : null;
  return NextResponse.json({
    ok: true,
    profile: { id: profile.id, fullName: profile.full_name },
    request: checkinRequest,
    checkIn,
    encouragement: checkIn ? encouragementFor(profile.full_name, checkIn.month_sequence) : null,
  });
}
