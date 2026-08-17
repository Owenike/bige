import { createClient } from "@supabase/supabase-js";

const APPLE_MAIL_DOMAINS = new Set(["icloud.com", "me.com", "mac.com"]);

function emailDomain(value) {
  const at = String(value || "").lastIndexOf("@");
  return at >= 0 ? value.slice(at + 1).trim().toLowerCase() : null;
}

function appleRows(rows, field) {
  return (rows || [])
    .filter((row) => APPLE_MAIL_DOMAINS.has(emailDomain(row[field])))
    .map((row) => ({
      domain: emailDomain(row[field]),
      status: row.status,
      lastEmailSentAt: row.last_email_sent_at,
      emailSendCount: row.email_send_count,
      expiresAt: row.expires_at,
      completedAt: row.completed_at,
    }));
}

function summarizeByDomain(rows, field) {
  const summary = new Map();
  for (const row of rows || []) {
    const domain = emailDomain(row[field]);
    if (!domain) continue;
    const current = summary.get(domain) || { total: 0, completed: 0, pending: 0, cancelled: 0, verifying: 0 };
    current.total += 1;
    if (Object.hasOwn(current, row.status)) current[row.status] += 1;
    summary.set(domain, current);
  }
  return Object.fromEntries([...summary.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRole) {
  throw new Error("Supabase diagnostics require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const [registrationsResult, securitySetupsResult] = await Promise.all([
  supabase
    .from("student_checkin_email_verifications")
    .select("email, status, last_email_sent_at, email_send_count, expires_at, completed_at")
    .order("last_email_sent_at", { ascending: false })
    .limit(500),
  supabase
    .from("student_checkin_security_setups")
    .select("pending_email, status, last_email_sent_at, email_send_count, expires_at, completed_at")
    .order("last_email_sent_at", { ascending: false })
    .limit(500),
]);

if (registrationsResult.error) throw new Error(registrationsResult.error.message);
if (securitySetupsResult.error) throw new Error(securitySetupsResult.error.message);

const registrations = appleRows(registrationsResult.data, "email");
const securitySetups = appleRows(securitySetupsResult.data, "pending_email");

console.log(JSON.stringify({
  databaseHost: new URL(supabaseUrl).host,
  generatedAt: new Date().toISOString(),
  registrationsByDomain: summarizeByDomain(registrationsResult.data, "email"),
  securitySetupsByDomain: summarizeByDomain(securitySetupsResult.data, "pending_email"),
  registrations,
  securitySetups,
}, null, 2));
