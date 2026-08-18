import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireStudentCheckinAdmin,
  studentCheckinAdminAuthFailure,
} from "../../../../../../lib/student-checkin-admin-auth";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";
import { studentMembershipPeriodStatus } from "../../../../../../lib/student-checkin";
import {
  evaluateStudentEntryAccess,
  studentEntryAccessDatabaseCode,
} from "../../../../../../lib/student-entry-access";

const decisionSchema = z.union([
  z.object({
    decision: z.literal("approved"),
    lockerKeyTaken: z.literal(false),
    lockerKeyNumber: z.null().optional(),
  }).strict(),
  z.object({
    decision: z.literal("approved"),
    lockerKeyTaken: z.literal(true),
    lockerKeyNumber: z.number().int().min(1).max(9999),
  }).strict(),
  z.object({ decision: z.literal("rejected") }).strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStudentCheckinAdmin(request);
  if (!auth.ok) return studentCheckinAdminAuthFailure(auth.response.status);

  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "報到處理方式不正確。" }, { status: 400 });

  const { id } = await context.params;
  const admin = createSupabaseAdminClient();
  if (parsed.data.decision === "approved") {
    const requestRow = await admin
      .from("student_checkin_requests")
      .select("student_profile_id")
      .eq("id", id)
      .eq("status", "pending")
      .maybeSingle();
    if (requestRow.error || !requestRow.data) {
      return NextResponse.json({ ok: false, error: "這筆報到已處理或不存在。" }, { status: 409 });
    }
    const profile = await admin
      .from("student_line_profiles")
      .select("photo_path, membership_starts_on, membership_expires_on, autonomous_checkin_enabled")
      .eq("id", requestRow.data.student_profile_id)
      .maybeSingle();
    if (profile.error || !profile.data) {
      return NextResponse.json({ ok: false, error: "找不到學員資料。" }, { status: 409 });
    }
    const access = await evaluateStudentEntryAccess({
      studentProfileId: requestRow.data.student_profile_id,
      mode: "autonomous",
      autonomousEnabled: profile.data.autonomous_checkin_enabled,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: access.code === "account_unavailable"
            ? "此帳號已由內部設定為禁止入場。"
            : access.code === "not_official_member"
              ? "此帳號不是本館正式學員，無法核准自主訓練。"
              : "此帳號沒有學生自主訓練資格。",
        },
        { status: 409 },
      );
    }
    if (!profile.data.photo_path) {
      return NextResponse.json({ ok: false, error: "請先建立並確認本人照片，才能放行。" }, { status: 409 });
    }
    const periodStatus = studentMembershipPeriodStatus(profile.data);
    if (periodStatus !== "active") {
      return NextResponse.json({
        ok: false,
        error: periodStatus === "not_started"
          ? "學員的自主運動期限尚未開始，現在無法放行。"
          : "學員的自主運動期限已到期，現在無法放行。",
      }, { status: 409 });
    }
  }

  const result = await admin.rpc("decide_student_checkin_request_v2", {
    p_request_id: id,
    p_decision: parsed.data.decision,
    p_reviewed_by: auth.context.role === "student_checkin_admin" ? null : auth.context.userId,
    p_locker_key_taken: parsed.data.decision === "approved" ? parsed.data.lockerKeyTaken : null,
    p_locker_key_number: parsed.data.decision === "approved" && parsed.data.lockerKeyTaken
      ? parsed.data.lockerKeyNumber
      : null,
  });
  if (result.error) {
    const accessCode = studentEntryAccessDatabaseCode(result.error.message);
    const error = accessCode === "account_unavailable"
      ? "此帳號已由內部設定為禁止入場。"
      : accessCode === "not_official_member"
        ? "此帳號不是本館正式學員，無法核准自主訓練。"
        : "無法更新自主訓練報到狀態。";
    return NextResponse.json({ ok: false, error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, result: result.data?.[0] || null });
}
