import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);

  if (!auth.ok) {
    const url = new URL(auth.response.status === 401 ? "/login/staff" : "/forbidden", request.url);
    if (auth.response.status === 401) url.searchParams.set("returnTo", "/staff/fitness");
    return NextResponse.redirect(url);
  }

  const destination = auth.context.role === "frontdesk" ? "/frontdesk/fitness" : "/manager/fitness";
  return NextResponse.redirect(new URL(destination, request.url));
}
