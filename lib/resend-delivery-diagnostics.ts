const APPLE_MAIL_DOMAINS = new Set(["icloud.com", "me.com", "mac.com"]);
const RESEND_API_ROOT = "https://api.resend.com";

type ResendListEmail = {
  created_at?: string;
  last_event?: string;
  to?: string | string[];
};

type ResendDomain = {
  name?: string;
  status?: string;
  region?: string;
  capabilities?: {
    sending?: string;
    receiving?: string;
  };
};

type ResendListResponse<T> = {
  data?: T[];
  has_more?: boolean;
};

function recipientDomain(value: string) {
  const at = value.lastIndexOf("@");
  return at >= 0 ? value.slice(at + 1).trim().toLowerCase() : null;
}

function senderDomain(value: string | undefined) {
  const match = String(value || "").match(/@([^>\s]+)>?$/);
  return match?.[1]?.toLowerCase() || null;
}

async function resendJson<T>(params: {
  apiKey: string;
  path: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await params.fetchImpl(`${RESEND_API_ROOT}${params.path}`, {
      headers: { Authorization: `Bearer ${params.apiKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "message" in body
          ? String((body as { message?: unknown }).message || "request failed")
          : "request failed";
      throw new Error(`Resend ${params.path} returned HTTP ${response.status}: ${message}`);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function collectResendDeliveryDiagnostics(input?: {
  apiKey?: string;
  configuredFrom?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const apiKey = input?.apiKey || process.env.RESEND_API_KEY || "";
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const fetchImpl = input?.fetchImpl || fetch;
  const timeoutMs = Math.max(1000, input?.timeoutMs || 8000);
  const [emailRequest, domainRequest] = await Promise.allSettled([
    resendJson<ResendListResponse<ResendListEmail>>({
      apiKey,
      path: "/emails?limit=100",
      fetchImpl,
      timeoutMs,
    }),
    resendJson<ResendListResponse<ResendDomain>>({
      apiKey,
      path: "/domains",
      fetchImpl,
      timeoutMs,
    }),
  ]);

  const emailResult = emailRequest.status === "fulfilled" ? emailRequest.value : null;
  const domainResult = domainRequest.status === "fulfilled" ? domainRequest.value : null;

  const emails = Array.isArray(emailResult?.data) ? emailResult.data : [];
  const appleEmails = emails.flatMap((email) => {
    const domains = [...new Set((Array.isArray(email.to) ? email.to : [email.to || ""])
      .map(recipientDomain)
      .filter((domain): domain is string => Boolean(domain && APPLE_MAIL_DOMAINS.has(domain))))];
    if (domains.length === 0) return [];
    return [{
      createdAt: email.created_at || null,
      recipientDomains: domains,
      lastEvent: email.last_event || "unknown",
    }];
  });

  const eventCounts: Record<string, number> = {};
  for (const email of appleEmails) {
    eventCounts[email.lastEvent] = (eventCounts[email.lastEvent] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    configuredSenderDomain: senderDomain(input?.configuredFrom || process.env.EMAIL_NOTIFY_FROM),
    apiAccess: {
      emails: emailRequest.status === "fulfilled"
        ? { available: true, error: null }
        : { available: false, error: emailRequest.reason instanceof Error ? emailRequest.reason.message : "request failed" },
      domains: domainRequest.status === "fulfilled"
        ? { available: true, error: null }
        : { available: false, error: domainRequest.reason instanceof Error ? domainRequest.reason.message : "request failed" },
    },
    recentEmailCount: emails.length,
    recentEmailsHasMore: Boolean(emailResult?.has_more),
    recentAppleEmailCount: appleEmails.length,
    appleEventCounts: Object.fromEntries(Object.entries(eventCounts).sort(([left], [right]) => left.localeCompare(right))),
    recentAppleEmails: appleEmails,
    domains: (Array.isArray(domainResult?.data) ? domainResult.data : []).map((domain) => ({
      name: domain.name || null,
      status: domain.status || null,
      region: domain.region || null,
      sending: domain.capabilities?.sending || null,
      receiving: domain.capabilities?.receiving || null,
    })),
  };
}
