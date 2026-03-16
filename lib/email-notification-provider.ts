import { createHmac, timingSafeEqual } from "crypto";
import type { ProviderReconcileStatus } from "./notification-provider-reconcile";

export type EmailProviderName = "generic" | "generic_email" | "sendgrid" | "postmark" | "resend";

export type EmailProviderCallbackEvent = {
  deliveryId: string | null;
  providerMessageId: string | null;
  providerEventId: string | null;
  providerStatus: ProviderReconcileStatus;
  occurredAt: string | null;
  tenantId: string | null;
  branchId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
};

function normalizeProvider(input: string | null | undefined): EmailProviderName {
  const value = String(input || "").trim().toLowerCase();
  if (value === "sendgrid" || value === "postmark" || value === "resend" || value === "generic") return value;
  return "generic_email";
}

function toIso(input: unknown) {
  if (typeof input !== "string") return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function asRecord(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function mapGenericStatus(input: string): ProviderReconcileStatus | null {
  const value = input.trim().toLowerCase();
  const mapping: Record<string, ProviderReconcileStatus> = {
    queued: "queued",
    accepted: "accepted",
    processing: "processing",
    retrying: "retrying",
    delivered: "delivered",
    sent: "sent",
    failed: "failed",
    bounced: "bounced",
    rejected: "rejected",
    complained: "complained",
    cancelled: "cancelled",
    canceled: "cancelled",
    suppressed: "suppressed",
    skipped: "skipped",
    opened: "opened",
    clicked: "clicked",
  };
  return mapping[value] || null;
}

function mapSendgridStatus(input: string): ProviderReconcileStatus | null {
  const value = input.trim().toLowerCase();
  const mapping: Record<string, ProviderReconcileStatus> = {
    processed: "accepted",
    deferred: "retrying",
    delivered: "delivered",
    bounce: "bounced",
    dropped: "suppressed",
    spamreport: "complained",
    open: "opened",
    click: "clicked",
  };
  return mapping[value] || mapGenericStatus(value);
}

function mapPostmarkStatus(input: string): ProviderReconcileStatus | null {
  const value = input.trim().toLowerCase();
  const mapping: Record<string, ProviderReconcileStatus> = {
    delivery: "delivered",
    bounce: "bounced",
    spamcomplaint: "complained",
    open: "opened",
    click: "clicked",
  };
  return mapping[value] || mapGenericStatus(value);
}

function mapResendStatus(input: string): ProviderReconcileStatus | null {
  const value = input.trim().toLowerCase();
  const mapping: Record<string, ProviderReconcileStatus> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.delivery_delayed": "retrying",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.opened": "opened",
    "email.clicked": "clicked",
  };
  return mapping[value] || mapGenericStatus(value);
}

function parseGenericEvents(body: unknown) {
  const rows = Array.isArray((body as { events?: unknown[] } | null)?.events)
    ? ((body as { events: unknown[] }).events || [])
    : Array.isArray(body)
      ? body
      : [body];
  return rows
    .map((item) => {
      const row = asRecord(item);
      const providerStatus = mapGenericStatus(readString(row, ["providerStatus", "status", "event"]) || "");
      if (!providerStatus) return null;
      return {
        deliveryId: readString(row, ["deliveryId", "delivery_id"]),
        providerMessageId: readString(row, ["providerMessageId", "provider_message_id", "messageId", "message_id"]),
        providerEventId: readString(row, ["providerEventId", "provider_event_id", "eventId", "event_id"]),
        providerStatus,
        occurredAt: toIso(readString(row, ["occurredAt", "occurred_at", "timestamp", "eventTime", "event_time"])),
        tenantId: readString(row, ["tenantId", "tenant_id"]),
        branchId: readString(row, ["branchId", "branch_id"]),
        errorCode: readString(row, ["errorCode", "error_code"]),
        errorMessage: readString(row, ["errorMessage", "error_message", "reason"]),
        metadata: row,
      } satisfies EmailProviderCallbackEvent;
    })
    .filter((item): item is EmailProviderCallbackEvent => Boolean(item));
}

function parseSendgridEvents(body: unknown) {
  const rows = Array.isArray(body) ? body : [body];
  return rows
    .map((item) => {
      const row = asRecord(item);
      const providerStatus = mapSendgridStatus(readString(row, ["event"]) || "");
      if (!providerStatus) return null;
      return {
        deliveryId: readString(row, ["delivery_id", "deliveryId"]),
        providerMessageId: readString(row, ["sg_message_id", "smtp-id", "message_id"]),
        providerEventId: readString(row, ["sg_event_id", "event_id"]),
        providerStatus,
        occurredAt:
          typeof row?.timestamp === "number"
            ? new Date(Number(row.timestamp) * 1000).toISOString()
            : toIso(readString(row, ["timestamp", "event_time"])),
        tenantId: readString(row, ["tenant_id", "tenantId"]),
        branchId: readString(row, ["branch_id", "branchId"]),
        errorCode: readString(row, ["reason", "status"]),
        errorMessage: readString(row, ["response", "reason"]),
        metadata: row,
      } satisfies EmailProviderCallbackEvent;
    })
    .filter((item): item is EmailProviderCallbackEvent => Boolean(item));
}

function parsePostmarkEvents(body: unknown) {
  const row = asRecord(body);
  const providerStatus = mapPostmarkStatus(readString(row, ["RecordType", "record_type", "Type"]) || "");
  if (!providerStatus) return [];
  return [
    {
      deliveryId: readString(row, ["delivery_id", "deliveryId"]),
      providerMessageId: readString(row, ["MessageID", "MessageId", "message_id"]),
      providerEventId: readString(row, ["ID", "event_id"]),
      providerStatus,
      occurredAt: toIso(readString(row, ["DeliveredAt", "ReceivedAt", "BouncedAt"])),
      tenantId: readString(row, ["tenant_id", "tenantId"]),
      branchId: readString(row, ["branch_id", "branchId"]),
      errorCode: readString(row, ["Type", "TypeCode"]),
      errorMessage: readString(row, ["Description", "Details"]),
      metadata: row,
    } satisfies EmailProviderCallbackEvent,
  ];
}

function parseResendEvents(body: unknown) {
  const rows = Array.isArray((body as { data?: unknown[] } | null)?.data)
    ? ((body as { data: unknown[] }).data || [])
    : Array.isArray(body)
      ? body
      : [body];
  return rows
    .map((item) => {
      const row = asRecord(item);
      const providerStatus = mapResendStatus(readString(row, ["type", "event"]) || "");
      if (!providerStatus) return null;
      const data = asRecord(row?.data);
      return {
        deliveryId: readString(data, ["delivery_id", "deliveryId"]) || readString(row, ["delivery_id", "deliveryId"]),
        providerMessageId: readString(data, ["email_id", "message_id"]) || readString(row, ["email_id", "message_id"]),
        providerEventId: readString(row, ["id", "event_id"]),
        providerStatus,
        occurredAt: toIso(readString(row, ["created_at", "occurred_at", "timestamp"])),
        tenantId: readString(data, ["tenant_id", "tenantId"]) || readString(row, ["tenant_id", "tenantId"]),
        branchId: readString(data, ["branch_id", "branchId"]) || readString(row, ["branch_id", "branchId"]),
        errorCode: readString(data, ["error_code"]) || readString(row, ["reason"]),
        errorMessage: readString(data, ["error_message"]) || readString(row, ["reason"]),
        metadata: row,
      } satisfies EmailProviderCallbackEvent;
    })
    .filter((item): item is EmailProviderCallbackEvent => Boolean(item));
}

export function parseEmailProviderCallbackPayload(params: {
  provider: string | null | undefined;
  body: unknown;
}) {
  const provider = normalizeProvider(params.provider);
  if (provider === "sendgrid") return parseSendgridEvents(params.body);
  if (provider === "postmark") return parsePostmarkEvents(params.body);
  if (provider === "resend") return parseResendEvents(params.body);
  return parseGenericEvents(params.body);
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyEmailProviderWebhookSignature(params: {
  provider: string | null | undefined;
  rawBody: string;
  headers: Headers;
}) {
  const secret = process.env.EMAIL_NOTIFY_WEBHOOK_SECRET || "";
  const token = process.env.EMAIL_NOTIFY_WEBHOOK_TOKEN || "";
  const signatureHeader =
    params.headers.get("x-email-signature") ||
    params.headers.get("x-notify-signature") ||
    params.headers.get("x-webhook-signature") ||
    "";
  const tokenHeader =
    params.headers.get("x-email-webhook-token") ||
    params.headers.get("x-notify-webhook-token") ||
    params.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (secret) {
    const expected = `sha256=${createHmac("sha256", secret).update(params.rawBody).digest("hex")}`;
    if (!signatureHeader) {
      return { ok: false as const, reason: "missing_signature" };
    }
    if (!safeEquals(signatureHeader, expected)) {
      return { ok: false as const, reason: "invalid_signature" };
    }
    return { ok: true as const, mode: "hmac" as const };
  }

  if (!token) {
    return { ok: false as const, reason: "missing_webhook_secret" };
  }
  if (!tokenHeader) {
    return { ok: false as const, reason: "missing_token" };
  }
  if (!safeEquals(tokenHeader, token)) {
    return { ok: false as const, reason: "invalid_token" };
  }
  return { ok: true as const, mode: "shared_token" as const };
}
