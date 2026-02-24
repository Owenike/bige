import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { sendNotification } from "../../../../../lib/integrations/notify";
import { httpLogBase, logEvent } from "../../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  if (name.length <= 2) return `${name[0] || "*"}*@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function tokenHash(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function resolveAppUrl(request: Request) {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (configured) return configured;
  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export async function POST(request: Request) {
  const t0 = Date.now();
  const base = httpLogBase(request);
  const ip = base.ip || "unknown";

  const body = await request.json().catch(() => null);
  const phoneRaw = typeof body?.phone === "string" ? body.phone.trim() : "";
  const phone = normalizePhone(phoneRaw);
  if (!phone || phone.length < 8) {
    return NextResponse.json({ error: "Phone is required and must be valid" }, { status: 400 });
  }

  const rl = rateLimitFixedWindow({
    key: `member_activation_request:${ip}:${phone}`,
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) {
    logEvent("warn", {
      type: "rate_limit",
      action: "member_activation_request",
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

  const admin = createSupabaseAdminClient();
  const memberWithPortalResult = await admin
    .from("members")
    .select("id, tenant_id, full_name, phone, email, portal_status")
    .eq("phone", phone)
    .limit(2);

  const memberResult =
    memberWithPortalResult.error && memberWithPortalResult.error.message.includes("portal_status")
      ? await admin
      .from("members")
      .select("id, tenant_id, full_name, phone, email")
      .eq("phone", phone)
      .limit(2)
      : memberWithPortalResult;

  if (memberResult.error) {
    logEvent("error", {
      type: "http",
      action: "member_activation_request",
      ...base,
      status: 500,
      durationMs: Date.now() - t0,
      error: memberResult.error.message,
    });
    return NextResponse.json({ error: memberResult.error.message }, { status: 500 });
  }

  const members = (memberResult.data || []) as Array<{
    id: string;
    tenant_id: string | null;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    portal_status?: string | null;
  }>;
  if (members.length === 0) {
    return NextResponse.json({ error: "Member not found. Please ask frontdesk to create your profile first." }, { status: 404 });
  }
  if (members.length > 1) {
    return NextResponse.json({ error: "Phone is bound to multiple tenants. Please contact frontdesk." }, { status: 409 });
  }

  const member = members[0];
  if (!member.tenant_id) {
    return NextResponse.json({ error: "Missing tenant context on member record" }, { status: 400 });
  }
  if (!member.email) {
    return NextResponse.json({ error: "Member email is missing. Please ask frontdesk to update your email first." }, { status: 400 });
  }
  if (member.portal_status === "disabled") {
    return NextResponse.json({ error: "Portal access is disabled. Please contact frontdesk." }, { status: 403 });
  }

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = tokenHash(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const requestedUa = request.headers.get("user-agent") || null;

  const tokenInsert = await admin.from("member_activation_tokens").insert({
    tenant_id: member.tenant_id,
    member_id: member.id,
    email: member.email,
    phone,
    token_hash: hashedToken,
    expires_at: expiresAt,
    requested_ip: ip,
    requested_ua: requestedUa,
  });

  if (tokenInsert.error) {
    logEvent("error", {
      type: "http",
      action: "member_activation_request",
      ...base,
      status: 500,
      durationMs: Date.now() - t0,
      error: tokenInsert.error.message,
    });
    return NextResponse.json({ error: tokenInsert.error.message }, { status: 500 });
  }

  await admin
    .from("members")
    .update({ portal_last_activation_sent_at: new Date().toISOString() })
    .eq("id", member.id)
    .eq("tenant_id", member.tenant_id);

  const appUrl = resolveAppUrl(request);
  const activationLink = new URL("/member/activate", appUrl);
  activationLink.searchParams.set("token", rawToken);

  const notifyMessage = [
    `Hi ${member.full_name || "Member"},`,
    "",
    "Please use the link below to activate your member account and set your password.",
    "",
    activationLink.toString(),
    "",
    "This link expires in 30 minutes.",
    "If you did not request this, please ignore this email.",
  ].join("\n");

  const notifyResult = await sendNotification({
    channel: "email",
    target: member.email,
    templateKey: "member_portal_activation",
    message: notifyMessage,
  });

  if (!notifyResult.ok) {
    logEvent("warn", {
      type: "http",
      action: "member_activation_request",
      ...base,
      status: 502,
      durationMs: Date.now() - t0,
      error: notifyResult.error || "notify_failed",
    });
    return NextResponse.json({ error: notifyResult.error || "Failed to send activation email" }, { status: 502 });
  }

  logEvent("info", {
    type: "http",
    action: "member_activation_request",
    ...base,
    status: 200,
    durationMs: Date.now() - t0,
    memberId: member.id,
  });

  return NextResponse.json({
    accepted: true,
    maskedEmail: maskEmail(member.email),
    expiresAt,
  });
}
