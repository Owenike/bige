import { NextResponse } from "next/server";
import { recordSystemAuditEvent } from "../../../../../../lib/system-audit";
import {
  hashSupervisorSecret,
  isValidSupervisorSecret,
} from "../../../../../../lib/supervisor-biometric";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !isValidSupervisorSecret(body?.token)) {
    return NextResponse.json({ error: "登入核准連結格式不正確。" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const loginResult = await admin
    .from("supervisor_biometric_login_requests")
    .select("id, profile_id, status")
    .eq("id", requestId)
    .eq("approval_secret_hash", hashSupervisorSecret(body.token))
    .maybeSingle();
  if (loginResult.error || !loginResult.data) {
    return NextResponse.json({ error: "登入核准連結無效。" }, { status: 401 });
  }
  if (loginResult.data.status !== "pending") {
    return NextResponse.json({ error: "這次登入要求已被處理。" }, { status: 409 });
  }
  const deniedAt = new Date().toISOString();
  await admin
    .from("supervisor_biometric_login_requests")
    .update({ status: "denied", denied_at: deniedAt, updated_at: deniedAt })
    .eq("id", requestId)
    .eq("status", "pending");
  const profileResult = await admin
    .from("profiles")
    .select("tenant_id, branch_id, role, employee_number")
    .eq("id", loginResult.data.profile_id)
    .maybeSingle();
  await recordSystemAuditEvent({
    request,
    tenantId: profileResult.data?.tenant_id || null,
    branchId: profileResult.data?.branch_id || null,
    actorId: loginResult.data.profile_id,
    actorRole: profileResult.data?.role || null,
    accountType: "staff",
    accountIdentifier: profileResult.data?.employee_number || null,
    eventCategory: "authentication",
    action: "auth.supervisor_login_denied",
    outcome: "denied",
    reason: "phone_user_denied_request",
    targetType: "supervisor_biometric_login_request",
    targetId: requestId,
  });
  return NextResponse.json({ ok: true, denied: true });
}
