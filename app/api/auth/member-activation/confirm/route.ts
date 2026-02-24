import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { httpLogBase, logEvent } from "../../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

function tokenHash(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function POST(request: Request) {
  const t0 = Date.now();
  const base = httpLogBase(request);
  const ip = base.ip || "unknown";

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!token || token.length < 32) {
    return NextResponse.json({ error: "Invalid activation token" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const rl = rateLimitFixedWindow({
    key: `member_activation_confirm:${ip}:${token.slice(0, 16)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) {
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

  const now = new Date().toISOString();
  const admin = createSupabaseAdminClient();
  const hashedToken = tokenHash(token);

  const claimResult = await admin
    .from("member_activation_tokens")
    .update({ used_at: now })
    .eq("token_hash", hashedToken)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id, tenant_id, member_id, email, phone, expires_at")
    .maybeSingle();

  if (claimResult.error) {
    logEvent("error", {
      type: "http",
      action: "member_activation_confirm",
      ...base,
      status: 500,
      durationMs: Date.now() - t0,
      error: claimResult.error.message,
    });
    return NextResponse.json({ error: claimResult.error.message }, { status: 500 });
  }
  if (!claimResult.data) {
    return NextResponse.json({ error: "Activation token is invalid or expired" }, { status: 400 });
  }

  const tokenRow = claimResult.data;
  let memberResult = await admin
    .from("members")
    .select("id, tenant_id, store_id, full_name, email, auth_user_id, portal_status")
    .eq("id", tokenRow.member_id)
    .eq("tenant_id", tokenRow.tenant_id)
    .maybeSingle();

  if (memberResult.error && memberResult.error.message.includes("portal_status")) {
    memberResult = await admin
      .from("members")
      .select("id, tenant_id, store_id, full_name, email, auth_user_id")
      .eq("id", tokenRow.member_id)
      .eq("tenant_id", tokenRow.tenant_id)
      .maybeSingle();
  }

  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (memberResult.data.portal_status === "disabled") {
    return NextResponse.json({ error: "Portal access is disabled. Please contact frontdesk." }, { status: 403 });
  }

  let authUserId = memberResult.data.auth_user_id || null;
  if (authUserId) {
    const updateAuthResult = await admin.auth.admin.updateUserById(authUserId, {
      email: tokenRow.email,
      password,
      email_confirm: true,
    });
    if (updateAuthResult.error) {
      return NextResponse.json({ error: updateAuthResult.error.message }, { status: 500 });
    }
  } else {
    const createAuthResult = await admin.auth.admin.createUser({
      email: tokenRow.email,
      password,
      email_confirm: true,
      user_metadata: {
        member_id: memberResult.data.id,
        tenant_id: memberResult.data.tenant_id,
        role: "member",
      },
    });
    if (createAuthResult.error || !createAuthResult.data.user) {
      return NextResponse.json(
        { error: createAuthResult.error?.message || "Failed to create auth user" },
        { status: 500 },
      );
    }
    authUserId = createAuthResult.data.user.id;
  }

  const profileUpsertResult = await admin.from("profiles").upsert(
    {
      id: authUserId,
      tenant_id: memberResult.data.tenant_id,
      branch_id: memberResult.data.store_id,
      role: "member",
      display_name: memberResult.data.full_name || null,
      is_active: true,
      updated_at: now,
    },
    { onConflict: "id" },
  );
  if (profileUpsertResult.error) {
    return NextResponse.json({ error: profileUpsertResult.error.message }, { status: 500 });
  }

  const memberUpdateResult = await admin
    .from("members")
    .update({
      auth_user_id: authUserId,
      portal_status: "active",
      portal_activated_at: now,
      updated_at: now,
    })
    .eq("id", memberResult.data.id)
    .eq("tenant_id", memberResult.data.tenant_id);
  if (memberUpdateResult.error) {
    return NextResponse.json({ error: memberUpdateResult.error.message }, { status: 500 });
  }

  logEvent("info", {
    type: "http",
    action: "member_activation_confirm",
    ...base,
    status: 200,
    durationMs: Date.now() - t0,
    memberId: memberResult.data.id,
    userId: authUserId,
  });

  return NextResponse.json({ activated: true });
}
