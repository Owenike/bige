import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";
import { sendNotification } from "../../../../../lib/integrations/notify";
import { httpLogBase, logEvent } from "../../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import { isStaffPlaceholderEmail } from "../../../../../lib/staff-credentials";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const STAFF_ROLES = [
  "platform_admin",
  "manager",
  "supervisor",
  "branch_manager",
  "frontdesk",
  "coach",
  "sales",
] as const;

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, Math.min(2, name.length))}***@${domain}`;
}

function tokenHash(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function resolveCanonicalAppUrl(request: Request) {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  return (configured || new URL(request.url).origin).replace(/\/+$/, "");
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
  const auth = await requireProfile([...STAFF_ROLES], request, {
    allowIncompleteStaffActivation: true,
  });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!isValidEmail(email) || isStaffPlaceholderEmail(email)) {
    return NextResponse.json({ error: "請輸入可正常收信的本人 Email" }, { status: 400 });
  }

  const base = httpLogBase(request);
  const rateLimit = rateLimitFixedWindow({
    key: `staff_email_request:${base.ip || "unknown"}:${auth.context.userId}`,
    limit: 5,
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
  const profileResult = await admin
    .from("profiles")
    .select("id, tenant_id, display_name, english_name, employee_number, is_active, staff_deleted_at, staff_email_verified_at, staff_activation_status")
    .eq("id", auth.context.userId)
    .maybeSingle();
  if (profileResult.error || !profileResult.data) {
    return NextResponse.json({ error: "找不到員工資料" }, { status: 404 });
  }
  const profile = profileResult.data;
  if (!profile.is_active || profile.staff_deleted_at) {
    return NextResponse.json({ error: "員工帳號已停用" }, { status: 403 });
  }
  if (profile.staff_activation_status !== "identity_confirmed") {
    return NextResponse.json({ error: "請先完成本人確認" }, { status: 403 });
  }
  if (profile.staff_email_verified_at) {
    return NextResponse.json({ error: "此員工帳號已完成 Email 驗證" }, { status: 409 });
  }

  try {
    if (await emailBelongsToAnotherUser(email, auth.context.userId)) {
      return NextResponse.json({ error: "此 Email 已由其他帳號使用" }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "檢查 Email 失敗" },
      { status: 500 },
    );
  }

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = tokenHash(rawToken);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await admin
    .from("staff_email_verification_tokens")
    .update({ used_at: now })
    .eq("profile_id", auth.context.userId)
    .is("used_at", null);

  const tokenResult = await admin.from("staff_email_verification_tokens").insert({
    profile_id: auth.context.userId,
    tenant_id: profile.tenant_id,
    email,
    token_hash: hashedToken,
    expires_at: expiresAt,
    requested_ip: base.ip || null,
    requested_ua: request.headers.get("user-agent") || null,
  });
  if (tokenResult.error) {
    return NextResponse.json({ error: tokenResult.error.message }, { status: 500 });
  }

  const verifyUrl = new URL("/staff/change-password", resolveCanonicalAppUrl(request));
  verifyUrl.searchParams.set("token", rawToken);
  const recipientName = profile.english_name || profile.display_name || profile.employee_number || "BIG E 員工";
  const message = [
    `${recipientName} 您好：`,
    "",
    "請點選以下連結，完成 BIG E 員工帳號的 Email 驗證：",
    verifyUrl.toString(),
    "",
    "此 Email 將用於忘記密碼及重要帳號安全通知。",
    "驗證連結將於 30 分鐘後失效。若非本人操作，請忽略此信。",
  ].join("\n");

  const notifyResult = await sendNotification({
    channel: "email",
    target: email,
    templateKey: "BIG E 員工 Email 驗證",
    message,
  });
  if (!notifyResult.ok) {
    await admin
      .from("staff_email_verification_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token_hash", hashedToken);
    logEvent("warn", {
      type: "http",
      action: "staff_email_verification_send_failed",
      ...base,
      status: 502,
      userId: auth.context.userId,
      error: notifyResult.error || "notify_failed",
    });
    return NextResponse.json(
      { error: notifyResult.error || "驗證信寄送失敗，請稍後再試" },
      { status: 502 },
    );
  }

  await admin.from("audit_logs").insert({
    tenant_id: profile.tenant_id,
    actor_id: auth.context.userId,
    action: "staff_email_verification_requested",
    target_type: "profile",
    target_id: auth.context.userId,
    reason: null,
    payload: { maskedEmail: maskEmail(email), expiresAt },
  });

  return NextResponse.json({
    accepted: true,
    maskedEmail: maskEmail(email),
    expiresAt,
  });
}
