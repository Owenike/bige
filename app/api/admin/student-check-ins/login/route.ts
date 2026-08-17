import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAuthCapability } from "../../../../../lib/auth-capabilities";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { recordSystemAuditEvent, type SystemAuditOutcome } from "../../../../../lib/system-audit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  let accountIdentifier: string | null = null;
  let actorId: string | null = null;
  let actorRole: string | null = null;
  let tenantId: string | null = null;
  let branchId: string | null = null;
  const auditLogin = async (status: number, reason: string, outcome?: SystemAuditOutcome) =>
    recordSystemAuditEvent({
      request,
      tenantId,
      branchId,
      actorId,
      actorRole,
      accountType: "staff",
      accountIdentifier,
      eventCategory: "authentication",
      action: "auth.student_checkin_admin_login",
      outcome: outcome || (status === 429 ? "rate_limited" : status === 403 ? "denied" : "failure"),
      targetType: actorId ? "auth_user" : null,
      targetId: actorId,
      reason,
      metadata: { statusCode: status, entryPoint: "student_checkin_admin" },
    });
  const limit = rateLimitFixedWindow({
    key: `student-checkin-admin-login:${ip}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.ok) {
    await auditLogin(429, "rate_limit_exceeded");
    return NextResponse.json(
      { ok: false, error: "嘗試次數過多，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const body = await request.json().catch(() => null);
  accountIdentifier = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : null;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    await auditLogin(400, "credentials_required");
    return NextResponse.json({ ok: false, error: "請輸入正確的 Email 與密碼。" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient(request);
  const result = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (result.error || !result.data.user) {
    await auditLogin(401, "invalid_credentials");
    return NextResponse.json({ ok: false, error: "Email 或密碼不正確。" }, { status: 401 });
  }

  actorId = result.data.user.id;
  const profileResult = await createSupabaseAdminClient()
    .from("profiles")
    .select("tenant_id, branch_id, role")
    .eq("id", actorId)
    .maybeSingle();
  tenantId = profileResult.data?.tenant_id || null;
  branchId = profileResult.data?.branch_id || null;
  actorRole = profileResult.data?.role || null;

  if (!hasAuthCapability(result.data.user.app_metadata, "student_checkin_admin")) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => null);
    await auditLogin(403, "missing_student_checkin_admin_capability", "denied");
    return NextResponse.json({ ok: false, error: "此帳號沒有報到管理權限。" }, { status: 403 });
  }

  await auditLogin(200, "password_login", "success");

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
