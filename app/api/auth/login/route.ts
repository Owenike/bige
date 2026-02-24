import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { httpLogBase, logEvent } from "../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

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
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const phoneRaw = typeof body?.phone === "string" ? body.phone.trim() : "";
  const phone = normalizePhone(phoneRaw);
  const password = typeof body?.password === "string" ? body.password : "";

  if ((!email && !phone) || !password) {
    logEvent("info", { type: "http", action: "login", ...base, status: 400, durationMs: Date.now() - t0 });
    return NextResponse.json({ error: "email/phone and password are required" }, { status: 400 });
  }

  let emailToLogin = email;
  if (!emailToLogin && phone) {
    const admin = createSupabaseAdminClient();
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
  const result = await supabase.auth.signInWithPassword({ email: emailToLogin, password });

  if (result.error || !result.data.user) {
    logEvent("info", { type: "http", action: "login", ...base, status: 401, durationMs: Date.now() - t0 });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const authUser = result.data.user;
  const userAgent = request.headers.get("user-agent") || null;
  const platform = normalizePlatform(request.headers.get("sec-ch-ua-platform"));
  const admin = createSupabaseAdminClient();

  const profileResult = await admin.from("profiles").select("role, tenant_id").eq("id", authUser.id).maybeSingle();
  if (!profileResult.error && profileResult.data?.role === "member" && profileResult.data.tenant_id) {
    const memberResult = await admin
      .from("members")
      .select("id")
      .eq("tenant_id", profileResult.data.tenant_id)
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (!memberResult.error && memberResult.data?.id) {
      const now = new Date().toISOString();
      const deviceInsert = await admin.from("member_device_sessions").insert({
        tenant_id: profileResult.data.tenant_id,
        member_id: memberResult.data.id,
        auth_user_id: authUser.id,
        user_agent: userAgent,
        ip_address: base.ip || null,
        platform,
        created_at: now,
        updated_at: now,
        last_seen_at: now,
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
              .update({ revoked_at: now, updated_at: now })
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
  });
}
