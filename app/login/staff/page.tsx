import { redirect } from "next/navigation";
import LoginPortalPage from "../login-portal";

type StaffLoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isStudentCheckInAdminReturn(value: string | undefined) {
  return value === "/admin/student-check-ins" || Boolean(value?.startsWith("/admin/student-check-ins?"));
}

export default async function StaffLoginPage({ searchParams }: StaffLoginPageProps) {
  const params = await searchParams;
  const returnTo = firstValue(params.returnTo);
  const redirectTo = firstValue(params.redirect);
  const next = firstValue(params.next);

  if (isStudentCheckInAdminReturn(returnTo) || isStudentCheckInAdminReturn(redirectTo) || isStudentCheckInAdminReturn(next)) {
    redirect("/admin/student-check-ins/login?returnTo=/admin/student-check-ins");
  }

  return <LoginPortalPage portal="staff" />;
}
