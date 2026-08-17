import { NextResponse } from "next/server";
import { bigeFacilityClosedMessage, isBigeFacilityClosed } from "../../../../../lib/bige-business-day";
import {
  createStudentDropInRequest,
  ensureStudentDropInEntitlement,
  loadApprovedStudentDropIn,
  loadRecentStudentDropInRequest,
  publicStudentDropInRegistration,
  remainingStudentDropInUses,
} from "../../../../../lib/student-drop-in";
import { studentDropInPlanDetails } from "../../../../../lib/student-drop-in-plan";
import {
  isCompleteStudentProfile,
  loadStudentProfileById,
  readStudentAuthSession,
} from "../../../../../lib/student-checkin";
import {
  evaluateStudentEntryAccess,
  studentEntryAccessDatabaseCode,
  studentEntryAccessPublicError,
} from "../../../../../lib/student-entry-access";

function entryAccessErrorResponse(code: Parameters<typeof studentEntryAccessPublicError>[0]) {
  const publicError = studentEntryAccessPublicError(code);
  return publicError
    ? NextResponse.json({ ok: false, ...publicError }, { status: 403 })
    : NextResponse.json({ ok: false, error: "無法確認入場資格，請洽現場人員。" }, { status: 403 });
}

async function loadRequestPayload(profileId: string) {
  const [profile, entitlement, request] = await Promise.all([
    loadStudentProfileById(profileId),
    ensureStudentDropInEntitlement(profileId),
    loadRecentStudentDropInRequest(profileId),
  ]);
  if (!isCompleteStudentProfile(profile)) return null;
  const access = await evaluateStudentEntryAccess({
    studentProfileId: profile.id,
    mode: "drop_in",
    autonomousEnabled: profile.autonomous_checkin_enabled,
  });
  const dropInCheckIn = request?.status === "approved" ? await loadApprovedStudentDropIn(request.id) : null;
  const plan = studentDropInPlanDetails(entitlement.entry_plan);
  return {
    profile: { id: profile.id, fullName: profile.full_name },
    request,
    dropInCheckIn,
    totalUses: entitlement.total_uses,
    remainingUses: dropInCheckIn?.remaining_uses ?? remainingStudentDropInUses(entitlement),
    entryPlan: entitlement.entry_plan,
    priceTwd: plan.priceTwd,
    reviewPhotoRequired: plan.reviewPhotoRequired,
    unlimitedUses: plan.unlimitedUses,
    registration: publicStudentDropInRegistration(entitlement),
    entryAccessCode: access.code,
  };
}

async function rejectWhenClosed() {
  const facility = await isBigeFacilityClosed({});
  if (!facility.closed) return null;
  return NextResponse.json(
    { ok: false, code: "facility_closed", error: bigeFacilityClosedMessage(facility.setting) },
    { status: 409 },
  );
}

export async function GET() {
  const closedResponse = await rejectWhenClosed();
  if (closedResponse) return closedResponse;

  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "請重新登入。" }, { status: 401 });
  const payload = await loadRequestPayload(session.profileId);
  if (!payload) return NextResponse.json({ ok: false, error: "會員資料不完整。" }, { status: 409 });
  if (payload.entryAccessCode !== "allowed") return entryAccessErrorResponse(payload.entryAccessCode);
  if (payload.remainingUses !== null && payload.remainingUses <= 0 && payload.request?.status !== "approved") {
    return NextResponse.json(
      { ok: false, code: "drop_in_uses_exhausted", error: "10 次 50 元入場資格已全部使用完畢。", ...payload },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true, ...payload });
}

export async function POST(request: Request) {
  const closedResponse = await rejectWhenClosed();
  if (closedResponse) return closedResponse;

  const session = await readStudentAuthSession();
  if (!session) return NextResponse.json({ ok: false, error: "請重新登入。" }, { status: 401 });
  const profile = await loadStudentProfileById(session.profileId);
  if (!isCompleteStudentProfile(profile)) {
    return NextResponse.json({ ok: false, error: "會員資料不完整。" }, { status: 409 });
  }
  const access = await evaluateStudentEntryAccess({
    studentProfileId: profile.id,
    mode: "drop_in",
    autonomousEnabled: profile.autonomous_checkin_enabled,
  });
  if (!access.allowed) return entryAccessErrorResponse(access.code);
  const entitlement = await ensureStudentDropInEntitlement(profile.id);
  if (!publicStudentDropInRegistration(entitlement).complete) {
    return NextResponse.json(
      { ok: false, code: "drop_in_registration_required", error: "請先完成 50 元入場的兩頁資料與會員條款。" },
      { status: 403 },
    );
  }
  if (profile.must_complete_security_setup) {
    return NextResponse.json(
      { ok: false, code: "security_setup_required", error: "請先完成帳號安全設定。" },
      { status: 403 },
    );
  }

  try {
    const checkinRequest = await createStudentDropInRequest({
      profileId: profile.id,
      authMethod: session.authMethod === "passkey" ? "passkey" : "phone",
      request,
    });
    const payload = await loadRequestPayload(profile.id);
    if (!payload) return NextResponse.json({ ok: false, error: "會員資料不完整。" }, { status: 409 });
    return NextResponse.json({ ok: true, ...payload, request: checkinRequest });
  } catch (error) {
    const accessCode = studentEntryAccessDatabaseCode(error);
    if (accessCode) return entryAccessErrorResponse(accessCode);
    if (error instanceof Error && error.message === "DROP_IN_USES_EXHAUSTED") {
      return NextResponse.json(
        { ok: false, code: "drop_in_uses_exhausted", error: "10 次 50 元入場資格已全部使用完畢。" },
        { status: 403 },
      );
    }
    if (error instanceof Error && error.message === "DROP_IN_REGISTRATION_REQUIRED") {
      return NextResponse.json(
        { ok: false, code: "drop_in_registration_required", error: "請先完成 50 元入場的兩頁資料與會員條款。" },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: false, error: "無法送出 50 元入場申請，請稍後再試。" }, { status: 500 });
  }
}
