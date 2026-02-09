import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { httpLogBase, logEvent } from "../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";

export async function POST(request: Request) {
  const t0 = Date.now();
  const base = httpLogBase(request);
  const ip = base.ip || "unknown";

  const rl = rateLimitFixedWindow({
    key: `login:${ip}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) {
    logEvent("warn", {
      type: "rate_limit",
      action: "login",
      ...base,
      status: 429,
      durationMs: Date.now() - t0,
      retryAfterSec: rl.retryAfterSec,
    });
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": String(rl.remaining),
        },
      },
    );
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    logEvent("info", { type: "http", action: "login", ...base, status: 400, durationMs: Date.now() - t0 });
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient(request);
  const result = await supabase.auth.signInWithPassword({ email, password });

  if (result.error || !result.data.user) {
    logEvent("info", { type: "http", action: "login", ...base, status: 401, durationMs: Date.now() - t0 });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  logEvent("info", {
    type: "http",
    action: "login",
    ...base,
    status: 200,
    durationMs: Date.now() - t0,
    userId: result.data.user.id,
  });
  return NextResponse.json({
    user: { id: result.data.user.id, email: result.data.user.email },
  });
}
