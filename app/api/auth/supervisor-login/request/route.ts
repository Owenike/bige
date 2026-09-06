import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "../../../../../lib/observability";
import { rateLimitShared } from "../../../../../lib/rate-limit";
import { recordSystemAuditEvent } from "../../../../../lib/system-audit";
import {
  SUPERVISOR_LOGIN_REQUEST_TTL_MS,
  attachSupervisorLoginCookie,
  createSupervisorSecret,
  hashSupervisorSecret,
  isSupervisorBiometricEnforced,
  supervisorBrowserLabel,
  supervisorRequestPlatform,
} from "../../../../../lib/supervisor-biometric";
import { isEmployeeNumber, normalizeEmployeeNumber } from "../../../../../lib/staff-credentials";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { sendSupervisorLoginPush } from "../../../../../lib/supervisor-web-push";

function applicationOrigin(request: Request) {
  const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) || "unknown";
  const ipLimit = await rateLimitShared({
    key: `supervisor-login-request:${ip}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "登入要求過於頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
    );
  }

  const body = await request.json().catch(() => null);
  const employeeNumber = normalizeEmployeeNumber(body?.employeeNumber);
  if (!isEmployeeNumber(employeeNumber)) {
    return NextResponse.json({ error: "請輸入正確的主管員工編號。" }, { status: 400 });
  }
  const accountLimit = await rateLimitShared({
    key: `supervisor-login-account:${employeeNumber}`,
    limit: 6,
    windowMs: 10 * 60 * 1000,
  });
  if (!accountLimit.ok) {
    return NextResponse.json(
      { error: "此帳號收到過多登入要求，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(accountLimit.retryAfterSec) } },
    );
  }

  const admin = createSupabaseAdminClient();
  const profileResult = await admin
    .from("profiles")
    .select("id, tenant_id, branch_id, role, position, employee_number, is_active, staff_deleted_at, staff_activation_status, supervisor_biometric_enforced_at")
    .eq("employee_number", employeeNumber)
    .maybeSingle();
  const profile = profileResult.data;
  if (
    profileResult.error ||
    !profile ||
    profile.is_active !== true ||
    profile.staff_deleted_at ||
    !isSupervisorBiometricEnforced(profile)
  ) {
    await recordSystemAuditEvent({
      request,
      accountType: "staff",
      accountIdentifier: employeeNumber,
      eventCategory: "authentication",
      action: "auth.supervisor_login_request",
      outcome: "denied",
      reason: "supervisor_biometric_not_ready",
    });
    return NextResponse.json(
      { error: "此主管帳號尚未完成手機綁定，請聯絡 01 處理。" },
      { status: 409 },
    );
  }

  const deviceResult = await admin
    .from("supervisor_biometric_devices")
    .select("id, push_endpoint, push_p256dh, push_auth")
    .eq("profile_id", profile.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (deviceResult.error || !deviceResult.data) {
    return NextResponse.json(
      { error: "找不到已綁定的主管手機，請聯絡 01 重新綁定。" },
      { status: 409 },
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  await admin
    .from("supervisor_biometric_login_requests")
    .update({ status: "expired", updated_at: nowIso })
    .eq("profile_id", profile.id)
    .eq("status", "pending");

  const requestId = crypto.randomUUID();
  const browserSecret = createSupervisorSecret();
  const approvalSecret = createSupervisorSecret();
  const expiresAt = new Date(now.getTime() + SUPERVISOR_LOGIN_REQUEST_TTL_MS).toISOString();
  const platform = supervisorRequestPlatform(request);
  const browser = supervisorBrowserLabel(request.headers.get("user-agent"));
  const insertResult = await admin.from("supervisor_biometric_login_requests").insert({
    id: requestId,
    profile_id: profile.id,
    device_id: deviceResult.data.id,
    browser_secret_hash: hashSupervisorSecret(browserSecret),
    approval_secret_hash: hashSupervisorSecret(approvalSecret),
    status: "pending",
    requested_ip: ip === "unknown" ? null : ip,
    requested_user_agent: request.headers.get("user-agent") || null,
    requested_platform: platform,
    expires_at: expiresAt,
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (insertResult.error) {
    return NextResponse.json({ error: "目前無法建立登入要求，請稍後再試。" }, { status: 500 });
  }

  const approvalUrl = `${applicationOrigin(request)}/staff/supervisor-login?request=${encodeURIComponent(requestId)}#token=${approvalSecret}`;
  const delivery = await sendSupervisorLoginPush({
    subscription: {
      endpoint: deviceResult.data.push_endpoint,
      keys: {
        p256dh: deviceResult.data.push_p256dh,
        auth: deviceResult.data.push_auth,
      },
    },
    approvalUrl,
    employeeNumber,
    platform,
    browser,
  });

  if (!delivery.ok) {
    await admin
      .from("supervisor_biometric_login_requests")
      .update({ status: "delivery_failed", updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "pending");
    if (delivery.gone) {
      await admin
        .from("supervisor_biometric_devices")
        .update({ revoked_at: new Date().toISOString(), revoke_reason: "push_subscription_expired" })
        .eq("id", deviceResult.data.id)
        .is("revoked_at", null);
    }
    await recordSystemAuditEvent({
      request,
      tenantId: profile.tenant_id,
      branchId: profile.branch_id,
      actorId: profile.id,
      actorRole: profile.role,
      accountType: "staff",
      accountIdentifier: employeeNumber,
      eventCategory: "authentication",
      action: "auth.supervisor_login_request",
      outcome: "failure",
      reason: delivery.gone ? "bound_push_subscription_expired" : "push_delivery_failed",
      metadata: { statusCode: delivery.statusCode },
    });
    return NextResponse.json(
      { error: delivery.gone ? "綁定的手機通知已失效，請聯絡 01 重新綁定。" : "手機通知傳送失敗，請稍後再試。" },
      { status: 502 },
    );
  }

  await admin
    .from("supervisor_biometric_devices")
    .update({ last_push_at: nowIso })
    .eq("id", deviceResult.data.id);
  await recordSystemAuditEvent({
    request,
    tenantId: profile.tenant_id,
    branchId: profile.branch_id,
    actorId: profile.id,
    actorRole: profile.role,
    accountType: "staff",
    accountIdentifier: employeeNumber,
    eventCategory: "authentication",
    action: "auth.supervisor_login_request",
    outcome: "success",
    reason: "push_sent",
    targetType: "supervisor_biometric_login_request",
    targetId: requestId,
  });

  const response = NextResponse.json({
    ok: true,
    requestId,
    status: "pending",
    expiresAt,
  });
  attachSupervisorLoginCookie(response, requestId, browserSecret);
  return response;
}
