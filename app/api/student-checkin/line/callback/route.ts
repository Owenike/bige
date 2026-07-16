import { NextResponse } from "next/server";
import {
  appOrigin,
  createStudentLineSessionCookie,
  setStudentLineSession,
  STUDENT_LINE_STATE_COOKIE,
} from "../../../../../lib/student-checkin";

type LineProfile = {
  userId?: string;
  displayName?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STUDENT_LINE_STATE_COOKIE}=`))
    ?.split("=")[1];

  if (!code || !state || !cookieState || state !== decodeURIComponent(cookieState)) {
    return NextResponse.redirect(`${appOrigin(request)}/check-in?error=line_state`);
  }

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  if (!channelId || !channelSecret) {
    return NextResponse.redirect(`${appOrigin(request)}/check-in?error=line_env`);
  }

  const origin = appOrigin(request);
  const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/api/student-checkin/line/callback`,
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(`${origin}/check-in?error=line_token`);
  }

  const tokenPayload = (await tokenResponse.json().catch(() => null)) as { access_token?: string } | null;
  if (!tokenPayload?.access_token) {
    return NextResponse.redirect(`${origin}/check-in?error=line_token`);
  }

  const profileResponse = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
  });
  if (!profileResponse.ok) {
    return NextResponse.redirect(`${origin}/check-in?error=line_profile`);
  }

  const profile = (await profileResponse.json().catch(() => null)) as LineProfile | null;
  if (!profile?.userId) {
    return NextResponse.redirect(`${origin}/check-in?error=line_profile`);
  }

  const response = NextResponse.redirect(`${origin}/check-in`);
  response.cookies.delete(STUDENT_LINE_STATE_COOKIE);
  setStudentLineSession(
    response,
    createStudentLineSessionCookie({
      lineUserId: profile.userId,
      lineDisplayName: profile.displayName || null,
    }),
  );
  return response;
}
