import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import {
  listDeliveryRows,
  updateDeliveryStatus,
  type DeliveryRow,
  type DeliveryStatus,
} from "./notification-ops";
import { resolveExternalChannels, shouldRetryExternalFailure } from "./notification-external";
import { shouldSkipBookingDelivery } from "./booking-notifications";
import { dispatchNotificationViaAdapter, type DeliveryRuntimeCache } from "./notification-delivery-adapter";
import { ingestNotificationDeliveryEvent } from "./notification-delivery-events";

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
  deadLetter: number;
};

const PROVIDER_RESPONSE_MAX_STRING = 300;
const PROVIDER_RESPONSE_MAX_KEYS = 20;
const PROVIDER_RESPONSE_MAX_DEPTH = 3;

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
  if (row.status === "cancelled") return false;
  if (row.scheduled_for && new Date(row.scheduled_for).getTime() > Date.now()) return false;
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

async function recordDeliveryEvent(params: {
  supabase: SupabaseClient;
  row: DeliveryRow;
  eventType: "delivered" | "failed";
  provider: string | null;
  providerMessageId: string | null;
  providerResponse: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  statusAfter?: DeliveryStatus;
  markDeadLetter?: boolean;
}) {
  await ingestNotificationDeliveryEvent({
    supabase: params.supabase,
    deliveryId: params.row.id,
    eventType: params.eventType,
    provider: params.provider,
    providerMessageId: params.providerMessageId,
    providerResponse: params.providerResponse || undefined,
    errorCode: params.errorCode || null,
    errorMessage: params.errorMessage || null,
    statusAfter: params.statusAfter || null,
    markDeadLetter: params.markDeadLetter,
    applyStatusUpdate: false,
    metadata: {
      bookingId: params.row.booking_id,
      sourceRefType: params.row.source_ref_type,
    },
  }).catch(() => null);
}

async function dispatchOne(params: {
  supabase: SupabaseClient;
  row: DeliveryRow;
  runtimeCache: DeliveryRuntimeCache;
}) {
  const bookingSkip = await shouldSkipBookingDelivery({
    supabase: params.supabase,
    row: params.row,
  });
  if (bookingSkip?.shouldSkip) {
    const lastAttemptAt = nowIso();
    const updated = await updateDeliveryStatus({
      supabase: params.supabase,
      id: params.row.id,
      status: bookingSkip.status,
      attempts: params.row.attempts || 0,
      retryCount: params.row.retry_count || 0,
      lastAttemptAt: params.row.last_attempt_at,
      sentAt: params.row.sent_at,
      deliveredAt: params.row.delivered_at,
      failedAt: bookingSkip.status === "failed" ? lastAttemptAt : params.row.failed_at,
      deadLetterAt: params.row.dead_letter_at,
      cancelledAt: bookingSkip.status === "cancelled" ? lastAttemptAt : params.row.cancelled_at,
      nextRetryAt: null,
      lastError: bookingSkip.reason,
      errorCode: bookingSkip.status === "failed" ? "BOOKING_NOTIFICATION_INVALID" : null,
      errorMessage: bookingSkip.status === "failed" ? bookingSkip.reason : null,
      skippedReason: bookingSkip.status === "cancelled" ? bookingSkip.reason : params.row.skipped_reason,
      failureReason: bookingSkip.status === "failed" ? bookingSkip.reason : params.row.failure_reason,
      provider: params.row.provider,
      providerMessageId: params.row.provider_message_id,
      providerResponse: sanitizeProviderResponse({
        reason: bookingSkip.reason,
        bookingId: params.row.booking_id,
      }),
    });
    return { ok: updated.ok, status: bookingSkip.status };
  }

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
      retryCount: Math.max(0, attempts - 1),
      lastAttemptAt,
      sentAt: lastAttemptAt,
      deliveredAt: lastAttemptAt,
      nextRetryAt: null,
      failedAt: null,
      deadLetterAt: null,
      lastError: null,
      errorCode: null,
      errorMessage: null,
      provider: params.row.provider || "in_app",
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
      retryCount: Math.max(0, attempts - 1),
      lastAttemptAt,
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
      deadLetterAt: null,
      lastError: null,
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

  const outcome = await dispatchNotificationViaAdapter({
    supabase: params.supabase,
    row: params.row,
    cache: params.runtimeCache,
  });

  if (outcome.status === "sent") {
    const updated = await updateDeliveryStatus({
      supabase: params.supabase,
      id: params.row.id,
      status: "sent",
      attempts,
      retryCount: Math.max(0, attempts - 1),
      lastAttemptAt,
      sentAt: lastAttemptAt,
      deliveredAt: null,
      failedAt: null,
      deadLetterAt: null,
      cancelledAt: null,
      lastError: null,
      nextRetryAt: null,
      errorCode: null,
      errorMessage: null,
      skippedReason: null,
      failureReason: null,
      provider: outcome.provider,
      providerMessageId: outcome.providerMessageId,
      providerResponse: sanitizeProviderResponse(outcome.providerResponse),
    });
    if (updated.ok) {
      await recordDeliveryEvent({
        supabase: params.supabase,
        row: params.row,
        eventType: "delivered",
        provider: outcome.provider,
        providerMessageId: outcome.providerMessageId,
        providerResponse: sanitizeProviderResponse(outcome.providerResponse),
        statusAfter: "sent",
      });
    }
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
  const terminalStatus: DeliveryStatus = canRetry
    ? "retrying"
    : outcome.status === "skipped"
      ? "skipped"
      : "dead_letter";
  const updated = await updateDeliveryStatus({
    supabase: params.supabase,
    id: params.row.id,
    status: terminalStatus,
    attempts,
    retryCount: Math.max(0, attempts - 1),
    lastAttemptAt,
    sentAt: null,
    deliveredAt: null,
    failedAt: canRetry || terminalStatus === "skipped" ? null : lastAttemptAt,
    deadLetterAt: terminalStatus === "dead_letter" ? lastAttemptAt : null,
    cancelledAt: null,
    nextRetryAt: canRetry ? nextRetryIso(15) : null,
    errorCode: outcome.errorCode,
    errorMessage: outcome.errorMessage,
    lastError: outcome.errorMessage,
    skippedReason: terminalStatus === "skipped" ? outcome.errorMessage : null,
    failureReason: terminalStatus === "dead_letter" || terminalStatus === "retrying" ? outcome.errorMessage : null,
    provider: outcome.provider,
    providerMessageId: outcome.providerMessageId,
    providerResponse: sanitizeProviderResponse(outcome.providerResponse),
  });
  if (updated.ok && terminalStatus !== "skipped") {
    await recordDeliveryEvent({
      supabase: params.supabase,
      row: params.row,
      eventType: "failed",
      provider: outcome.provider,
      providerMessageId: outcome.providerMessageId,
      providerResponse: sanitizeProviderResponse(outcome.providerResponse),
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      statusAfter: terminalStatus,
      markDeadLetter: terminalStatus === "dead_letter",
    });
  }
  return { ok: updated.ok, status: terminalStatus };
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
    deadLetter: 0,
  };
  const runtimeCache: DeliveryRuntimeCache = {
    settings: new Map(),
  };

  for (const row of candidates) {
    const outcome = await dispatchOne({
      supabase,
      row,
      runtimeCache,
    });
    if (!outcome.ok) continue;
    summary.processed += 1;
    if (outcome.status === "sent") summary.sent += 1;
    if (outcome.status === "skipped") summary.skipped += 1;
    if (outcome.status === "failed") summary.failed += 1;
    if (outcome.status === "retrying") summary.retrying += 1;
    if (outcome.status === "dead_letter") {
      summary.deadLetter += 1;
      summary.failed += 1;
    }
  }

  return { ok: true, summary };
}
