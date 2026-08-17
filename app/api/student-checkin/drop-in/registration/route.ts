import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import {
  ensureStudentDropInEntitlement,
  publicStudentDropInRegistration,
} from "../../../../../lib/student-drop-in";
import {
  hasCurrentStudentDropInTermsAcceptance,
  STUDENT_DROP_IN_ACTIVITY_INTERESTS,
  STUDENT_DROP_IN_GENDERS,
} from "../../../../../lib/student-drop-in-registration";
import {
  isCompleteStudentProfile,
  loadStudentProfileById,
  readStudentAuthSession,
} from "../../../../../lib/student-checkin";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const registrationSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invoiceCarrier: z.string().trim().min(1).max(80),
  gender: z.enum(STUDENT_DROP_IN_GENDERS),
  activityInterest: z.enum(STUDENT_DROP_IN_ACTIVITY_INTERESTS),
  discoverySource: z.string().trim().min(1).max(200),
  termsAccepted: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const session = await readStudentAuthSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "請先登入會員帳號。" }, { status: 401 });
  }

  const profile = await loadStudentProfileById(session.profileId);
  if (!isCompleteStudentProfile(profile)) {
    return NextResponse.json({ ok: false, error: "會員資料不完整，請洽現場工作人員。" }, { status: 409 });
  }
  if (profile.must_complete_security_setup) {
    return NextResponse.json(
      { ok: false, code: "security_setup_required", error: "請先完成帳號安全設定。" },
      { status: 403 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimitFixedWindow({
    key: `student-drop-in-registration:${profile.id}:${ip}`,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "資料更新次數過多，請稍後再試或洽現場工作人員。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "請完整填寫姓名、生日、載具、性別、感興趣的運動、得知來源，並同意會員條款。" },
      { status: 400 },
    );
  }

  const entitlement = await ensureStudentDropInEntitlement(profile.id);
  const existingRegistration = publicStudentDropInRegistration(entitlement);
  if (existingRegistration.complete) {
    return NextResponse.json({ ok: true, registration: existingRegistration });
  }
  const canReuseTermsAcceptance =
    existingRegistration.correctionRequired &&
    hasCurrentStudentDropInTermsAcceptance(entitlement);
  if (!canReuseTermsAcceptance && !parsed.data.termsAccepted) {
    return NextResponse.json(
      { ok: false, error: "請閱讀並勾選同意會員條款。" },
      { status: 400 },
    );
  }

  const saved = await createSupabaseAdminClient().rpc("save_student_drop_in_registration", {
    p_student_profile_id: profile.id,
    p_full_name: parsed.data.fullName,
    p_birth_date: parsed.data.birthDate,
    p_invoice_carrier: parsed.data.invoiceCarrier,
    p_gender: parsed.data.gender,
    p_activity_interest: parsed.data.activityInterest,
    p_discovery_source: parsed.data.discoverySource,
  });

  const savedRegistration = saved.data?.[0];
  if (saved.error || !savedRegistration) {
    return NextResponse.json({ ok: false, error: "50 元入場資料儲存失敗，請稍後再試。" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    profile: {
      id: profile.id,
      fullName: parsed.data.fullName,
      birthDate: parsed.data.birthDate,
    },
    registration: publicStudentDropInRegistration(savedRegistration),
  });
}
