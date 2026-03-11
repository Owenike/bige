import type { NotificationRolePreferenceRow, NotificationUserPreferenceRow } from "./notification-preferences";
import type { NotificationTemplateRow } from "./notification-templates";
import type { RetryCandidateRow, RetryPlanSummary } from "./notification-retry-operations";
import {
  buildSingleChannelPreferences,
  buildTemplateKeyPreview,
  mapPreferenceFormToApiPayload,
  mapRetryFilterPayload,
  mapTemplateFormToApiPayload,
  normalizeLocale,
  normalizeOptionalText,
  NOTIFICATION_API_ERROR_CODES,
  NOTIFICATION_CHANNEL_POLICY_KEYS,
  parseChannelQueryValue,
  parseCsvQueryParam,
  parseEventQueryValue,
  parsePriorityQueryValue,
  parseRoleQueryValue,
  parseUuidQueryValue,
  resolveSelectedChannelState,
  type NotificationApiEnvelope,
  type NotificationApiErrorCode,
  type NotificationRolePreferenceRecord,
  type NotificationTemplateRecordContract,
  type NotificationUserPreferenceRecord,
  type NotificationRetryBlockedReason,
  type NotificationQueryStatusKey,
} from "./notification-productization-contracts";
import {
  MANAGER_EDITABLE_ROLE_KEYS,
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_PRIORITY_KEYS,
  NOTIFICATION_ROLE_KEYS,
  type NotificationChannelKey,
  type NotificationEventKey,
  type NotificationPreferenceFormPayload,
  type NotificationRoleKey,
  type NotificationTemplateFormPayload,
  type NotificationPriorityKey,
  type NotificationRetryActionPayload,
} from "./notification-productization";

export {
  buildSingleChannelPreferences,
  buildTemplateKeyPreview,
  MANAGER_EDITABLE_ROLE_KEYS,
  mapPreferenceFormToApiPayload,
  mapRetryFilterPayload,
  mapTemplateFormToApiPayload,
  normalizeLocale,
  normalizeOptionalText,
  NOTIFICATION_API_ERROR_CODES,
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_CHANNEL_POLICY_KEYS,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_PRIORITY_KEYS,
  NOTIFICATION_ROLE_KEYS,
  parseChannelQueryValue,
  parseEventQueryValue,
  parsePriorityQueryValue,
  parseRoleQueryValue,
  parseUuidQueryValue,
  resolveSelectedChannelState,
  type NotificationChannelKey,
  type NotificationEventKey,
  type NotificationApiErrorCode,
  type NotificationApiEnvelope,
  type NotificationPreferenceFormPayload,
  type NotificationRoleKey,
  type NotificationRolePreferenceRecord,
  type NotificationRetryBlockedReason,
  type NotificationTemplateFormPayload,
  type NotificationTemplateRecordContract,
  type NotificationPriorityKey,
  type NotificationQueryStatusKey,
  type NotificationRetryActionPayload,
  type NotificationUserPreferenceRecord,
};

export type NotificationPreferenceRecord = NotificationRolePreferenceRow | NotificationUserPreferenceRow;
export type NotificationTemplateRecord = NotificationTemplateRow;

export type NotificationRetryCandidate = RetryCandidateRow & {
  decision: {
    eligible: boolean;
    code: string;
    reason: string;
  };
};

export type NotificationRetryPlanResult = {
  tenantId: string | null;
  summary: RetryPlanSummary;
  deliveryIds: string[];
  candidates?: NotificationRetryCandidate[];
  filters?: {
    statuses: string[];
    channels: string[];
    eventType: string | null;
    deliveryId: string | null;
  };
};

export type NotificationRetryExecuteResult = {
  mode: "execute" | "dry_run";
  tenantId: string | null;
  retryableCount?: number;
  retriedCount?: number;
  retryableIds?: string[];
  blockedCount: number;
  blocked: Array<{ id: string; code: string; reason: string }>;
  summary?: {
    processed: number;
    sent: number;
    skipped: number;
    failed: number;
    retrying: number;
  };
};

type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error?: { code?: string; message?: string } }
  | T;

export function getApiErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const candidate = payload as { error?: { message?: string }; message?: string };
    if (candidate.error?.message) return candidate.error.message;
    if (candidate.message) return candidate.message;
  }
  return fallback;
}

export async function fetchApiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string; status: number }> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as NotificationApiEnvelope<T> | ApiEnvelope<T> | null;
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: getApiErrorMessage(payload, `Request failed (${response.status})`),
    };
  }
  if (payload && typeof payload === "object" && "ok" in payload) {
    const envelope = payload as { ok: boolean; data?: T; error?: { message?: string } };
    if (envelope.ok && envelope.data !== undefined) {
      return { ok: true, data: envelope.data };
    }
    return {
      ok: false,
      status: response.status,
      message: envelope.error?.message || "Unexpected response payload",
    };
  }
  return { ok: true, data: payload as T };
}

export function normalizeTemplatePayload(payload: NotificationTemplateFormPayload): NotificationTemplateFormPayload {
  const locale = normalizeLocale(payload.locale || "zh-TW");
  const normalizedPriority = (payload.priority || "info") as NotificationPriorityKey;
  return {
    ...payload,
    locale,
    priority: normalizedPriority,
    titleTemplate: payload.titleTemplate.trim(),
    messageTemplate: payload.messageTemplate.trim(),
    emailSubject: normalizeOptionalText(payload.emailSubject || ""),
    actionUrl: normalizeOptionalText(payload.actionUrl || ""),
  };
}

export function parseJsonObjectText(text: string, fieldName: string) {
  const raw = text.trim() || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseCsvInput(input: string | null | undefined) {
  return parseCsvQueryParam(input);
}

export function toOptionalTrimmed(value: string) {
  return normalizeOptionalText(value);
}

export function clampRetryLimit(input: string, fallback = 200) {
  const numeric = Number(input || fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(500, Math.max(1, Math.floor(numeric)));
}
