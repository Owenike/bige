import { createSupabaseAdminClient } from "./supabase/admin";
import type { NotificationChannel } from "./notification-preferences";
import {
  buildTemplateKey,
  notificationChannelSchema,
  notificationEventKeySchema,
  notificationPrioritySchema,
  templateChannelPolicySchema,
} from "./notification-productization";

export type NotificationTemplatePriority = "info" | "warning" | "critical";

export type NotificationTemplateRow = {
  id: string;
  tenant_id: string | null;
  template_key: string;
  event_type: string;
  channel: NotificationChannel;
  locale: string;
  title_template: string;
  message_template: string;
  email_subject: string | null;
  action_url: string | null;
  priority: NotificationTemplatePriority;
  channel_policy: Record<string, unknown>;
  is_active: boolean;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeLocale(input: unknown) {
  if (typeof input !== "string") return "zh-TW";
  const value = input.trim();
  return value || "zh-TW";
}

function normalizeActionUrl(input: unknown) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  return value.startsWith("/") ? value : null;
}

function normalizePolicy(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function toTemplateRow(row: Record<string, unknown>): NotificationTemplateRow {
  const eventType = notificationEventKeySchema.parse(row.event_type);
  const channel = notificationChannelSchema.parse(row.channel);
  const locale = normalizeLocale(row.locale);
  const tenantId = (row.tenant_id as string | null) || null;
  return {
    id: String(row.id || ""),
    tenant_id: tenantId,
    template_key: buildTemplateKey({
      tenantId,
      eventType,
      channel,
      locale,
    }),
    event_type: eventType,
    channel: channel as NotificationChannel,
    locale,
    title_template: String(row.title_template || ""),
    message_template: String(row.message_template || ""),
    email_subject: (row.email_subject as string | null) || null,
    action_url: normalizeActionUrl(row.action_url),
    priority: notificationPrioritySchema.catch("info").parse(row.priority),
    channel_policy: templateChannelPolicySchema.parse(normalizePolicy(row.channel_policy)),
    is_active: row.is_active !== false,
    version: Number(row.version || 1),
    created_by: (row.created_by as string | null) || null,
    updated_by: (row.updated_by as string | null) || null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

export async function listNotificationTemplates(params: {
  tenantId?: string | null;
  includeGlobal?: boolean;
  eventType?: string | null;
  channel?: NotificationChannel | null;
  activeOnly?: boolean;
}) {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("notification_templates")
    .select("id, tenant_id, event_type, channel, locale, title_template, message_template, email_subject, action_url, priority, channel_policy, is_active, version, created_by, updated_by, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (params.tenantId && params.includeGlobal !== true) {
    query = query.eq("tenant_id", params.tenantId);
  } else if (params.tenantId && params.includeGlobal === true) {
    query = query.or(`tenant_id.is.null,tenant_id.eq.${params.tenantId}`);
  } else {
    query = query.is("tenant_id", null);
  }

  if (params.eventType) query = query.eq("event_type", params.eventType);
  if (params.channel) query = query.eq("channel", params.channel);
  if (params.activeOnly !== false) query = query.eq("is_active", true);

  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message, items: [] as NotificationTemplateRow[] };
  return { ok: true as const, items: (result.data || []).map((row) => toTemplateRow(row as Record<string, unknown>)) };
}

export async function getNotificationTemplateDetail(params: {
  id?: string | null;
  tenantId?: string | null;
  eventType: string;
  channel: NotificationChannel;
  locale?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const safeEvent = notificationEventKeySchema.parse(params.eventType);
  const safeChannel = notificationChannelSchema.parse(params.channel);
  const safeLocale = normalizeLocale(params.locale);
  let query = admin
    .from("notification_templates")
    .select("id, tenant_id, event_type, channel, locale, title_template, message_template, email_subject, action_url, priority, channel_policy, is_active, version, created_by, updated_by, created_at, updated_at")
    .eq("event_type", safeEvent)
    .eq("channel", safeChannel)
    .eq("locale", safeLocale)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (params.id) query = query.eq("id", params.id);
  if (params.tenantId) {
    query = query.eq("tenant_id", params.tenantId);
  } else {
    query = query.is("tenant_id", null);
  }
  const result = await query.maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as NotificationTemplateRow | null };
  return { ok: true as const, item: result.data ? toTemplateRow(result.data as Record<string, unknown>) : null };
}

export async function upsertNotificationTemplate(params: {
  id?: string | null;
  tenantId?: string | null;
  eventType: string;
  channel: NotificationChannel;
  locale?: string;
  titleTemplate: string;
  messageTemplate: string;
  emailSubject?: string | null;
  actionUrl?: string | null;
  priority?: NotificationTemplatePriority;
  channelPolicy?: Record<string, unknown>;
  isActive?: boolean;
  version?: number;
  actorId?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const safeEvent = notificationEventKeySchema.parse(params.eventType);
  const safeChannel = notificationChannelSchema.parse(params.channel);
  const safeLocale = normalizeLocale(params.locale);
  const safePriority = notificationPrioritySchema.catch("info").parse(params.priority);
  const safePolicy = templateChannelPolicySchema.parse(normalizePolicy(params.channelPolicy));
  const payload = {
    tenant_id: params.tenantId || null,
    event_type: safeEvent,
    channel: safeChannel,
    locale: safeLocale,
    title_template: params.titleTemplate.trim(),
    message_template: params.messageTemplate.trim(),
    email_subject: params.emailSubject || null,
    action_url: normalizeActionUrl(params.actionUrl),
    priority: safePriority,
    channel_policy: safePolicy,
    is_active: params.isActive !== false,
    version: Math.max(1, Number(params.version || 1)),
    updated_by: params.actorId || null,
    updated_at: nowIso,
    created_by: params.actorId || null,
  };

  if (params.id) {
    const update = await admin
      .from("notification_templates")
      .update(payload)
      .eq("id", params.id)
      .select("id, tenant_id, event_type, channel, locale, title_template, message_template, email_subject, action_url, priority, channel_policy, is_active, version, created_by, updated_by, created_at, updated_at")
      .maybeSingle();
    if (update.error) return { ok: false as const, error: update.error.message, item: null as NotificationTemplateRow | null };
    return { ok: true as const, item: update.data ? toTemplateRow(update.data as Record<string, unknown>) : null };
  }

  const insert = await admin
    .from("notification_templates")
    .insert(payload)
    .select("id, tenant_id, event_type, channel, locale, title_template, message_template, email_subject, action_url, priority, channel_policy, is_active, version, created_by, updated_by, created_at, updated_at")
    .maybeSingle();
  if (insert.error) return { ok: false as const, error: insert.error.message, item: null as NotificationTemplateRow | null };
  return { ok: true as const, item: insert.data ? toTemplateRow(insert.data as Record<string, unknown>) : null };
}
