import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireStudentCheckinAdmin,
  studentCheckinAdminAuthFailure,
} from "../../../../../../../lib/student-checkin-admin-auth";
import { writeStudentMembershipPeriodAuditNonBlocking } from "../../../../../../../lib/student-membership-period-audit";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/admin";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  startsOn: dateSchema,
  expiresOn: dateSchema,
});

type MembershipPeriodRpcRow = {
  id: string;
  membership_starts_on: string;
  membership_expires_on: string;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStudentCheckinAdmin(request);
  if (!auth.ok) return studentCheckinAdminAuthFailure(auth.response.status);
  if (auth.context.role !== "student_checkin_admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const admin = createSupabaseAdminClient();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const attempted = {
    startsOn: typeof body?.startsOn === "string" ? body.startsOn : null,
    expiresOn: typeof body?.expiresOn === "string" ? body.expiresOn : null,
  };

  if (
    !parsed.success ||
    parsed.data.startsOn < "1900-01-01" ||
    parsed.data.expiresOn < parsed.data.startsOn
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
    return NextResponse.json({ ok: false, error: "Invalid membership period" }, { status: 400 });
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
    return NextResponse.json({ ok: false, error: "Unable to load student" }, { status: 500 });
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
    return NextResponse.json({ ok: false, error: "Student not found" }, { status: 404 });
  }

  const previous = {
    startsOn: current.data.membership_starts_on,
    expiresOn: current.data.membership_expires_on,
  };

  const result = await admin.rpc("update_student_checkin_membership_period", {
    p_student_profile_id: id,
    p_starts_on: parsed.data.startsOn,
    p_expires_on: parsed.data.expiresOn,
  });

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
    return NextResponse.json({ ok: false, error: "Unable to save membership period" }, { status: 500 });
  }

  const saved = (Array.isArray(result.data) ? result.data[0] : null) as MembershipPeriodRpcRow | null;
  if (!saved) {
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
    return NextResponse.json({ ok: false, error: "Unable to save membership period" }, { status: 409 });
  }

  await writeStudentMembershipPeriodAuditNonBlocking({
    supabase: admin,
    tenantId: auth.context.tenantId,
    actorId: auth.context.userId,
    actorRole: auth.context.role,
    studentProfileId: id,
    outcome: previous.startsOn || previous.expiresOn ? "updated" : "saved",
    attempted,
    previous,
  });

  return NextResponse.json({
    ok: true,
    startsOn: saved.membership_starts_on,
    expiresOn: saved.membership_expires_on,
    locked: true,
  });
}
