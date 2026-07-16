import { NextResponse } from "next/server";
import { clearStudentAuthSession, clearStudentLineSession } from "../../../../lib/student-checkin";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearStudentAuthSession(response);
  clearStudentLineSession(response);
  return response;
}
