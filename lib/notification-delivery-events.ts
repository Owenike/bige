import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import { updateDeliveryStatus, type DeliveryChannel, type DeliveryStatus } from "./notification-ops";

export type NotificationDeliveryEventType = "delivered" | "failed" | "opened" | "clicked" | "conversion";

export type NotificationDeliveryEventRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  delivery_id: string | null;
  notification_id: string | null;
  channel: DeliveryChannel;
  event_type: NotificationDeliveryEventType;
  event_at: string;
  provider: string | null;
  provider_event_id: string | null;
  provider_message_id: string | null;
  status_before: DeliveryStatus | null;
  status_after: DeliveryStatus | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

type DeliveryEventIngestInput = {
  supabase?: SupabaseClient;
  deliveryId: string;
  eventType: NotificationDeliveryEventType;
  eventAt?: string | null;
  provider?: string | null;
  providerEventId?: string | null;
  providerMessageId?: string | null;
  providerResponse?: Record<string, unknown> | null;
  channel?: DeliveryChannel | null;
  statusAfter?: DeliveryStatus | null;
  markDeadLetter?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
  applyStatusUpdate?: boolean;
};

type DeliveryEventListInput = {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  deliveryId?: string | null;
  eventTypes?: NotificationDeliveryEventType[];
  channel?: DeliveryChannel | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
};

const PROVIDER_RESPONSE_MAX_BYTES = 16 * 1024;
const PROVIDER_RESPONSE_MAX_DEPTH = 4;
const PROVIDER_RESPONSE_MAX_ARRAY = 30;
const PROVIDER_RESPONSE_MAX_STRING = 1000;
const REDACT_KEY_PATTERN = /(authorization|token|secret|password|api[_-]?key|cookie|set-cookie)/i;

type DeliverySnapshot = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  notification_id: string | null;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  attempts: number;
  retry_count: number;
  max_attempts: number;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  dead_letter_at: string | null;
  last_error: string | null;
  error_code: string | null;
  error_message: string | null;
  provider_message_id: string | null;
  provider_response: Record<string, unknown> | null;
};

function normalizeIso(input: string | null | undefined) {
  if (!input) return new Date().toISOString();
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function mergeMetadata(base: Record<string, unknown> | null, patch: Record<string, unknown> | null | undefined) {
  return {
    ...(base || {}),
    ...(patch || {}),
  };
}

function sanitizeProviderResponseValue(value: unknown, depth: number): unknown {
  if (depth > PROVIDER_RESPONSE_MAX_DEPTH) return "[depth_limited]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > PROVIDER_RESPONSE_MAX_STRING ? `${value.slice(0, PROVIDER_RESPONSE_MAX_STRING)}[truncated]` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, PROVIDER_RESPONSE_MAX_ARRAY).map((item) => sanitizeProviderResponseValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(source)) {
      if (REDACT_KEY_PATTERN.test(key)) {
        target[key] = "[redacted]";
        continue;
      }
      target[key] = sanitizeProviderResponseValue(nested, depth + 1);
    }
    return target;
  }
  return String(value);
}

function sanitizeProviderResponse(input: Record<string, unknown> | null | undefined) {
  if (!input) return {};
  const sanitized = sanitizeProviderResponseValue(input, 0);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return {};
  const serialized = JSON.stringify(sanitized);
  if (serialized.length <= PROVIDER_RESPONSE_MAX_BYTES) return sanitized as Record<string, unknown>;
  return {
    truncated: true,
    reason: "provider_response_too_large",
    bytes: serialized.length,
  };
}

function resolveStatusAfter(params: {
  eventType: NotificationDeliveryEventType;
  statusBefore: DeliveryStatus;
  explicitStatusAfter?: DeliveryStatus | null;
  markDeadLetter?: boolean;
}): DeliveryStatus {
  if (params.explicitStatusAfter) return params.explicitStatusAfter;
  if (params.eventType === "delivered") return "sent";
  if (params.eventType === "failed") return params.markDeadLetter ? "dead_letter" : "failed";
  return params.statusBefore;
}

async function getDeliverySnapshot(supabase: SupabaseClient, deliveryId: string) {
  const result = await supabase
    .from("notification_deliveries")
    .select("id, tenant_id, branch_id, notification_id, channel, status, attempts, retry_count, max_attempts, last_attempt_at, next_retry_at, sent_at, delivered_at, failed_at, dead_letter_at, last_error, error_code, error_message, provider_message_id, provider_response")
    .eq("id", deliveryId)
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, row: null as DeliverySnapshot | null };
  if (!result.data) return { ok: false as const, error: "Delivery not found", row: null as DeliverySnapshot | null };
  return { ok: true as const, row: result.data as DeliverySnapshot };
}

export async function listNotificationDeliveryEvents(params: DeliveryEventListInput) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  let query = supabase
    .from("notification_delivery_events")
    .select("id, tenant_id, branch_id, delivery_id, notification_id, channel, event_type, event_at, provider, provider_event_id, provider_message_id, status_before, status_after, metadata, created_by, created_at")
    .order("event_at", { ascending: false })
    .limit(Math.min(1000, Math.max(1, Number(params.limit || 200))));
  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  if (params.deliveryId) query = query.eq("delivery_id", params.deliveryId);
  if (params.eventTypes && params.eventTypes.length > 0) query = query.in("event_type", params.eventTypes);
  if (params.channel) query = query.eq("channel", params.channel);
  if (params.from) query = query.gte("event_at", params.from);
  if (params.to) query = query.lte("event_at", params.to);
  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message, items: [] as NotificationDeliveryEventRow[] };
  return { ok: true as const, items: (result.data || []) as NotificationDeliveryEventRow[] };
}

export async function ingestNotificationDeliveryEvent(input: DeliveryEventIngestInput) {
  const supabase = input.supabase ?? createSupabaseAdminClient();
  const delivery = await getDeliverySnapshot(supabase, input.deliveryId);
  if (!delivery.ok) return { ok: false as const, error: delivery.error, item: null as NotificationDeliveryEventRow | null };
  if (!delivery.row.tenant_id) return { ok: false as const, error: "Delivery tenant is missing", item: null as NotificationDeliveryEventRow | null };

  const eventAt = normalizeIso(input.eventAt);
  const statusBefore = delivery.row.status;
  const statusAfter = resolveStatusAfter({
    eventType: input.eventType,
    statusBefore,
    explicitStatusAfter: input.statusAfter || null,
    markDeadLetter: input.markDeadLetter,
  });
  const channel = input.channel || delivery.row.channel;
  const providerMessageId = input.providerMessageId || delivery.row.provider_message_id || null;
  const sanitizedProviderResponse = sanitizeProviderResponse(input.providerResponse || null);
  const providerResponse = mergeMetadata(delivery.row.provider_response, sanitizedProviderResponse);
  const shouldUpdateDelivery = input.applyStatusUpdate !== false;

  if (shouldUpdateDelivery && (input.eventType === "delivered" || input.eventType === "failed")) {
    const update = await updateDeliveryStatus({
      supabase,
      id: delivery.row.id,
      status: statusAfter,
      attempts: delivery.row.attempts || 0,
      retryCount: delivery.row.retry_count || 0,
      lastAttemptAt: eventAt,
      nextRetryAt: input.eventType === "failed" ? null : delivery.row.next_retry_at,
      sentAt: input.eventType === "delivered" ? (delivery.row.sent_at || eventAt) : delivery.row.sent_at,
      deliveredAt: input.eventType === "delivered" ? eventAt : delivery.row.delivered_at,
      failedAt: input.eventType === "failed" ? eventAt : delivery.row.failed_at,
      deadLetterAt: statusAfter === "dead_letter" ? eventAt : null,
      lastError: input.eventType === "failed" ? (input.errorMessage || delivery.row.last_error || delivery.row.error_message) : null,
      errorCode: input.eventType === "failed" ? (input.errorCode || delivery.row.error_code) : null,
      errorMessage: input.eventType === "failed" ? (input.errorMessage || delivery.row.error_message) : null,
      providerMessageId,
      providerResponse,
    });
    if (!update.ok) return { ok: false as const, error: update.error, item: null as NotificationDeliveryEventRow | null };
  }

  const eventInsert = await supabase
    .from("notification_delivery_events")
    .insert({
      tenant_id: delivery.row.tenant_id,
      branch_id: delivery.row.branch_id,
      delivery_id: delivery.row.id,
      notification_id: delivery.row.notification_id,
      channel,
      event_type: input.eventType,
      event_at: eventAt,
      provider: input.provider || null,
      provider_event_id: input.providerEventId || null,
      provider_message_id: providerMessageId,
      status_before: statusBefore,
      status_after: statusAfter,
      metadata: mergeMetadata(input.metadata || {}, input.providerResponse ? { providerResponse: sanitizedProviderResponse } : null),
      created_by: input.actorId || null,
    })
    .select("id, tenant_id, branch_id, delivery_id, notification_id, channel, event_type, event_at, provider, provider_event_id, provider_message_id, status_before, status_after, metadata, created_by, created_at")
    .maybeSingle();
  if (eventInsert.error) {
    if (eventInsert.error.code === "23505" && input.provider && input.providerEventId) {
      const existing = await supabase
        .from("notification_delivery_events")
        .select("id, tenant_id, branch_id, delivery_id, notification_id, channel, event_type, event_at, provider, provider_event_id, provider_message_id, status_before, status_after, metadata, created_by, created_at")
        .eq("provider", input.provider)
        .eq("provider_event_id", input.providerEventId)
        .maybeSingle();
      if (existing.error) return { ok: false as const, error: existing.error.message, item: null as NotificationDeliveryEventRow | null };
      if (existing.data) {
        return {
          ok: true as const,
          item: existing.data as NotificationDeliveryEventRow,
          deduped: true as const,
        };
      }
    }
    return { ok: false as const, error: eventInsert.error.message, item: null as NotificationDeliveryEventRow | null };
  }

  return {
    ok: true as const,
    item: (eventInsert.data || null) as NotificationDeliveryEventRow | null,
    deduped: false as const,
  };
}
