export type NotifyChannel = "line" | "sms" | "email";
type NotifyProvider = "generic" | "mock";

export interface NotifyInput {
  channel: NotifyChannel;
  target: string;
  message: string;
  templateKey?: string | null;
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
}

function providerFromEnv(value: string | undefined): NotifyProvider {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "mock" ? "mock" : "generic";
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
    };
  }
  if (channel === "sms") {
    return {
      endpoint: process.env.SMS_NOTIFY_ENDPOINT || "",
      token: process.env.SMS_NOTIFY_TOKEN || "",
      provider: providerFromEnv(process.env.SMS_NOTIFY_PROVIDER),
      timeoutMs: timeoutFromEnv(process.env.SMS_NOTIFY_TIMEOUT_MS),
    };
  }
  return {
    endpoint: process.env.EMAIL_NOTIFY_ENDPOINT || "",
    token: process.env.EMAIL_NOTIFY_TOKEN || "",
    provider: providerFromEnv(process.env.EMAIL_NOTIFY_PROVIDER),
    timeoutMs: timeoutFromEnv(process.env.EMAIL_NOTIFY_TIMEOUT_MS),
  };
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
    if (!res.ok) {
      return {
        ok: false,
        providerRef: null,
        error: text || `HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      providerRef: text.slice(0, 120) || null,
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

function sendWithMockProvider(input: NotifyInput): NotifyResult {
  return {
    ok: true,
    providerRef: `mock:${input.channel}:${Date.now()}`,
    error: null,
  };
}

export async function sendNotification(input: NotifyInput): Promise<NotifyResult> {
  const cfg = readNotifyEnv(input.channel);
  if (cfg.provider === "mock") {
    return sendWithMockProvider(input);
  }
  return sendWithGenericProvider(input, cfg);
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
    error: attempts.at(-1)?.error || "No valid target found",
    channelUsed: null,
    targetUsed: null,
    attempts,
  };
}
