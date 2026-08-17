const APPLE_MAIL_DOMAINS = new Set(["icloud.com", "me.com", "mac.com"]);

function senderDomain(value) {
  const match = String(value || "").match(/@([^>\s]+)>?$/);
  return match?.[1]?.toLowerCase() || null;
}

function recipientDomain(value) {
  const at = String(value || "").lastIndexOf("@");
  return at >= 0 ? value.slice(at + 1).toLowerCase() : null;
}

async function resend(path) {
  const response = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY || ""}` },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`Resend ${path} returned HTTP ${response.status}: ${body?.message || "request failed"}`);
  }
  return body;
}

if (!process.env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY is not configured");
}

const [emailResult, domainResult] = await Promise.all([
  resend("/emails?limit=100"),
  resend("/domains"),
]);

const emails = Array.isArray(emailResult?.data) ? emailResult.data : [];
const appleEmails = emails.filter((email) =>
  (Array.isArray(email.to) ? email.to : [email.to]).some((recipient) =>
    APPLE_MAIL_DOMAINS.has(recipientDomain(recipient)),
  ),
);
const appleEventCounts = Object.fromEntries(
  [...new Set(appleEmails.map((email) => email.last_event || "unknown"))]
    .sort()
    .map((event) => [event, appleEmails.filter((email) => (email.last_event || "unknown") === event).length]),
);

const domains = (Array.isArray(domainResult?.data) ? domainResult.data : []).map((domain) => ({
  name: domain.name,
  status: domain.status,
  region: domain.region,
  sending: domain.capabilities?.sending || null,
  receiving: domain.capabilities?.receiving || null,
}));

console.log(JSON.stringify({
  configuredSenderDomain: senderDomain(process.env.EMAIL_NOTIFY_FROM),
  recentEmailCount: emails.length,
  recentAppleEmailCount: appleEmails.length,
  appleEventCounts,
  recentAppleEmails: appleEmails.map((email) => ({
    createdAt: email.created_at,
    recipientDomains: [...new Set((Array.isArray(email.to) ? email.to : [email.to]).map(recipientDomain))],
    subject: email.subject,
    lastEvent: email.last_event,
  })),
  domains,
}, null, 2));
