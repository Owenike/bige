import { NextResponse } from "next/server";
import { z } from "zod";
import { bigeFacilityClosedMessage, isBigeFacilityClosed } from "../../../../../../../lib/bige-business-day";
import {
  requireStudentCheckinAdmin,
  studentCheckinAdminAuthFailure,
} from "../../../../../../../lib/student-checkin-admin-auth";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/admin";

const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approved") }),
  z.object({
    decision: z.literal("rejected"),
    rejectionAction: z.enum(["general", "data_correction"]),
  }),
]);

function decisionError(message: string) {
  if (message.includes("STUDENT_ENTRY_BLOCKED")) return "此帳號已由內部設定為禁止入場。";
  if (message.includes("DROP_IN_REGISTRATION_REQUIRED")) return "會員尚未完成 50 元入場資料與條款同意，無法放行。";
  if (message.includes("PROFILE_PHOTO_REQUIRED")) return "請先拍攝本人照片，才能放行。";
  if (message.includes("REVIEW_PHOTO_REQUIRED")) return "請先上傳五星好評照片，才能放行。";
  if (message.includes("DROP_IN_USES_EXHAUSTED")) return "10 次 50 元入場資格已全部使用完畢。";
  if (message.includes("PROFILE_NOT_ACTIVE")) return "會員資料已停用，無法放行。";
  if (message.includes("REQUEST_NOT_FOUND")) return "這筆申請不存在。";
  if (message.includes("INVALID_REJECTION_ACTION")) return "請選擇一般拒絕或要求更正資料。";
  return "無法更新訪客入場狀態。";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStudentCheckinAdmin(request);
  if (!auth.ok) return studentCheckinAdminAuthFailure(auth.response.status);

  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "放行決定格式不正確。" }, { status: 400 });

  if (parsed.data.decision === "approved") {
    const facility = await isBigeFacilityClosed({});
    if (facility.closed) {
      return NextResponse.json(
        { ok: false, code: "facility_closed", error: bigeFacilityClosedMessage(facility.setting) },
        { status: 409 },
      );
    }
  }

  const { id } = await context.params;
  const result = await createSupabaseAdminClient().rpc("decide_student_drop_in_request_v2", {
    p_request_id: id,
    p_decision: parsed.data.decision,
    p_reviewed_by: auth.context.userId,
    p_rejection_action: parsed.data.decision === "rejected" ? parsed.data.rejectionAction : null,
  });
  if (result.error) {
    return NextResponse.json({ ok: false, error: decisionError(result.error.message) }, { status: 409 });
  }
  return NextResponse.json({ ok: true, result: result.data?.[0] || null });
}
