import { NextResponse } from "next/server";
import {
  clearStudentAuthSession,
  clearStudentLineSession,
  readStudentAuthSession,
} from "../../../../lib/student-checkin";
import { recordSystemAuditEvent } from "../../../../lib/system-audit";

export async function POST(request: Request) {
  const session = await readStudentAuthSession();
  const response = NextResponse.json({ ok: true });
  clearStudentAuthSession(response);
  clearStudentLineSession(response);
  await recordSystemAuditEvent({
    request,
    accountType: "student",
    eventCategory: "authentication",
    action: "auth.student_logout",
    outcome: "success",
    targetType: session?.profileId ? "student_line_profile" : null,
    targetId: session?.profileId || null,
    reason: session?.profileId ? "user_requested_logout" : "no_authenticated_student",
    metadata: { authMethod: session?.authMethod || null },
  });
  return response;
}
