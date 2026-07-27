import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "../../../../../../../lib/auth-context";
import { writeStudentMembershipPeriodAuditNonBlocking } from "../../../../../../../lib/student-membership-period-audit";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/admin";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  startsOn: dateSchema,
  expiresOn: dateSchema,
});

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const { id } = await context.params;
  const admin = createSupabaseAdminClient();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const attempted = {
    startsOn: typeof body?.startsOn === "string" ? body.startsOn : null,
    expiresOn: typeof body?.expiresOn === "string" ? body.expiresOn : null,
  };
  if (
    !parsed.success
    || parsed.data.startsOn < "1900-01-01"
    || parsed.data.expiresOn < parsed.data.startsOn
  ) {
    await writeStudentMembershipPeriodAuditNonBlocking({
      supabase: admin,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      actorRole: auth.context.role,
      studentProfileId: id,
      outcome: "invalid",
      attempted,
    });
    return NextResponse.json({ ok: false, error: "請輸入正確的開始日期與結束日期。" }, { status: 400 });
  }

  const current = await admin
    .from("student_line_profiles")
    .select("id, membership_starts_on, membership_expires_on")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (current.error) {
    await writeStudentMembershipPeriodAuditNonBlocking({
      supabase: admin,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      actorRole: auth.context.role,
      studentProfileId: id,
      outcome: "database_error",
      attempted,
      error: current.error.message,
    });
    return NextResponse.json({ ok: false, error: "期限資料讀取失敗，請稍後再試。" }, { status: 500 });
  }
  if (!current.data) {
    await writeStudentMembershipPeriodAuditNonBlocking({
      supabase: admin,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      actorRole: auth.context.role,
      studentProfileId: id,
      outcome: "not_found",
      attempted,
    });
    return NextResponse.json({ ok: false, error: "找不到這位學員。" }, { status: 404 });
  }
  const previous = {
    startsOn: current.data.membership_starts_on,
    expiresOn: current.data.membership_expires_on,
  };
  if (current.data.membership_starts_on || current.data.membership_expires_on) {
    await writeStudentMembershipPeriodAuditNonBlocking({
      supabase: admin,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      actorRole: auth.context.role,
      studentProfileId: id,
      outcome: "already_locked",
      attempted,
      previous,
    });
    return NextResponse.json({ ok: false, error: "自主運動期限已儲存並鎖定，無法再次更改。" }, { status: 409 });
  }

  const result = await admin
    .from("student_line_profiles")
    .update({
      membership_starts_on: parsed.data.startsOn,
      membership_expires_on: parsed.data.expiresOn,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("is_active", true)
    .is("membership_starts_on", null)
    .is("membership_expires_on", null)
    .select("id, membership_starts_on, membership_expires_on")
    .maybeSingle();

  if (result.error) {
    await writeStudentMembershipPeriodAuditNonBlocking({
      supabase: admin,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      actorRole: auth.context.role,
      studentProfileId: id,
      outcome: "database_error",
      attempted,
      previous,
      error: result.error.message,
    });
    return NextResponse.json({ ok: false, error: "期限儲存失敗，請稍後再試。" }, { status: 500 });
  }
  if (!result.data) {
    await writeStudentMembershipPeriodAuditNonBlocking({
      supabase: admin,
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      actorRole: auth.context.role,
      studentProfileId: id,
      outcome: "conflict",
      attempted,
      previous,
    });
    return NextResponse.json({ ok: false, error: "自主運動期限已被設定，無法再次更改。" }, { status: 409 });
  }
  await writeStudentMembershipPeriodAuditNonBlocking({
    supabase: admin,
    tenantId: auth.context.tenantId,
    actorId: auth.context.userId,
    actorRole: auth.context.role,
    studentProfileId: id,
    outcome: "saved",
    attempted,
    previous,
  });
  return NextResponse.json({
    ok: true,
    startsOn: result.data.membership_starts_on,
    expiresOn: result.data.membership_expires_on,
    locked: true,
  });
}
