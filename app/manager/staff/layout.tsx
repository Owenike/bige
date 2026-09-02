import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireStaffAccountAdministrator } from "../../../lib/staff-account-admin";

export default async function ManagerStaffLayout(props: { children: ReactNode }) {
  const auth = await requireStaffAccountAdministrator();
  if (!auth.ok) {
    redirect(
      auth.response.status === 401
        ? "/login/staff?returnTo=/manager/staff"
        : "/forbidden?code=FORBIDDEN",
    );
  }

  return <>{props.children}</>;
}
