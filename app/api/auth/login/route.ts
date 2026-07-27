import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { httpLogBase, logEvent } from "../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { isEmployeeNumber, normalizeEmployeeNumber } from "../../../../lib/staff-credentials";
import {
  STAFF_ACTIVATION_MAX_ATTEMPTS,
  isStaffActivationCode,
  isStaffActivationComplete,
  matchesStaffActivationCode,
  normalizeStaffActivationCode,
  staffActivationSecret,
} from "../../../../lib/staff-activation";
import { createInAppNotifications } from "../../../../lib/in-app-notifications";

function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}

function normalizePlatform(input: string | null) {
  if (!input) return null;
  return input.replace(/^"+|"+$/g, "").trim() || null;
}

function tableMissing(message: string | undefined, tableName: string) {
  const text = (message || "").toLowerCase();
  return text.includes(`relation "${tableName.toLowerCase()}" does not exist`) || text.includes(`relation '${tableName.toLowerCase()}' does not exist`);
}

const MAX_ACTIVE_DEVICE_SESSIONS = 5;

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
  const employeeNumber = normalizeEmployeeNumber(body?.employeeNumber);
  const phoneRaw = typeof body?.phone === "string" ? body.phone.trim() : "";
  const phone = normalizePhone(phoneRaw);
  const password = typeof body?.password === "string" ? body.password : "";

  if ((!employeeNumber && !phone) || !password) {
    logEvent("info", { type: "http", action: "login", ...base, status: 400, durationMs: Date.now() - t0 });
    return NextResponse.json({ error: "employee number/phone and password are required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  let emailToLogin = "";
  let activationLogin = false;
  let staffProfile:
    | {
        id: string;
        tenant_id: string | null;
        branch_id: string | null;
        display_name: string | null;
        employee_number: string | null;
        is_active: boolean;
        staff_deleted_at: string | null;
        staff_activation_status: string | null;
      }
    | null = null;
  if (employeeNumber) {
    if (!isEmployeeNumber(employeeNumber)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const profileResult = await admin
      .from("profiles")
      .select("id, tenant_id, branch_id, display_name, employee_number, is_active, staff_deleted_at, staff_activation_status")
      .eq("employee_number", employeeNumber)
      .maybeSingle();

    if (
      profileResult.error ||
      !profileResult.data ||
      profileResult.data.is_active !== true ||
      profileResult.data.staff_deleted_at
    ) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    staffProfile = profileResult.data;

    if (
      staffProfile.staff_activation_status === "denied" ||
      staffProfile.staff_activation_status === "locked"
    ) {
      return NextResponse.json(
        { error: "首次啟用已中斷，請聯絡主管重新產生啟用碼" },
        { status: 423 },
      );
    }

    const authUserResult = await admin.auth.admin.getUserById(staffProfile.id);
    const staffEmail = authUserResult.data.user?.email?.trim().toLowerCase() || "";
    if (authUserResult.error || !staffEmail) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    emailToLogin = staffEmail;
    activationLogin = !isStaffActivationComplete(staffProfile.staff_activation_status);
  } else if (phone) {
    const memberByPhoneWithPortal = await admin
      .from("members")
      .select("id, email, portal_status")
      .eq("phone", phone)
      .limit(2);

    const memberByPhone =
      memberByPhoneWithPortal.error && memberByPhoneWithPortal.error.message.includes("portal_status")
        ? await admin.from("members").select("id, email").eq("phone", phone).limit(2)
        : memberByPhoneWithPortal;

    if (memberByPhone.error) {
      logEvent("error", { type: "http", action: "login", ...base, status: 500, durationMs: Date.now() - t0, error: memberByPhone.error.message });
      return NextResponse.json({ error: memberByPhone.error.message }, { status: 500 });
    }

    const members = (memberByPhone.data || []) as Array<{ id: string; email: string | null; portal_status?: string | null }>;
    if (members.length === 0) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    if (members.length > 1) {
      return NextResponse.json({ error: "Phone is bound to multiple tenants. Please contact frontdesk." }, { status: 409 });
    }

    const member = members[0];
    if (!member.email) {
      return NextResponse.json({ error: "Member email is missing. Please contact frontdesk." }, { status: 400 });
    }
    if (member.portal_status && member.portal_status !== "active") {
      return NextResponse.json({ error: "Member portal is not activated. Please request activation email first." }, { status: 403 });
    }

    emailToLogin = member.email.toLowerCase();
  }

  const supabase = await createSupabaseServerClient(request);
  let result;
  if (activationLogin && staffProfile) {
    const activationCode = normalizeStaffActivationCode(password);
    if (!isStaffActivationCode(activationCode)) {
      return NextResponse.json({ error: "員工編號或一次性啟用碼錯誤" }, { status: 401 });
    }

    const nowIso = new Date().toISOString();
    const tokenResult = await admin
      .from("staff_activation_tokens")
      .select("id, token_hash, expires_at, failed_attempts")
      .eq("profile_id", staffProfile.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tokenResult.error) {
      return NextResponse.json({ error: tokenResult.error.message }, { status: 500 });
    }
    if (!tokenResult.data || tokenResult.data.expires_at <= nowIso) {
      return NextResponse.json(
        { error: "一次性啟用碼已失效，請聯絡主管重新產生" },
        { status: 410 },
      );
    }

    let codeMatches = false;
    try {
      codeMatches = matchesStaffActivationCode({
        code: activationCode,
        expectedHash: tokenResult.data.token_hash,
        secret: staffActivationSecret(),
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "啟用碼驗證設定錯誤" },
        { status: 500 },
      );
    }

    if (!codeMatches) {
      const failedAttempts = Math.min(
        STAFF_ACTIVATION_MAX_ATTEMPTS,
        Number(tokenResult.data.failed_attempts || 0) + 1,
      );
      await admin
        .from("staff_activation_tokens")
        .update({ failed_attempts: failedAttempts, last_attempt_at: nowIso })
        .eq("id", tokenResult.data.id)
        .is("used_at", null);

      if (failedAttempts >= STAFF_ACTIVATION_MAX_ATTEMPTS) {
        await admin
          .from("profiles")
          .update({ staff_activation_status: "locked", updated_at: nowIso })
          .eq("id", staffProfile.id);
        await createInAppNotifications({
          supabase: admin,
          tenantId: staffProfile.tenant_id,
          branchId: staffProfile.branch_id,
          recipientRoles: ["platform_admin", "manager", "supervisor", "branch_manager"],
          title: "員工首次啟用已鎖定",
          message: `${staffProfile.display_name || staffProfile.employee_number || "員工"}的一次性啟用碼已連續輸入錯誤 ${STAFF_ACTIVATION_MAX_ATTEMPTS} 次，請主管確認本人後重新產生啟用碼。`,
          severity: "critical",
          eventType: "staff_activation_locked",
          targetType: "profile",
          targetId: staffProfile.id,
          actionUrl: "/manager/staff",
          dedupeKey: `staff-activation-locked:${staffProfile.id}:${tokenResult.data.id}`,
        }).catch(() => null);
      }
      return NextResponse.json({ error: "員工編號或一次性啟用碼錯誤" }, { status: 401 });
    }

    const claimed = await admin
      .from("staff_activation_tokens")
      .update({ used_at: nowIso, last_attempt_at: nowIso })
      .eq("id", tokenResult.data.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (claimed.error || !claimed.data) {
      return NextResponse.json(
        { error: "一次性啟用碼已使用，請聯絡主管重新產生" },
        { status: 409 },
      );
    }

    const linkResult = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: emailToLogin,
    });
    if (linkResult.error || !linkResult.data.properties?.hashed_token) {
      await admin
        .from("staff_activation_tokens")
        .update({ used_at: null })
        .eq("id", tokenResult.data.id);
      return NextResponse.json(
        { error: linkResult.error?.message || "建立首次啟用工作階段失敗" },
        { status: 500 },
      );
    }

    result = await supabase.auth.verifyOtp({
      token_hash: linkResult.data.properties.hashed_token,
      type: "magiclink",
    });
    if (result.error || !result.data.user) {
      await admin
        .from("staff_activation_tokens")
        .update({ used_at: null })
        .eq("id", tokenResult.data.id);
    }
  } else {
    result = await supabase.auth.signInWithPassword({ email: emailToLogin, password });
  }

  if (result.error || !result.data.user) {
    logEvent("info", { type: "http", action: "login", ...base, status: 401, durationMs: Date.now() - t0 });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const authUser = result.data.user;
  const userAgent = request.headers.get("user-agent") || null;
  const platform = normalizePlatform(request.headers.get("sec-ch-ua-platform"));
  const nowIso = new Date().toISOString();

  await admin
    .from("profiles")
    .update({ last_login_at: nowIso, updated_at: nowIso })
    .eq("id", authUser.id);

  const profileResult = await admin.from("profiles").select("role, tenant_id").eq("id", authUser.id).maybeSingle();
  if (!profileResult.error && profileResult.data?.role === "member" && profileResult.data.tenant_id) {
    const memberResult = await admin
      .from("members")
      .select("id")
      .eq("tenant_id", profileResult.data.tenant_id)
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (!memberResult.error && memberResult.data?.id) {
      const deviceInsert = await admin.from("member_device_sessions").insert({
        tenant_id: profileResult.data.tenant_id,
        member_id: memberResult.data.id,
        auth_user_id: authUser.id,
        user_agent: userAgent,
        ip_address: base.ip || null,
        platform,
        created_at: nowIso,
        updated_at: nowIso,
        last_seen_at: nowIso,
        revoked_at: null,
      });
      if (deviceInsert.error && !tableMissing(deviceInsert.error.message, "member_device_sessions")) {
        logEvent("warn", {
          type: "http",
          action: "member_device_session_insert_failed",
          ...base,
          status: 500,
          userId: authUser.id,
          error: deviceInsert.error.message,
        });
      } else if (!deviceInsert.error) {
        const activeDevicesResult = await admin
          .from("member_device_sessions")
          .select("id, last_seen_at")
          .eq("tenant_id", profileResult.data.tenant_id)
          .eq("member_id", memberResult.data.id)
          .is("revoked_at", null)
          .order("last_seen_at", { ascending: false })
          .limit(60);
        if (activeDevicesResult.error) {
          if (!tableMissing(activeDevicesResult.error.message, "member_device_sessions")) {
            logEvent("warn", {
              type: "http",
              action: "member_device_session_load_failed",
              ...base,
              status: 500,
              userId: authUser.id,
              error: activeDevicesResult.error.message,
            });
          }
        } else {
          const staleIds = (activeDevicesResult.data || [])
            .slice(MAX_ACTIVE_DEVICE_SESSIONS)
            .map((row) => String(row.id));
          if (staleIds.length > 0) {
            const staleRevokeResult = await admin
              .from("member_device_sessions")
              .update({ revoked_at: nowIso, updated_at: nowIso })
              .eq("tenant_id", profileResult.data.tenant_id)
              .eq("member_id", memberResult.data.id)
              .in("id", staleIds)
              .is("revoked_at", null);
            if (staleRevokeResult.error && !tableMissing(staleRevokeResult.error.message, "member_device_sessions")) {
              logEvent("warn", {
                type: "http",
                action: "member_device_session_auto_revoke_failed",
                ...base,
                status: 500,
                userId: authUser.id,
                error: staleRevokeResult.error.message,
              });
            }
          }
        }
      }
    }
  }

  logEvent("info", {
    type: "http",
    action: "login",
    ...base,
    status: 200,
    durationMs: Date.now() - t0,
    userId: authUser.id,
  });
  return NextResponse.json({
    user: { id: authUser.id, email: authUser.email },
    activationRequired: activationLogin,
  });
}
