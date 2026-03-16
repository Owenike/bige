import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveJobSettings, type DeliveryChannel as RuntimeChannel, type ResolvedJobSettings } from "./job-settings-resolver";
import { sendNotification } from "./integrations/notify";
import type { DeliveryChannel, DeliveryRow, DeliveryStatus } from "./notification-ops";

type ExternalChannel = Exclude<DeliveryChannel, "in_app" | "other">;

export type ExternalProviderConfigSnapshot = {
  channel: ExternalChannel;
  provider: string | null;
  endpointConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number | null;
};

export type DeliveryRuntimeCache = {
  settings: Map<string, ResolvedJobSettings>;
};

export type ProviderDispatchOutcome = {
  status: DeliveryStatus;
  errorCode: string | null;
  errorMessage: string | null;
  shouldRetry: boolean;
  provider: string | null;
  providerMessageId: string | null;
  providerResponse: Record<string, unknown> | null;
};

export type ResolvedDeliveryRuntime = {
  provider: string | null;
  requestedMode: "simulated" | "provider";
  effectiveMode: "simulated" | "provider";
  channelEnabled: boolean;
  configured: boolean;
  reason: string | null;
};

function runtimeKey(tenantId: string | null, branchId: string | null) {
  return `${tenantId || "global"}:${branchId || "tenant"}`;
}

function asExternalChannel(channel: DeliveryChannel): ExternalChannel | null {
  if (channel === "email" || channel === "line" || channel === "sms" || channel === "webhook") {
    return channel;
  }
  return null;
}

async function loadResolvedSettings(params: {
  supabase: SupabaseClient;
  tenantId: string | null;
  branchId: string | null;
  cache: DeliveryRuntimeCache;
}) {
  if (!params.tenantId) return null;
  const key = runtimeKey(params.tenantId, params.branchId);
  const cached = params.cache.settings.get(key);
  if (cached) return cached;
  const resolved = await resolveJobSettings({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
  });
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  params.cache.settings.set(key, resolved.data);
  return resolved.data;
}

function readNotifyProviderEnv(channel: Exclude<ExternalChannel, "webhook">) {
  if (channel === "email") {
    return {
      endpoint: process.env.EMAIL_NOTIFY_ENDPOINT || "",
      token: process.env.EMAIL_NOTIFY_TOKEN || "",
      provider: process.env.EMAIL_NOTIFY_PROVIDER || "",
      timeoutMs: Number(process.env.EMAIL_NOTIFY_TIMEOUT_MS || 0) || null,
    };
  }
  if (channel === "line") {
    return {
      endpoint: process.env.LINE_NOTIFY_ENDPOINT || "",
      token: process.env.LINE_NOTIFY_TOKEN || "",
      provider: process.env.LINE_NOTIFY_PROVIDER || "",
      timeoutMs: Number(process.env.LINE_NOTIFY_TIMEOUT_MS || 0) || null,
    };
  }
  return {
    endpoint: process.env.SMS_NOTIFY_ENDPOINT || "",
    token: process.env.SMS_NOTIFY_TOKEN || "",
    provider: process.env.SMS_NOTIFY_PROVIDER || "",
    timeoutMs: Number(process.env.SMS_NOTIFY_TIMEOUT_MS || 0) || null,
  };
}

function readWebhookProviderEnv() {
  return {
    endpoint: process.env.NOTIFICATION_WEBHOOK_URL || "",
    token: process.env.NOTIFICATION_WEBHOOK_TOKEN || "",
    provider: process.env.NOTIFICATION_WEBHOOK_PROVIDER || "webhook",
    timeoutMs: null,
  };
}

function normalizeProviderLabel(channel: ExternalChannel, configuredProvider: string | null, fallbackProvider: string | null) {
  const base = (configuredProvider || fallbackProvider || "").trim();
  if (!base) {
    if (channel === "webhook") return "webhook";
    if (channel === "line") return "line_messaging_api";
    return `generic_${channel}`;
  }
  return base;
}

function buildExternalPayload(row: DeliveryRow) {
  const payload = row.payload || {};
  const title = typeof payload.title === "string" ? payload.title : "Notification";
  const message = typeof payload.message === "string" ? payload.message : title;
  const emailSubject =
    typeof payload.emailSubject === "string"
      ? payload.emailSubject
      : typeof payload.email_subject === "string"
        ? payload.email_subject
        : title;
  return {
    title,
    message,
    emailSubject,
    templateKey: row.template_key || (typeof payload.templateKey === "string" ? payload.templateKey : null),
    actionUrl: typeof payload.actionUrl === "string" ? payload.actionUrl : null,
  };
}

function resolveRecipientTarget(row: DeliveryRow, channel: ExternalChannel) {
  if (channel === "email") return row.recipient_email || null;
  if (channel === "line") {
    const lineUserId =
      typeof row.payload?.lineUserId === "string"
        ? row.payload.lineUserId
        : typeof row.payload?.line_user_id === "string"
          ? row.payload.line_user_id
          : null;
    return lineUserId || null;
  }
  if (channel === "sms") return row.recipient_phone || null;
  return null;
}

export async function resolveNotificationDeliveryRuntime(params: {
  supabase: SupabaseClient;
  row: Pick<DeliveryRow, "tenant_id" | "branch_id" | "channel" | "delivery_mode">;
  cache: DeliveryRuntimeCache;
}): Promise<ResolvedDeliveryRuntime> {
  const externalChannel = asExternalChannel(params.row.channel);
  if (!externalChannel) {
    return {
      provider: null,
      requestedMode: params.row.delivery_mode || "simulated",
      effectiveMode: "simulated",
      channelEnabled: false,
      configured: false,
      reason: "channel_not_external",
    };
  }

  const settings = await loadResolvedSettings({
    supabase: params.supabase,
    tenantId: params.row.tenant_id,
    branchId: params.row.branch_id,
    cache: params.cache,
  });
  const jobEnabled = settings?.jobs.find((item) => item.jobType === "delivery_dispatch")?.enabled ?? true;
  const notificationSettings = settings?.notifications.find((item) => item.jobType === "delivery_dispatch");
  const channelSettings = settings?.deliveryChannels.find((item) => item.channel === (externalChannel as RuntimeChannel));
  const notificationChannelEnabled = notificationSettings?.channels[externalChannel] ?? true;
  const channelEnabled = jobEnabled && notificationChannelEnabled && (channelSettings?.isEnabled ?? false);

  const envConfig =
    externalChannel === "webhook"
      ? readWebhookProviderEnv()
      : readNotifyProviderEnv(externalChannel as Exclude<ExternalChannel, "webhook">);
  const provider = normalizeProviderLabel(externalChannel, channelSettings?.provider || null, envConfig.provider || null);
  const configured = Boolean(envConfig.endpoint);
  const requestedMode = params.row.delivery_mode || "simulated";
  const effectiveMode = requestedMode === "provider" && channelEnabled && configured ? "provider" : "simulated";
  const reason = channelEnabled
    ? configured
      ? null
      : "provider_not_configured"
    : "channel_disabled";

  return {
    provider,
    requestedMode,
    effectiveMode,
    channelEnabled,
    configured,
    reason,
  };
}

export function getExternalProviderConfig(channel: ExternalChannel): ExternalProviderConfigSnapshot {
  const envConfig =
    channel === "webhook"
      ? readWebhookProviderEnv()
      : readNotifyProviderEnv(channel as Exclude<ExternalChannel, "webhook">);
  return {
    channel,
    provider: normalizeProviderLabel(channel, null, envConfig.provider || null),
    endpointConfigured: Boolean(envConfig.endpoint),
    tokenConfigured: Boolean(envConfig.token),
    timeoutMs: envConfig.timeoutMs,
  };
}

function classifyNotifyError(channel: ExternalChannel, errorText: string) {
  const text = errorText.toLowerCase();
  if (text.includes("missing") && text.includes("endpoint")) {
    return {
      status: "skipped" as DeliveryStatus,
      errorCode: "CHANNEL_NOT_CONFIGURED",
      shouldRetry: false,
    };
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) {
    return {
      status: "failed" as DeliveryStatus,
      errorCode: "TIMEOUT",
      shouldRetry: true,
    };
  }
  const httpMatch = /\bhttp\s*(\d{3})\b/i.exec(errorText);
  if (httpMatch) {
    const code = Number(httpMatch[1]);
    if (
      channel === "line" &&
      code >= 400 &&
      code < 500 &&
      code !== 408 &&
      code !== 409 &&
      code !== 429
    ) {
      return {
        status: "failed" as DeliveryStatus,
        errorCode: `HTTP_${code}`,
        shouldRetry: false,
      };
    }
    return {
      status: "failed" as DeliveryStatus,
      errorCode: `HTTP_${code}`,
      shouldRetry: code >= 500 || code === 429,
    };
  }
  if (channel === "line" && (text.includes("invalid user") || text.includes("user id") || text.includes("not a friend"))) {
    return {
      status: "failed" as DeliveryStatus,
      errorCode: "LINE_RECIPIENT_INVALID",
      shouldRetry: false,
    };
  }
  return {
    status: "failed" as DeliveryStatus,
    errorCode: `${channel.toUpperCase()}_PROVIDER_ERROR`,
    shouldRetry: true,
  };
}

export async function dispatchNotificationViaAdapter(params: {
  supabase: SupabaseClient;
  row: DeliveryRow;
  cache: DeliveryRuntimeCache;
}): Promise<ProviderDispatchOutcome> {
  const externalChannel = asExternalChannel(params.row.channel);
  if (!externalChannel) {
    return {
      status: "skipped",
      errorCode: "CHANNEL_NOT_IMPLEMENTED",
      errorMessage: `Channel ${params.row.channel} is not an external provider channel`,
      shouldRetry: false,
      provider: null,
      providerMessageId: null,
      providerResponse: {
        channel: params.row.channel,
        reason: "non_external_channel",
      },
    };
  }

  const runtime = await resolveNotificationDeliveryRuntime({
    supabase: params.supabase,
    row: params.row,
    cache: params.cache,
  });
  const payload = buildExternalPayload(params.row);

  if (runtime.effectiveMode === "simulated") {
    return {
      status: "sent",
      errorCode: null,
      errorMessage: null,
      shouldRetry: false,
      provider: runtime.provider || "simulated",
      providerMessageId: `simulated:${params.row.id}`,
      providerResponse: {
        simulated: true,
        requestedMode: runtime.requestedMode,
        effectiveMode: runtime.effectiveMode,
        reason: runtime.reason,
        channel: params.row.channel,
      },
    };
  }

  if (externalChannel === "webhook") {
    const endpoint = process.env.NOTIFICATION_WEBHOOK_URL || "";
    if (!endpoint) {
      return {
        status: "skipped",
        errorCode: "CHANNEL_NOT_CONFIGURED",
        errorMessage: "NOTIFICATION_WEBHOOK_URL is not configured",
        shouldRetry: false,
        provider: runtime.provider,
        providerMessageId: null,
        providerResponse: {
          channel: "webhook",
          configured: false,
        },
      };
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.NOTIFICATION_WEBHOOK_TOKEN
            ? { Authorization: `Bearer ${process.env.NOTIFICATION_WEBHOOK_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          deliveryId: params.row.id,
          tenantId: params.row.tenant_id,
          branchId: params.row.branch_id,
          bookingId: params.row.booking_id,
          templateKey: params.row.template_key,
          recipientName: params.row.recipient_name,
          payload: params.row.payload || {},
        }),
      });
      const responseText = await response.text();
      if (response.ok) {
        return {
          status: "sent",
          errorCode: null,
          errorMessage: null,
          shouldRetry: false,
          provider: runtime.provider,
          providerMessageId: null,
          providerResponse: {
            channel: "webhook",
            status: response.status,
            response: responseText.slice(0, 500),
          },
        };
      }
      const classified = classifyNotifyError("webhook", `HTTP ${response.status} ${responseText}`);
      return {
        status: classified.status,
        errorCode: classified.errorCode,
        errorMessage: responseText || `Webhook responded with ${response.status}`,
        shouldRetry: classified.shouldRetry,
        provider: runtime.provider,
        providerMessageId: null,
        providerResponse: {
          channel: "webhook",
          status: response.status,
          response: responseText.slice(0, 500),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook request failed";
      const classified = classifyNotifyError("webhook", message);
      return {
        status: classified.status,
        errorCode: classified.errorCode,
        errorMessage: message,
        shouldRetry: classified.shouldRetry,
        provider: runtime.provider,
        providerMessageId: null,
        providerResponse: {
          channel: "webhook",
          networkError: true,
        },
      };
    }
  }

  const target = resolveRecipientTarget(params.row, externalChannel);
  if (!target) {
    return {
      status: "skipped",
      errorCode: "RECIPIENT_CONTACT_MISSING",
      errorMessage: `Recipient target missing for channel ${externalChannel}`,
      shouldRetry: false,
      provider: runtime.provider,
      providerMessageId: null,
      providerResponse: {
        channel: externalChannel,
        recipientMissing: true,
      },
    };
  }

  const result = await sendNotification({
    channel: externalChannel,
    target,
    message: payload.message,
    templateKey: externalChannel === "email" ? payload.emailSubject || payload.templateKey : payload.templateKey,
  });
  if (result.ok) {
    return {
      status: "sent",
      errorCode: null,
      errorMessage: null,
      shouldRetry: false,
      provider: runtime.provider,
      providerMessageId: result.providerRef,
      providerResponse: {
        channel: externalChannel,
        recipient: target,
        subject: payload.emailSubject,
      },
    };
  }

  const classified = classifyNotifyError(externalChannel, result.error || `${externalChannel.toUpperCase()}_SEND_FAILED`);
  return {
    status: classified.status,
    errorCode: classified.errorCode,
    errorMessage: result.error || `${externalChannel.toUpperCase()}_SEND_FAILED`,
    shouldRetry: classified.shouldRetry,
    provider: runtime.provider,
    providerMessageId: result.providerRef,
    providerResponse: {
      channel: externalChannel,
      recipient: target,
      ok: false,
    },
  };
}
