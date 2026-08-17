import { NextRequest, NextResponse } from "next/server";
import { rateLimitFixedWindow } from "../../../../../../lib/rate-limit";
import {
  attachPasskeyChallengeCookie,
  createPasskeyAuthenticationOptions,
} from "../../../../../../lib/student-checkin-passkeys";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimitFixedWindow({
    key: `student-passkey-auth:${ip}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "操作過於頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  try {
    const { options, challengeId } = await createPasskeyAuthenticationOptions(request);
    const response = NextResponse.json({ ok: true, options });
    attachPasskeyChallengeCookie(response, challengeId);
    return response;
  } catch (error) {
    console.error("student passkey authentication options failed", error);
    return NextResponse.json({ ok: false, error: "目前無法使用生物辨識，請稍後再試。" }, { status: 500 });
  }
}
