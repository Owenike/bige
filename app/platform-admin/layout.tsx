import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireProfile } from "../../lib/auth-context";

export default async function PlatformAdminLayout(props: { children: ReactNode }) {
  const auth = await requireProfile(["platform_admin"]);
  if (!auth.ok) {
    redirect(auth.response.status === 401 ? "/login?tab=staff&returnTo=/platform-admin" : "/");
  }

  return <>{props.children}</>;
}
