import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "../../../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

const decisionSchema = z.object({ decision: z.enum(["approved", "rejected"]) });

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

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
      .select("photo_path")
      .eq("id", requestRow.data.student_profile_id)
      .maybeSingle();
    if (profile.error || !profile.data?.photo_path) {
      return NextResponse.json({ ok: false, error: "請先建立並確認本人照片，才能放行。" }, { status: 409 });
    }
  }

  const result = await admin.rpc("decide_student_checkin_request", {
    p_request_id: id,
    p_decision: parsed.data.decision,
    p_reviewed_by: auth.context.userId,
  });
  if (result.error) return NextResponse.json({ ok: false, error: result.error.message }, { status: 409 });
  return NextResponse.json({ ok: true, result: result.data?.[0] || null });
}
