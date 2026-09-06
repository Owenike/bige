import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

const confirmation = argument("confirm").trim().toUpperCase();
const reason = argument("reason").trim();
if (confirmation !== "E000001") {
  throw new Error("緊急復原只允許 01；請加上 --confirm E000001");
}
if (reason.length < 8) {
  throw new Error("請用 --reason 填寫至少 8 個字的實際復原原因");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !serviceRoleKey) throw new Error("缺少 Supabase 管理環境變數");
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const profileResult = await admin
  .from("profiles")
  .select("id, tenant_id, role, employee_number, is_active, staff_deleted_at")
  .eq("employee_number", "E000001")
  .maybeSingle();
const profile = profileResult.data;
if (
  profileResult.error ||
  !profile ||
  profile.role !== "platform_admin" ||
  profile.is_active !== true ||
  profile.staff_deleted_at
) {
  throw new Error("找不到可復原的 01 系統管理員帳號");
}

const now = new Date();
const nowIso = now.toISOString();
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("base64url");
const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

const cleanupResults = await Promise.all([
  admin
    .from("supervisor_biometric_devices")
    .update({ revoked_at: nowIso, revoke_reason: `codex_recovery: ${reason}` })
    .eq("profile_id", profile.id)
    .is("revoked_at", null),
  admin
    .from("supervisor_biometric_sessions")
    .update({ revoked_at: nowIso, revoke_reason: `codex_recovery: ${reason}` })
    .eq("profile_id", profile.id)
    .is("revoked_at", null),
  admin
    .from("supervisor_biometric_login_requests")
    .update({ status: "expired", updated_at: nowIso })
    .eq("profile_id", profile.id)
    .in("status", ["pending", "approved", "consuming"]),
  admin
    .from("supervisor_biometric_bindings")
    .update({ revoked_at: nowIso })
    .eq("profile_id", profile.id)
    .is("used_at", null)
    .is("revoked_at", null),
]);
const cleanupFailure = cleanupResults.find((result) => result.error);
if (cleanupFailure?.error) throw new Error(cleanupFailure.error.message);

const bindingResult = await admin.from("supervisor_biometric_bindings").insert({
  profile_id: profile.id,
  token_hash: tokenHash,
  created_by: null,
  created_via: "codex_recovery",
  reason,
  expires_at: expiresAt,
});
if (bindingResult.error) throw new Error(bindingResult.error.message);

const applicationUrl = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://www.bigefitness.com").replace(/\/$/, "");
process.stdout.write(`${JSON.stringify({
  recovered: true,
  employeeNumber: "E000001",
  expiresAt,
  bindingUrl: `${applicationUrl}/staff/supervisor-device#token=${token}`,
}, null, 2)}\n`);
