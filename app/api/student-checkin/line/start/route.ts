import crypto from "crypto";
import { appOrigin, STUDENT_LINE_STATE_COOKIE } from "../../../../../lib/student-checkin";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const origin = appOrigin(request);
  if (!channelId) {
    return NextResponse.redirect(`${origin}/check-in?error=line_env`);
  }

  const state = crypto.randomBytes(24).toString("base64url");
  const authorizeUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", channelId);
  authorizeUrl.searchParams.set("redirect_uri", `${origin}/api/student-checkin/line/callback`);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "profile");
  authorizeUrl.searchParams.set("bot_prompt", "normal");

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STUDENT_LINE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
