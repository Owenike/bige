import type { AppRole } from "./auth-context";
import {
  appRoleSchema,
  channelPreferencesSchema,
  MANAGER_EDITABLE_ROLE_KEYS,
  normalizeChannels,
  NOTIFICATION_CHANNEL_KEYS,
  notificationChannelSchema,
  NOTIFICATION_EVENT_KEYS,
  notificationEventKeySchema,
  NOTIFICATION_PRIORITY_KEYS,
  notificationPrioritySchema,
  uuidLikeSchema,
  type NotificationChannelKey,
  type NotificationEventKey,
  type NotificationPriorityKey,
} from "./notification-productization";
import type { RetryDecisionCode } from "./notification-retry-policy";

export const NOTIFICATION_CHANNEL_POLICY_KEYS = [
  "allowExternal",
  "suppressInApp",
  "throttleMinutes",
  "maxRetries",
  "managerOnly",
] as const;

export type NotificationChannelPolicyKey = (typeof NOTIFICATION_CHANNEL_POLICY_KEYS)[number];

export const NOTIFICATION_API_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID_ROLE",
  "BRANCH_SCOPE_DENIED",
  "INTERNAL_ERROR",
] as const;

export type NotificationApiErrorCode = (typeof NOTIFICATION_API_ERROR_CODES)[number];

export type NotificationApiEnvelope<TData> =
  | { ok: true; data: TData }
  | { ok: false; error?: { code?: string; message?: string }; message?: string; code?: string }
  | TData;

export type NotificationRolePreferenceRecord = {
  id: string;
  tenant_id: string;
  role: AppRole;
  event_type: NotificationEventKey;
  channels: Record<NotificationChannelKey, boolean>;
  is_enabled: boolean;
  source: "platform_default" | "tenant_default" | "custom";
  note: string | null;
  updated_at: string;
};

export type NotificationUserPreferenceRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  event_type: NotificationEventKey;
  channels: Record<NotificationChannelKey, boolean>;
  is_enabled: boolean;
  note: string | null;
  updated_at: string;
};

export type NotificationTemplateRecordContract = {
  id: string;
  tenant_id: string | null;
  event_type: NotificationEventKey;
  channel: NotificationChannelKey;
  locale: string;
  title_template: string;
  message_template: string;
  email_subject: string | null;
  action_url: string | null;
  priority: NotificationPriorityKey;
  channel_policy: Record<string, unknown>;
  is_active: boolean;
  version: number;
  updated_at: string;
};

export type NotificationRetryBlockedReason = {
  id: string;
  code: RetryDecisionCode;
  reason: string;
};

export const NOTIFICATION_QUERY_STATUS_KEYS = ["failed", "retrying", "pending", "sent", "skipped"] as const;
export type NotificationQueryStatusKey = (typeof NOTIFICATION_QUERY_STATUS_KEYS)[number];

export const notificationQueryStatusesSchema = NOTIFICATION_QUERY_STATUS_KEYS;

export function parseRoleQueryValue(input: unknown, options?: {
  includePlatformAdmin?: boolean;
  managerEditableOnly?: boolean;
}): AppRole | null {
  const parsed = appRoleSchema.safeParse(input);
  if (!parsed.success) return null;
  const role = parsed.data;
  if (options?.includePlatformAdmin === false && role === "platform_admin") return null;
  if (options?.managerEditableOnly === true && !(MANAGER_EDITABLE_ROLE_KEYS as readonly string[]).includes(role)) return null;
  return role;
}

export function parseChannelQueryValue(input: unknown): NotificationChannelKey | null {
  const parsed = notificationChannelSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseEventQueryValue(input: unknown): NotificationEventKey | null {
  const parsed = notificationEventKeySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parsePriorityQueryValue(input: unknown): NotificationPriorityKey | null {
  const parsed = notificationPrioritySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCsvQueryParam(input: string | null | undefined) {
  if (!input) return [] as string[];
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseUuidQueryValue(input: unknown) {
  const parsed = uuidLikeSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function buildSingleChannelPreferences(channel: NotificationChannelKey, enabled: boolean) {
  return normalizeChannels(
    channelPreferencesSchema.parse({
      [channel]: enabled,
    }),
  );
}

export function resolveSelectedChannelState(channels: Record<string, boolean> | null | undefined) {
  if (!channels) return { channel: "in_app" as NotificationChannelKey, enabled: true };
  for (const key of NOTIFICATION_CHANNEL_KEYS) {
    if (channels[key]) return { channel: key, enabled: true };
  }
  return { channel: "in_app" as NotificationChannelKey, enabled: true };
}

export function normalizeLocale(input: string | null | undefined, fallback = "zh-TW") {
  const value = String(input || "").trim();
  return value || fallback;
}

export function normalizeOptionalText(input: string | null | undefined) {
  const value = String(input || "").trim();
  return value.length > 0 ? value : null;
}

export function mapPreferenceFormToApiPayload(params: {
  tenantId?: string | null;
  mode: "role" | "user";
  eventType: NotificationEventKey;
  role?: AppRole;
  userId?: string | null;
  channel: NotificationChannelKey;
  channelEnabled: boolean;
  ruleEnabled: boolean;
  source?: "platform_default" | "tenant_default" | "custom";
  note?: string | null;
}) {
  return {
    tenantId: params.tenantId || undefined,
    mode: params.mode,
    eventType: params.eventType,
    role: params.mode === "role" ? params.role : undefined,
    userId: params.mode === "user" ? normalizeOptionalText(params.userId || "") : undefined,
    channels: buildSingleChannelPreferences(params.channel, params.channelEnabled),
    isEnabled: params.ruleEnabled,
    source: params.mode === "role" ? params.source || "custom" : undefined,
    note: normalizeOptionalText(params.note || ""),
  };
}

export function mapTemplateFormToApiPayload(params: {
  id?: string | null;
  tenantId?: string | null;
  eventType: NotificationEventKey;
  channel: NotificationChannelKey;
  locale?: string | null;
  titleTemplate: string;
  messageTemplate: string;
  emailSubject?: string | null;
  actionUrl?: string | null;
  priority?: NotificationPriorityKey | null;
  channelPolicy?: Record<string, unknown>;
  isActive?: boolean;
  version?: number;
  templateKey?: string;
}) {
  return {
    id: params.id || undefined,
    tenantId: params.tenantId || undefined,
    eventType: params.eventType,
    channel: params.channel,
    locale: normalizeLocale(params.locale),
    titleTemplate: params.titleTemplate.trim(),
    messageTemplate: params.messageTemplate.trim(),
    emailSubject: normalizeOptionalText(params.emailSubject || ""),
    actionUrl: normalizeOptionalText(params.actionUrl || ""),
    priority: (params.priority || "info") as NotificationPriorityKey,
    channelPolicy: params.channelPolicy || {},
    isActive: params.isActive !== false,
    version: Math.max(1, Number(params.version || 1)),
    templateKey: params.templateKey,
  };
}

export function mapRetryFilterPayload(params: {
  tenantId?: string | null;
  deliveryIds?: string[];
  statuses?: string[];
  channels?: string[];
  eventType?: string | null;
  limit?: number;
  action: "dry_run" | "execute";
}) {
  return {
    action: params.action,
    tenantId: params.tenantId || null,
    deliveryIds: (params.deliveryIds || []).filter(Boolean),
    statuses: (params.statuses || []).filter((value): value is NotificationQueryStatusKey => NOTIFICATION_QUERY_STATUS_KEYS.includes(value as NotificationQueryStatusKey)),
    channels: (params.channels || []).filter((value): value is NotificationChannelKey => NOTIFICATION_CHANNEL_KEYS.includes(value as NotificationChannelKey)),
    eventType: params.eventType || undefined,
    limit: Math.min(500, Math.max(1, Number(params.limit || 200))),
  };
}

export function buildTemplateKeyPreview(params: {
  tenantId?: string | null;
  eventType: NotificationEventKey;
  channel: NotificationChannelKey;
  locale?: string | null;
}) {
  const scope = params.tenantId ? `tenant:${params.tenantId}` : "global";
  return `${scope}:${params.eventType}:${params.channel}:${normalizeLocale(params.locale)}`;
}

export function isKnownNotificationEventKey(value: string) {
  return NOTIFICATION_EVENT_KEYS.includes(value as NotificationEventKey);
}

export function isKnownNotificationChannelKey(value: string) {
  return NOTIFICATION_CHANNEL_KEYS.includes(value as NotificationChannelKey);
}

export function isKnownNotificationPriority(value: string) {
  return NOTIFICATION_PRIORITY_KEYS.includes(value as NotificationPriorityKey);
}
