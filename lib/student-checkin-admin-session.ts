export const STUDENT_CHECKIN_ADMIN_COOKIE_NAME = "bige-student-checkin-admin-auth";

export function studentCheckinAdminCookieCandidates() {
  return [STUDENT_CHECKIN_ADMIN_COOKIE_NAME, undefined] as const;
}
