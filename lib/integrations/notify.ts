export type NotifyChannel = "line" | "sms" | "email";
type NotifyProvider = "generic" | "mock" | "line_messaging_api" | "resend";

export interface NotifyInput {
  channel: NotifyChannel;
  target: string;
  message: string;
  templateKey?: string | null;
  html?: string | null;
}

export interface NotifyResult {
  ok: boolean;
  providerRef: string | null;
  error: string | null;
}

export interface NotifyAttemptResult extends NotifyResult {
  channel: NotifyChannel;
  target: string;
}

export interface NotifyFallbackInput {
  channels: NotifyChannel[];
  targets: Partial<Record<NotifyChannel, string>>;
  message: string;
  templateKey?: string | null;
}

export interface NotifyFallbackResult extends NotifyResult {
  channelUsed: NotifyChannel | null;
  targetUsed: string | null;
  attempts: NotifyAttemptResult[];
}

interface NotifyChannelConfig {
  endpoint: string;
  token: string;
  provider: NotifyProvider;
  timeoutMs: number;
  from: string;
  replyTo: string;
}

function providerFromEnv(value: string | undefined): NotifyProvider {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "mock") return "mock";
  if (normalized === "line_messaging_api") return "line_messaging_api";
  if (normalized === "resend") return "resend";
  return "generic";
}

function timeoutFromEnv(value: string | undefined): number {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return 8000;
  return Math.floor(parsed);
}

function readNotifyEnv(channel: NotifyChannel): NotifyChannelConfig {
  if (channel === "line") {
    return {
      endpoint: process.env.LINE_NOTIFY_ENDPOINT || "",
      token: process.env.LINE_NOTIFY_TOKEN || "",
      provider: providerFromEnv(process.env.LINE_NOTIFY_PROVIDER),
      timeoutMs: timeoutFromEnv(process.env.LINE_NOTIFY_TIMEOUT_MS),
      from: "",
      replyTo: "",
    };
  }
  if (channel === "sms") {
    return {
      endpoint: process.env.SMS_NOTIFY_ENDPOINT || "",
      token: process.env.SMS_NOTIFY_TOKEN || "",
      provider: providerFromEnv(process.env.SMS_NOTIFY_PROVIDER),
      timeoutMs: timeoutFromEnv(process.env.SMS_NOTIFY_TIMEOUT_MS),
      from: "",
      replyTo: "",
    };
  }
  const resendApiKey = process.env.RESEND_API_KEY || "";
  const configuredProvider = providerFromEnv(process.env.EMAIL_NOTIFY_PROVIDER);
  return {
    endpoint: process.env.EMAIL_NOTIFY_ENDPOINT || "",
    token: resendApiKey || process.env.EMAIL_NOTIFY_TOKEN || "",
    provider: resendApiKey ? "resend" : configuredProvider,
    timeoutMs: timeoutFromEnv(process.env.EMAIL_NOTIFY_TIMEOUT_MS),
    from: process.env.EMAIL_NOTIFY_FROM || "",
    replyTo: process.env.EMAIL_NOTIFY_REPLY_TO || "",
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildTransactionalEmailHtml(message: string) {
  const content = message
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div style="height:12px;line-height:12px">&nbsp;</div>';
      if (/^https:\/\/[^\s]+$/i.test(trimmed)) {
        const href = escapeHtml(trimmed);
        return `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:8px">開啟安全連結</a></p>`;
      }
      return `<p style="margin:0 0 12px;line-height:1.7;color:#1f2937">${escapeHtml(line)}</p>`;
    })
    .join("");

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="display:none;max-height:0;overflow:hidden">BIG E FITNESS 帳號安全通知</div><div style="max-width:600px;margin:0 auto;padding:32px 16px"><div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px"><div style="font-size:18px;font-weight:800;letter-spacing:.08em;color:#111827;margin-bottom:24px">BIG E FITNESS</div>${content}<p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#6b7280">這是系統寄出的帳號安全通知。如果不是您本人操作，請忽略此信。</p></div></div></body></html>`;
}

function notificationTargetDomain(input: NotifyInput) {
  if (input.channel !== "email") return null;
  const at = input.target.lastIndexOf("@");
  return at >= 0 ? input.target.slice(at + 1).trim().toLowerCase() : null;
}

function redactEmailAddresses(value: string | null) {
  return value?.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]") || null;
}

function logNotificationResult(input: NotifyInput, provider: NotifyProvider, result: NotifyResult) {
  const payload = {
    level: result.ok ? "info" : "error",
    message: "notification_send",
    channel: input.channel,
    provider,
    targetDomain: notificationTargetDomain(input),
    templateKey: input.templateKey || null,
    ok: result.ok,
    providerRef: result.providerRef,
    error: redactEmailAddresses(result.error),
  };
  if (result.ok) console.info(JSON.stringify(payload));
  else console.error(JSON.stringify(payload));
}

function buildProviderPayload(input: NotifyInput) {
  if (input.channel === "line") {
    return {
      to: input.target,
      messages: [{ type: "text", text: input.message }],
      templateKey: input.templateKey || null,
    };
  }
  if (input.channel === "sms") {
    return {
      to: input.target,
      text: input.message,
      templateKey: input.templateKey || null,
    };
  }
  return {
    to: input.target,
    subject: input.templateKey || "Notification",
    text: input.message,
    templateKey: input.templateKey || null,
  };
}

async function sendWithGenericProvider(input: NotifyInput, cfg: NotifyChannelConfig): Promise<NotifyResult> {
  if (!cfg.endpoint) {
    return { ok: false, providerRef: null, error: `Missing ${input.channel} endpoint` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: JSON.stringify(buildProviderPayload(input)),
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await res.text();
    const providerRef =
      (input.channel === "line" ? res.headers.get("x-line-request-id") : null) ||
      text.slice(0, 120) ||
      null;
    if (!res.ok) {
      return {
        ok: false,
        providerRef,
        error: `HTTP ${res.status}${text ? ` ${text}` : ""}`,
      };
    }

    return {
      ok: true,
      providerRef,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      providerRef: null,
      error: error instanceof Error ? error.message : "Unknown notify error",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sendWithResendProvider(input: NotifyInput, cfg: NotifyChannelConfig): Promise<NotifyResult> {
  if (input.channel !== "email") {
    return { ok: false, providerRef: null, error: "Resend only supports email notifications" };
  }
  if (!cfg.token) {
    return { ok: false, providerRef: null, error: "Missing Resend API key" };
  }
  if (!cfg.from) {
    return { ok: false, providerRef: null, error: "Missing email sender" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [input.target],
        subject: input.templateKey || "BIG E FITNESS 通知",
        html: input.html || buildTransactionalEmailHtml(input.message),
        text: input.message,
        ...(cfg.replyTo ? { reply_to: [cfg.replyTo] } : {}),
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: { id?: string; message?: string; error?: { message?: string } } | null = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        providerRef: payload?.id || null,
        error: `HTTP ${response.status} ${
          payload?.message || payload?.error?.message || text || "Resend request failed"
        }`.trim(),
      };
    }

    return {
      ok: true,
      providerRef: payload?.id || null,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      providerRef: null,
      error: error instanceof Error ? error.message : "Unknown Resend error",
    };
  } finally {
    clearTimeout(timer);
  }
}

function sendWithMockProvider(input: NotifyInput): NotifyResult {
  return {
    ok: true,
    providerRef: `mock:${input.channel}:${Date.now()}`,
    error: null,
  };
}

export async function sendNotification(input: NotifyInput): Promise<NotifyResult> {
  const cfg = readNotifyEnv(input.channel);
  let result: NotifyResult;
  if (cfg.provider === "mock") {
    result = sendWithMockProvider(input);
  } else if (cfg.provider === "resend") {
    result = await sendWithResendProvider(input, cfg);
  } else {
    result = await sendWithGenericProvider(input, cfg);
  }
  logNotificationResult(input, cfg.provider, result);
  return result;
}

export async function sendNotificationWithFallback(input: NotifyFallbackInput): Promise<NotifyFallbackResult> {
  const attempts: NotifyAttemptResult[] = [];

  for (const channel of input.channels) {
    const target = (input.targets[channel] || "").trim();
    if (!target) continue;

    const result = await sendNotification({
      channel,
      target,
      message: input.message,
      templateKey: input.templateKey || null,
    });
    const attempt: NotifyAttemptResult = {
      channel,
      target,
      ok: result.ok,
      providerRef: result.providerRef,
      error: result.error,
    };
    attempts.push(attempt);

    if (result.ok) {
      return {
        ok: true,
        providerRef: result.providerRef,
        error: null,
        channelUsed: channel,
        targetUsed: target,
        attempts,
      };
    }
  }

  return {
    ok: false,
    providerRef: null,
    error: (attempts.length > 0 ? attempts[attempts.length - 1]?.error : null) || "No valid target found",
    channelUsed: null,
    targetUsed: null,
    attempts,
  };
}

