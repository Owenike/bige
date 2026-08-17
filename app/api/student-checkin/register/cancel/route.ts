import { NextResponse } from "next/server";
import {
  cancelStudentEmailVerification,
  clearPendingStudentRegistrationCookie,
  readPendingStudentRegistrationId,
} from "../../../../../lib/student-checkin-email-verification";

export async function POST() {
  const registrationId = await readPendingStudentRegistrationId();
  if (registrationId) {
    await cancelStudentEmailVerification(registrationId).catch(() => null);
  }

  const response = NextResponse.json({ ok: true });
  clearPendingStudentRegistrationCookie(response);
  return response;
}
