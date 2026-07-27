import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { httpLogBase } from "../../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

function tokenHash(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function emailBelongsToAnotherUser(email: string, currentUserId: string) {
  const admin = createSupabaseAdminClient();
  for (let page = 1; page <= 20; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (result.error) throw result.error;
    const users = result.data.users || [];
    if (
      users.some(
        (user) =>
          user.id !== currentUserId &&
          (user.email || "").trim().toLowerCase() === email,
      )
    ) {
      return true;
    }
    if (users.length < 200) return false;
  }
  return false;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (token.length < 32) {
    return NextResponse.json({ error: "驗證連結無效" }, { status: 400 });
  }

  const base = httpLogBase(request);
  const rateLimit = rateLimitFixedWindow({
    key: `staff_email_confirm:${base.ip || "unknown"}:${token.slice(0, 16)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "操作次數過多，請稍後再試" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSec) },
      },
    );
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const hashedToken = tokenHash(token);
  const claimResult = await admin
    .from("staff_email_verification_tokens")
    .update({ used_at: now })
    .eq("token_hash", hashedToken)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id, profile_id, tenant_id, email, expires_at")
    .maybeSingle();
  if (claimResult.error) {
    return NextResponse.json({ error: claimResult.error.message }, { status: 500 });
  }
  if (!claimResult.data) {
    return NextResponse.json({ error: "驗證連結無效或已過期，請重新登入後寄送" }, { status: 400 });
  }

  const tokenRow = claimResult.data;
  const profileResult = await admin
    .from("profiles")
    .select("id, is_active, staff_deleted_at")
    .eq("id", tokenRow.profile_id)
    .maybeSingle();
  if (
    profileResult.error ||
    !profileResult.data ||
    !profileResult.data.is_active ||
    profileResult.data.staff_deleted_at
  ) {
    return NextResponse.json({ error: "員工帳號不存在或已停用" }, { status: 403 });
  }

  try {
    if (await emailBelongsToAnotherUser(tokenRow.email, tokenRow.profile_id)) {
      return NextResponse.json({ error: "此 Email 已由其他帳號使用" }, { status: 409 });
    }
  } catch (error) {
    await admin
      .from("staff_email_verification_tokens")
      .update({ used_at: null })
      .eq("id", tokenRow.id);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "檢查 Email 失敗" },
      { status: 500 },
    );
  }

  const authUpdate = await admin.auth.admin.updateUserById(tokenRow.profile_id, {
    email: tokenRow.email,
    email_confirm: true,
  });
  if (authUpdate.error) {
    await admin
      .from("staff_email_verification_tokens")
      .update({ used_at: null })
      .eq("id", tokenRow.id);
    return NextResponse.json({ error: authUpdate.error.message }, { status: 500 });
  }

  const profileUpdate = await admin
    .from("profiles")
    .update({
      staff_email_verified_at: now,
      updated_at: now,
    })
    .eq("id", tokenRow.profile_id);
  if (profileUpdate.error) {
    await admin
      .from("staff_email_verification_tokens")
      .update({ used_at: null })
      .eq("id", tokenRow.id);
    return NextResponse.json({ error: profileUpdate.error.message }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    tenant_id: tokenRow.tenant_id,
    actor_id: tokenRow.profile_id,
    action: "staff_email_verified",
    target_type: "profile",
    target_id: tokenRow.profile_id,
    reason: null,
    payload: { verifiedAt: now },
  });

  return NextResponse.json({ verified: true });
}
