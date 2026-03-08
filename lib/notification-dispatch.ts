import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import {
  listDeliveryRows,
  updateDeliveryStatus,
  type DeliveryChannel,
  type DeliveryRow,
  type DeliveryStatus,
} from "./notification-ops";
import { buildExternalContent, resolveExternalChannels, shouldRetryExternalFailure } from "./notification-external";
import { sendNotification } from "./integrations/notify";

type DispatchMode = "inline" | "job";

type DispatchParams = {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  deliveryIds?: string[];
  mode: DispatchMode;
  limit?: number;
  includeFailed?: boolean;
};

type DispatchSummary = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  retrying: number;
};

const PROVIDER_RESPONSE_MAX_STRING = 300;
const PROVIDER_RESPONSE_MAX_KEYS = 20;
const PROVIDER_RESPONSE_MAX_DEPTH = 3;

type AttemptOutcome = {
  status: DeliveryStatus;
  errorCode: string | null;
  errorMessage: string | null;
  shouldRetry: boolean;
  providerMessageId: string | null;
  providerResponse: Record<string, unknown> | null;
};

function nowIso() {
  return new Date().toISOString();
}

function nextRetryIso(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function truncateText(input: string, max = PROVIDER_RESPONSE_MAX_STRING) {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}...(truncated)`;
}

function sanitizeProviderResponseValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return truncateText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= PROVIDER_RESPONSE_MAX_DEPTH) return `[array:${value.length}]`;
    return value.slice(0, 10).map((item) => sanitizeProviderResponseValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= PROVIDER_RESPONSE_MAX_DEPTH) return "[object]";
    const output: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, PROVIDER_RESPONSE_MAX_KEYS);
    for (const [key, entryValue] of entries) {
      output[key] = sanitizeProviderResponseValue(entryValue, depth + 1);
    }
    return output;
  }
  return String(value);
}

function sanitizeProviderResponse(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!payload) return null;
  const safe = sanitizeProviderResponseValue(payload, 0);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? (safe as Record<string, unknown>) : { value: safe };
}

function shouldAttemptNow(row: DeliveryRow, includeFailed = false, mode: DispatchMode = "job") {
  const maxAttempts = row.max_attempts || 3;
  const attempts = row.attempts || 0;
  if (row.status === "pending") return true;
  if (row.status === "retrying") {
    if (!row.next_retry_at) return true;
    return new Date(row.next_retry_at).getTime() <= Date.now();
  }
  if (includeFailed && row.status === "failed") {
    if (mode === "inline") return true;
    return attempts < maxAttempts;
  }
  return false;
}

async function resolveRecipientEmail(params: {
  supabase: SupabaseClient;
  recipientUserId: string | null;
  cache: Map<string, string | null>;
}) {
  if (!params.recipientUserId) {
    return { email: null, errorCode: "RECIPIENT_CONTACT_MISSING", errorMessage: "recipient_user_id is missing" };
  }
  if (params.cache.has(params.recipientUserId)) {
    const email = params.cache.get(params.recipientUserId) || null;
    return email
      ? { email, errorCode: null, errorMessage: null }
      : { email: null, errorCode: "RECIPIENT_CONTACT_MISSING", errorMessage: "Recipient email is missing" };
  }
  const userResult = await params.supabase.auth.admin.getUserById(params.recipientUserId);
  if (userResult.error) {
    return {
      email: null,
      errorCode: "RECIPIENT_LOOKUP_FAILED",
      errorMessage: userResult.error.message,
    };
  }
  const email = userResult.data.user?.email?.trim()?.toLowerCase() || null;
  params.cache.set(params.recipientUserId, email);
  return email
    ? { email, errorCode: null, errorMessage: null }
    : { email: null, errorCode: "RECIPIENT_CONTACT_MISSING", errorMessage: "Recipient email is missing" };
}

async function attemptWebhook(row: DeliveryRow): Promise<AttemptOutcome> {
  const endpoint = process.env.NOTIFICATION_WEBHOOK_URL || "";
  if (!endpoint) {
    return {
      status: "skipped",
      errorCode: "CHANNEL_NOT_CONFIGURED",
      errorMessage: "NOTIFICATION_WEBHOOK_URL is not configured",
      shouldRetry: false,
      providerMessageId: null,
        providerResponse: {
          channel: "webhook",
          configured: false,
          reason: "missing_endpoint",
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
        deliveryId: row.id,
        tenantId: row.tenant_id,
        branchId: row.branch_id,
        notificationId: row.notification_id,
        opportunityId: row.opportunity_id,
        sourceRefType: row.source_ref_type,
        sourceRefId: row.source_ref_id,
        recipientUserId: row.recipient_user_id,
        recipientRole: row.recipient_role,
        channel: row.channel,
        payload: row.payload || {},
        createdAt: row.created_at,
      }),
    });
    const responseText = await response.text();
    if (response.ok) {
      return {
        status: "sent",
        errorCode: null,
        errorMessage: null,
        shouldRetry: false,
        providerMessageId: null,
        providerResponse: {
          channel: "webhook",
          status: response.status,
          response: responseText.slice(0, 500),
          ok: true,
        },
      };
    }
    return {
      status: "failed",
      errorCode: `HTTP_${response.status}`,
      errorMessage: `Webhook responded with ${response.status}: ${responseText.slice(0, 200)}`,
      shouldRetry: response.status >= 500 || response.status === 429,
      providerMessageId: null,
        providerResponse: {
          channel: "webhook",
          status: response.status,
          response: responseText.slice(0, 500),
          ok: false,
        },
      };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Webhook request failed";
    const timeout = errorMessage.toLowerCase().includes("abort") || errorMessage.toLowerCase().includes("timeout");
    return {
      status: "failed",
      errorCode: timeout ? "TIMEOUT" : "NETWORK_ERROR",
      errorMessage,
      shouldRetry: true,
      providerMessageId: null,
      providerResponse: {
        channel: "webhook",
        ok: false,
        timeout,
      },
    };
  }
}

function classifyExternalFailure(params: {
  channel: DeliveryChannel;
  errorText: string;
}) {
  const text = params.errorText.toLowerCase();
  if (text.includes("missing email endpoint") || text.includes("missing webhook endpoint")) {
    return { errorCode: "CHANNEL_NOT_CONFIGURED", shouldRetry: false, status: "skipped" as DeliveryStatus };
  }
  if (text.includes("abort") || text.includes("timeout") || text.includes("timed out")) {
    return { errorCode: "TIMEOUT", shouldRetry: true, status: "failed" as DeliveryStatus };
  }
  const httpCodeMatch = /\bhttp\s*(\d{3})\b/i.exec(params.errorText);
  if (httpCodeMatch) {
    const httpCode = Number(httpCodeMatch[1]);
    return {
      errorCode: `HTTP_${httpCode}`,
      shouldRetry: httpCode >= 500 || httpCode === 429,
      status: "failed" as DeliveryStatus,
    };
  }
  return {
    errorCode: `${String(params.channel).toUpperCase()}_PROVIDER_ERROR`,
    shouldRetry: true,
    status: "failed" as DeliveryStatus,
  };
}

async function attemptEmail(params: {
  supabase: SupabaseClient;
  row: DeliveryRow;
  recipientCache: Map<string, string | null>;
}): Promise<AttemptOutcome> {
  const recipient = await resolveRecipientEmail({
    supabase: params.supabase,
    recipientUserId: params.row.recipient_user_id,
    cache: params.recipientCache,
  });
  if (!recipient.email) {
    return {
      status: "skipped",
      errorCode: recipient.errorCode,
      errorMessage: recipient.errorMessage,
      shouldRetry: false,
      providerMessageId: null,
      providerResponse: {
        channel: "email",
        recipientLookup: "failed",
      },
    };
  }
  const content = buildExternalContent(params.row);
  const notifyResult = await sendNotification({
    channel: "email",
    target: recipient.email,
    message: content.text,
    templateKey: content.templateKey,
  });
  if (notifyResult.ok) {
    return {
      status: "sent",
      errorCode: null,
      errorMessage: null,
      shouldRetry: false,
      providerMessageId: notifyResult.providerRef,
      providerResponse: {
        channel: "email",
        templateKey: content.templateKey,
        recipient: recipient.email,
        subject: content.subject,
      },
    };
  }

  const errorText = notifyResult.error || "EMAIL_SEND_FAILED";
  const classified = classifyExternalFailure({
    channel: "email",
    errorText,
  });
  const shouldRetry = shouldRetryExternalFailure({
    channel: "email",
    errorCode: classified.errorCode,
    errorMessage: errorText,
  });

  return {
    status: classified.status,
    errorCode: classified.errorCode,
    errorMessage: errorText,
    shouldRetry: classified.shouldRetry && shouldRetry,
    providerMessageId: notifyResult.providerRef,
    providerResponse: {
      channel: "email",
      templateKey: content.templateKey,
      recipient: recipient.email,
      providerRef: notifyResult.providerRef,
      ok: false,
    },
  };
}

async function dispatchOne(params: {
  supabase: SupabaseClient;
  row: DeliveryRow;
  mode: DispatchMode;
  recipientCache: Map<string, string | null>;
}) {
  const attempts = (params.row.attempts || 0) + 1;
  const maxAttempts = params.row.max_attempts || 3;
  const lastAttemptAt = nowIso();
  const eventType =
    typeof params.row.payload?.eventType === "string"
      ? String(params.row.payload?.eventType)
      : String(params.row.source_ref_type || "");
  const severity = typeof params.row.payload?.severity === "string" ? String(params.row.payload?.severity) : null;

  if (params.row.channel === "in_app") {
    const updated = await updateDeliveryStatus({
      supabase: params.supabase,
      id: params.row.id,
      status: "sent",
      attempts,
      lastAttemptAt,
      sentAt: lastAttemptAt,
      nextRetryAt: null,
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      providerMessageId: params.row.provider_message_id,
      providerResponse: sanitizeProviderResponse(params.row.provider_response),
    });
    return { ok: updated.ok, status: "sent" as DeliveryStatus };
  }

  const allowedChannels = resolveExternalChannels({
    eventType,
    severity,
    recipientRole: params.row.recipient_role,
  });
  if (params.row.channel === "other" || !allowedChannels.includes(params.row.channel)) {
    const updated = await updateDeliveryStatus({
      supabase: params.supabase,
      id: params.row.id,
      status: "skipped",
      attempts,
      lastAttemptAt,
      sentAt: null,
      failedAt: null,
      nextRetryAt: null,
      errorCode: "CHANNEL_POLICY_SKIPPED",
      errorMessage: `Dispatch policy skipped channel ${params.row.channel}`,
      providerMessageId: null,
      providerResponse: sanitizeProviderResponse({
        channel: params.row.channel,
        policy: "skipped",
        reason: "policy_not_allowed",
      }),
    });
    return { ok: updated.ok, status: "skipped" as DeliveryStatus };
  }

  let outcome: AttemptOutcome;

  if (params.row.channel === "email") {
    outcome = await attemptEmail({
      supabase: params.supabase,
      row: params.row,
      recipientCache: params.recipientCache,
    });
  } else if (params.row.channel === "webhook") {
    outcome = await attemptWebhook(params.row);
  } else {
    outcome = {
      status: "skipped",
      errorCode: "CHANNEL_NOT_IMPLEMENTED",
      errorMessage: `Channel ${params.row.channel} is not implemented in this phase`,
      shouldRetry: false,
      providerMessageId: null,
      providerResponse: {
        channel: params.row.channel,
        reason: "not_implemented",
      },
    };
  }

  if (outcome.status === "sent") {
    const updated = await updateDeliveryStatus({
      supabase: params.supabase,
      id: params.row.id,
      status: "sent",
      attempts,
      lastAttemptAt,
      sentAt: lastAttemptAt,
      failedAt: null,
      nextRetryAt: null,
      errorCode: null,
      errorMessage: null,
      providerMessageId: outcome.providerMessageId,
      providerResponse: sanitizeProviderResponse(outcome.providerResponse),
    });
    return { ok: updated.ok, status: "sent" as DeliveryStatus };
  }

  const outcomeAllowsRetry =
    outcome.shouldRetry &&
    shouldRetryExternalFailure({
      channel: params.row.channel,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
    });
  const canRetry = outcomeAllowsRetry && attempts < maxAttempts;
  const updated = await updateDeliveryStatus({
    supabase: params.supabase,
    id: params.row.id,
    status: canRetry ? "retrying" : outcome.status === "skipped" ? "skipped" : "failed",
    attempts,
    lastAttemptAt,
    sentAt: null,
    failedAt: canRetry ? null : lastAttemptAt,
    nextRetryAt: canRetry ? nextRetryIso(15) : null,
    errorCode: outcome.errorCode,
    errorMessage: outcome.errorMessage,
    providerMessageId: outcome.providerMessageId,
    providerResponse: sanitizeProviderResponse(outcome.providerResponse),
  });
  return { ok: updated.ok, status: canRetry ? ("retrying" as DeliveryStatus) : outcome.status };
}

export async function dispatchNotificationDeliveries(params: DispatchParams): Promise<{ ok: true; summary: DispatchSummary } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const deliveryLoad = await listDeliveryRows({
    supabase,
    tenantId: params.tenantId ?? null,
    statuses: params.includeFailed ? ["pending", "retrying", "failed"] : ["pending", "retrying"],
    limit: Math.min(500, Math.max(1, params.limit || 200)),
  });
  if (!deliveryLoad.ok) return { ok: false, error: deliveryLoad.error };

  const candidates = deliveryLoad.items
    .filter((row) => shouldAttemptNow(row, params.includeFailed, params.mode))
    .filter((row) =>
      !params.deliveryIds || params.deliveryIds.length === 0 ? true : params.deliveryIds.includes(row.id),
    );

  const summary: DispatchSummary = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    retrying: 0,
  };
  const recipientCache = new Map<string, string | null>();

  for (const row of candidates) {
    const outcome = await dispatchOne({
      supabase,
      row,
      mode: params.mode,
      recipientCache,
    });
    if (!outcome.ok) continue;
    summary.processed += 1;
    if (outcome.status === "sent") summary.sent += 1;
    if (outcome.status === "skipped") summary.skipped += 1;
    if (outcome.status === "failed") summary.failed += 1;
    if (outcome.status === "retrying") summary.retrying += 1;
  }

  return { ok: true, summary };
}
