import { appRoleSchema, notificationChannelSchema, NOTIFICATION_EVENT_KEYS } from "./notification-productization";
import { fetchApiJson } from "./notification-productization-ui";

export type NotificationGovernanceMode = "platform" | "manager";

export const NOTIFICATION_AUDIT_ACTIONS = [
  "preference_upsert",
  "template_upsert",
  "retry_dry_run",
  "retry_execute",
] as const;

export type NotificationAuditAction = (typeof NOTIFICATION_AUDIT_ACTIONS)[number];

export type NotificationAuditQuery = {
  tenantId: string | null;
  action: NotificationAuditAction | null;
  resourceType: string | null;
  actorUserId: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  cursor: string | null;
};

export type NotificationAuditItem = {
  id: string;
  action: string;
  actor: {
    userId: string | null;
    role: string | null;
  };
  tenantId: string | null;
  scope: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
  metadataSummary: {
    keys: string[];
    blockedCodes: string[];
    blockedCount: number;
  };
};

export type NotificationAuditApiPayload = {
  scope: string;
  tenantId: string | null;
  items: NotificationAuditItem[];
  nextCursor: string | null;
};

export type NotificationConfigIntegrityQuery = {
  tenantId: string | null;
  defaultLocale: string;
};

export type NotificationConfigIntegrityApiPayload = {
  scope: string;
  tenantId: string;
  integrity: {
    score: number;
    healthStatus: string;
    summary: {
      expectedRoleEventPairs: number;
      configuredRoleEventPairs: number;
      expectedTemplatePairs: number;
      coveredTemplatePairs: number;
      channelReadinessRate: number;
    };
    missingItems: {
      missingRoleEventPairs: Array<{ role: string; eventType: string }>;
      missingTemplatePairs: Array<{ eventType: string; channel: string }>;
      enabledChannelsWithoutTemplate: Array<{ channel: string; eventTypes: string[] }>;
    };
    warnings: string[];
  };
};

export type NotificationPreflightQuery = {
  tenantId: string | null;
  eventKey: (typeof NOTIFICATION_EVENT_KEYS)[number];
  roleKey: string | null;
  userId: string | null;
  channelHint: string | null;
  locale: string;
  defaultLocale: string;
  recipientLimit: number;
};

export type NotificationPreflightApiPayload = {
  scope: string;
  tenantId: string;
  preflight: {
    scope: "tenant";
    tenantId: string;
    input: {
      eventKey: string;
      roleKey: string | null;
      userId: string | null;
      channelHint: string | null;
      locale: string;
      defaultLocale: string;
      recipientLimit: number;
    };
    preference: {
      enabled: boolean;
      channels: Record<string, boolean>;
      source: string;
      reason: string;
      explain: string;
      trace: Array<{ source: string; enabled: boolean; applied: boolean; reason: string }>;
    };
    templates: {
      channelsEvaluated: string[];
      resolutions: Array<{
        channel: string;
        found: boolean;
        source: string;
        strategy: string;
        templateId: string | null;
        locale: string | null;
        priority: string | null;
        missingReason: string | null;
      }>;
    };
    deliveryPlanning: {
      ready: boolean;
      plannedChannels: string[];
      plannedRecipientsCount: number;
      plannedRecipientsPreview: Array<{ userId: string; role: string | null }>;
      skippedReasons: Array<{ code: string; message: string }>;
      contentSkeleton: Record<string, unknown>;
    };
    coverage: {
      integrityScore: number;
      integrityHealthStatus: string;
      missingRoleEventPairs: number;
      missingTemplatePairs: number;
      enabledChannelsWithoutTemplate: number;
      missingForSelectedEvent: Array<{ channel: string; reason: string }>;
    };
    warnings: string[];
  };
};

export type NotificationRuntimeReadinessQuery = {
  tenantId: string | null;
  eventKey: (typeof NOTIFICATION_EVENT_KEYS)[number];
  roleKey: string | null;
  userId: string | null;
  channelHint: string | null;
  locale: string;
  defaultLocale: string;
  recipientLimit: number;
  scenarioId: string | null;
};

export type NotificationRuntimeReadinessApiPayload = {
  scope: "platform" | "tenant";
  tenantId: string;
  source: "live" | "fixture";
  scenarioId: string | null;
  report: {
    eventInput: {
      tenantId: string;
      eventKey: string;
      roleKey: string | null;
      userId: string | null;
      channelHint: string | null;
      locale: string;
      defaultLocale: string;
      recipientLimit: number;
      payload: Record<string, unknown>;
    };
    preference: {
      enabled: boolean;
      channels: Record<string, boolean>;
      source: string;
      reason: string;
      explain: string;
      trace: Array<{ source: string; enabled: boolean; applied: boolean; reason: string }>;
    };
    templates: Array<{
      channel: string;
      found: boolean;
      source: string;
      strategy: string;
      fallbackReason: string | null;
      template: {
        id: string;
        tenantId: string | null;
        locale: string;
        priority: string;
        titleTemplate: string;
        messageTemplate: string;
        emailSubject: string | null;
        actionUrl: string | null;
        channelPolicy: Record<string, unknown>;
        version: number;
      } | null;
      missingReason: string | null;
    }>;
    deliveryPlanning: {
      ready: boolean;
      plannedChannels: string[];
      plannedRecipients: Array<{
        userId: string;
        role: string | null;
        plannedChannels: string[];
      }>;
      plannedContentSkeleton: Record<string, unknown>;
      skippedReasons: Array<{ code: string; message: string }>;
    };
    readiness: {
      ready: boolean;
      missingPreferences: Array<{ roleKey: string | null; eventKey: string; reason: string }>;
      missingTemplates: Array<{ channel: string; reason: string }>;
      unavailableChannels: Array<{ channel: string; reason: string }>;
      fallbacks: Array<{ channel: string; strategy: string; reason: string }>;
    };
    warnings: Array<{ code: string; message: string }>;
  };
};

function optionalValue(input: string | null) {
  const value = String(input || "").trim();
  return value || null;
}

function clampLimit(input: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(input || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function parseDateTimeInputToIso(input: string | null | undefined) {
  const value = String(input || "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function formatIsoToLocalDateTimeInput(input: string | null | undefined) {
  const value = String(input || "").trim();
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const tzOffset = parsed.getTimezoneOffset();
  return new Date(parsed.getTime() - tzOffset * 60_000).toISOString().slice(0, 16);
}

export function parseNotificationAuditUiQuery(params: URLSearchParams, mode: NotificationGovernanceMode): NotificationAuditQuery {
  const actionRaw = optionalValue(params.get("action"));
  const action = actionRaw && (NOTIFICATION_AUDIT_ACTIONS as readonly string[]).includes(actionRaw) ? (actionRaw as NotificationAuditAction) : null;
  return {
    tenantId: mode === "platform" ? optionalValue(params.get("tenantId")) : null,
    action,
    resourceType: optionalValue(params.get("resourceType")),
    actorUserId: optionalValue(params.get("actorUserId")),
    from: parseDateTimeInputToIso(params.get("from")),
    to: parseDateTimeInputToIso(params.get("to")),
    limit: clampLimit(params.get("limit"), 50, 1, 200),
    cursor: parseDateTimeInputToIso(params.get("cursor")),
  };
}

export function buildNotificationAuditUiSearchParams(query: NotificationAuditQuery, mode: NotificationGovernanceMode) {
  const params = new URLSearchParams();
  if (mode === "platform" && query.tenantId) params.set("tenantId", query.tenantId);
  if (query.action) params.set("action", query.action);
  if (query.resourceType) params.set("resourceType", query.resourceType);
  if (query.actorUserId) params.set("actorUserId", query.actorUserId);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.cursor) params.set("cursor", query.cursor);
  params.set("limit", String(query.limit));
  return params;
}

export async function fetchNotificationAuditUiData(mode: NotificationGovernanceMode, query: NotificationAuditQuery) {
  const base = mode === "platform" ? "/api/platform/notifications/audit" : "/api/manager/notifications/audit";
  const params = buildNotificationAuditUiSearchParams(query, mode);
  return fetchApiJson<NotificationAuditApiPayload>(`${base}?${params.toString()}`, { cache: "no-store" });
}

export function parseNotificationConfigIntegrityUiQuery(
  params: URLSearchParams,
  mode: NotificationGovernanceMode,
): NotificationConfigIntegrityQuery {
  return {
    tenantId: mode === "platform" ? optionalValue(params.get("tenantId")) : null,
    defaultLocale: optionalValue(params.get("defaultLocale")) || "zh-TW",
  };
}

export function buildNotificationConfigIntegrityUiSearchParams(
  query: NotificationConfigIntegrityQuery,
  mode: NotificationGovernanceMode,
) {
  const params = new URLSearchParams();
  if (mode === "platform" && query.tenantId) params.set("tenantId", query.tenantId);
  if (query.defaultLocale) params.set("defaultLocale", query.defaultLocale);
  return params;
}

export async function fetchNotificationConfigIntegrityUiData(mode: NotificationGovernanceMode, query: NotificationConfigIntegrityQuery) {
  const base =
    mode === "platform"
      ? "/api/platform/notifications/config-integrity"
      : "/api/manager/notifications/config-integrity";
  const params = buildNotificationConfigIntegrityUiSearchParams(query, mode);
  return fetchApiJson<NotificationConfigIntegrityApiPayload>(`${base}?${params.toString()}`, { cache: "no-store" });
}

export function parseNotificationPreflightUiQuery(
  params: URLSearchParams,
  mode: NotificationGovernanceMode,
): NotificationPreflightQuery {
  const eventRaw = optionalValue(params.get("eventKey"));
  const roleRaw = optionalValue(params.get("roleKey"));
  const userId = optionalValue(params.get("userId"));
  const channelRaw = optionalValue(params.get("channelHint"));
  const roleParsed = roleRaw ? appRoleSchema.safeParse(roleRaw) : null;
  const channelParsed = channelRaw ? notificationChannelSchema.safeParse(channelRaw) : null;
  return {
    tenantId: mode === "platform" ? optionalValue(params.get("tenantId")) : null,
    eventKey:
      eventRaw && (NOTIFICATION_EVENT_KEYS as readonly string[]).includes(eventRaw)
        ? (eventRaw as NotificationPreflightQuery["eventKey"])
        : "opportunity_due",
    roleKey: roleParsed?.success ? roleParsed.data : null,
    userId,
    channelHint: channelParsed?.success ? channelParsed.data : null,
    locale: optionalValue(params.get("locale")) || "zh-TW",
    defaultLocale: optionalValue(params.get("defaultLocale")) || "zh-TW",
    recipientLimit: clampLimit(params.get("recipientLimit"), 20, 1, 100),
  };
}

export function buildNotificationPreflightUiSearchParams(
  query: NotificationPreflightQuery,
  mode: NotificationGovernanceMode,
) {
  const params = new URLSearchParams();
  if (mode === "platform" && query.tenantId) params.set("tenantId", query.tenantId);
  params.set("eventKey", query.eventKey);
  if (query.roleKey) params.set("roleKey", query.roleKey);
  if (query.userId) params.set("userId", query.userId);
  if (query.channelHint) params.set("channelHint", query.channelHint);
  params.set("locale", query.locale);
  params.set("defaultLocale", query.defaultLocale);
  params.set("recipientLimit", String(query.recipientLimit));
  return params;
}

export async function fetchNotificationPreflightUiData(mode: NotificationGovernanceMode, query: NotificationPreflightQuery) {
  const base = mode === "platform" ? "/api/platform/notifications/preflight" : "/api/manager/notifications/preflight";
  const params = buildNotificationPreflightUiSearchParams(query, mode);
  return fetchApiJson<NotificationPreflightApiPayload>(`${base}?${params.toString()}`, { cache: "no-store" });
}

export function parseNotificationRuntimeReadinessUiQuery(
  params: URLSearchParams,
  mode: NotificationGovernanceMode,
): NotificationRuntimeReadinessQuery {
  const preflight = parseNotificationPreflightUiQuery(params, mode);
  return {
    tenantId: preflight.tenantId,
    eventKey: preflight.eventKey,
    roleKey: preflight.roleKey,
    userId: preflight.userId,
    channelHint: preflight.channelHint,
    locale: preflight.locale,
    defaultLocale: preflight.defaultLocale,
    recipientLimit: preflight.recipientLimit,
    scenarioId: optionalValue(params.get("scenarioId")),
  };
}

export function buildNotificationRuntimeReadinessUiSearchParams(
  query: NotificationRuntimeReadinessQuery,
  mode: NotificationGovernanceMode,
) {
  const params = buildNotificationPreflightUiSearchParams(
    {
      tenantId: query.tenantId,
      eventKey: query.eventKey,
      roleKey: query.roleKey,
      userId: query.userId,
      channelHint: query.channelHint,
      locale: query.locale,
      defaultLocale: query.defaultLocale,
      recipientLimit: query.recipientLimit,
    },
    mode,
  );
  if (query.scenarioId) params.set("scenarioId", query.scenarioId);
  return params;
}

export async function fetchNotificationRuntimeReadinessUiData(
  mode: NotificationGovernanceMode,
  query: NotificationRuntimeReadinessQuery,
) {
  const base =
    mode === "platform"
      ? "/api/platform/notifications/runtime-readiness"
      : "/api/manager/notifications/runtime-readiness";
  const params = buildNotificationRuntimeReadinessUiSearchParams(query, mode);
  return fetchApiJson<NotificationRuntimeReadinessApiPayload>(`${base}?${params.toString()}`, { cache: "no-store" });
}
