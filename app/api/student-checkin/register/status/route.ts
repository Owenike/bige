import { NextResponse } from "next/server";
import {
  loadStudentEmailVerificationById,
  readPendingStudentRegistrationId,
} from "../../../../../lib/student-checkin-email-verification";

export async function GET() {
  const registrationId = await readPendingStudentRegistrationId();
  if (!registrationId) return NextResponse.json({ ok: true, pending: false });

  const registration = await loadStudentEmailVerificationById(registrationId);
  if (!registration || registration.status === "cancelled") {
    return NextResponse.json({ ok: true, pending: false });
  }

  return NextResponse.json({
    ok: true,
    pending: registration.status === "pending" || registration.status === "verifying",
    completed: registration.status === "completed",
    email: registration.email,
    expiresAt: registration.expires_at,
    entryMode: registration.entry_mode,
  });
}
