import { redirect } from "next/navigation";

type LegacyLoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isStudentCheckInAdminReturn(value: string | undefined) {
  return value === "/admin/student-check-ins" || Boolean(value?.startsWith("/admin/student-check-ins?"));
}

export default async function LegacyLoginPage({ searchParams }: LegacyLoginPageProps) {
  const params = await searchParams;
  const tab = firstValue(params.tab);
  const returnTo = firstValue(params.returnTo);
  const redirectTo = firstValue(params.redirect);
  const next = firstValue(params.next);
  if (isStudentCheckInAdminReturn(returnTo) || isStudentCheckInAdminReturn(redirectTo) || isStudentCheckInAdminReturn(next)) {
    redirect("/admin/student-check-ins/login?returnTo=/admin/student-check-ins");
  }

  const destination = tab === "member" || tab === "activation" ? "/login/member" : "/login/staff";
  const nextParams = new URLSearchParams();

  for (const key of ["returnTo", "redirect", "next", "embed"] as const) {
    const value = firstValue(params[key]);
    if (value) nextParams.set(key, value);
  }
  if (tab === "activation") nextParams.set("tab", "activation");

  const query = nextParams.toString();
  redirect(query ? `${destination}?${query}` : destination);
}
