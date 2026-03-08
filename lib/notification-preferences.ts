import { createSupabaseAdminClient } from "./supabase/admin";
import type { AppRole } from "./auth-context";
import {
  appRoleSchema,
  channelPreferencesSchema,
  notificationEventKeySchema,
  notificationPreferenceScopeSchema,
  normalizeChannels,
} from "./notification-productization";

export type NotificationChannel = "in_app" | "email" | "line" | "sms" | "webhook";

export type NotificationChannelPreferences = Record<NotificationChannel, boolean>;

export type NotificationPreferenceScope = "platform_default" | "tenant_default" | "custom";

export type NotificationRolePreferenceRow = {
  id: string;
  tenant_id: string;
  role: AppRole;
  event_type: string;
  channels: NotificationChannelPreferences;
  is_enabled: boolean;
  source: NotificationPreferenceScope;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationUserPreferenceRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  event_type: string;
  channels: NotificationChannelPreferences;
  is_enabled: boolean;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_CHANNEL_PREFERENCES: NotificationChannelPreferences = {
  in_app: true,
  email: false,
  line: false,
  sms: false,
  webhook: false,
};

export async function listRolePreferences(params: {
  tenantId: string;
  eventType?: string | null;
  role?: AppRole | null;
}) {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("notification_role_preferences")
    .select("id, tenant_id, role, event_type, channels, is_enabled, source, note, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .order("event_type", { ascending: true })
    .order("role", { ascending: true });
  if (params.eventType) query = query.eq("event_type", params.eventType);
  if (params.role) query = query.eq("role", params.role);
  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message, items: [] as NotificationRolePreferenceRow[] };
  const items = (result.data || []).map((row) => ({
    ...row,
    channels: normalizeChannels(channelPreferencesSchema.parse((row as { channels: unknown }).channels)),
    source: notificationPreferenceScopeSchema.catch("custom").parse((row as { source: unknown }).source),
  })) as NotificationRolePreferenceRow[];
  return { ok: true as const, items };
}

export async function getRolePreferenceDetail(params: {
  tenantId: string;
  role: AppRole;
  eventType: string;
}) {
  const admin = createSupabaseAdminClient();
  const safeRole = appRoleSchema.parse(params.role);
  const safeEvent = notificationEventKeySchema.parse(params.eventType);
  const result = await admin
    .from("notification_role_preferences")
    .select("id, tenant_id, role, event_type, channels, is_enabled, source, note, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("role", safeRole)
    .eq("event_type", safeEvent)
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as NotificationRolePreferenceRow | null };
  const item = result.data
    ? ({
        ...result.data,
        channels: normalizeChannels(channelPreferencesSchema.parse((result.data as { channels: unknown }).channels)),
        source: notificationPreferenceScopeSchema.catch("custom").parse((result.data as { source: unknown }).source),
      } as NotificationRolePreferenceRow)
    : null;
  return { ok: true as const, item };
}

export async function upsertRolePreference(params: {
  tenantId: string;
  role: AppRole;
  eventType: string;
  channels: unknown;
  isEnabled?: boolean;
  source?: NotificationPreferenceScope;
  note?: string | null;
  actorId?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const safeRole = appRoleSchema.parse(params.role);
  const safeEvent = notificationEventKeySchema.parse(params.eventType);
  const payload = {
    tenant_id: params.tenantId,
    role: safeRole,
    event_type: safeEvent,
    channels: normalizeChannels(channelPreferencesSchema.parse(params.channels)),
    is_enabled: params.isEnabled !== false,
    source: notificationPreferenceScopeSchema.catch("custom").parse(params.source),
    note: params.note || null,
    updated_by: params.actorId || null,
    updated_at: nowIso,
    created_by: params.actorId || null,
  };
  const result = await admin
    .from("notification_role_preferences")
    .upsert(payload, { onConflict: "tenant_id,role,event_type" })
    .select("id, tenant_id, role, event_type, channels, is_enabled, source, note, created_by, updated_by, created_at, updated_at")
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as NotificationRolePreferenceRow | null };
  const item = result.data
    ? ({
        ...result.data,
        channels: normalizeChannels(channelPreferencesSchema.parse((result.data as { channels: unknown }).channels)),
        source: notificationPreferenceScopeSchema.catch("custom").parse((result.data as { source: unknown }).source),
      } as NotificationRolePreferenceRow)
    : null;
  return { ok: true as const, item };
}

export async function listUserPreferences(params: {
  tenantId: string;
  userId?: string | null;
  eventType?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("notification_user_preferences")
    .select("id, tenant_id, user_id, event_type, channels, is_enabled, note, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .order("event_type", { ascending: true })
    .order("user_id", { ascending: true });
  if (params.userId) query = query.eq("user_id", params.userId);
  if (params.eventType) query = query.eq("event_type", params.eventType);
  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message, items: [] as NotificationUserPreferenceRow[] };
  const items = (result.data || []).map((row) => ({
    ...row,
    channels: normalizeChannels(channelPreferencesSchema.parse((row as { channels: unknown }).channels)),
  })) as NotificationUserPreferenceRow[];
  return { ok: true as const, items };
}

export async function getUserPreferenceDetail(params: {
  tenantId: string;
  userId: string;
  eventType: string;
}) {
  const admin = createSupabaseAdminClient();
  const safeEvent = notificationEventKeySchema.parse(params.eventType);
  const result = await admin
    .from("notification_user_preferences")
    .select("id, tenant_id, user_id, event_type, channels, is_enabled, note, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("user_id", params.userId)
    .eq("event_type", safeEvent)
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as NotificationUserPreferenceRow | null };
  const item = result.data
    ? ({
        ...result.data,
        channels: normalizeChannels(channelPreferencesSchema.parse((result.data as { channels: unknown }).channels)),
      } as NotificationUserPreferenceRow)
    : null;
  return { ok: true as const, item };
}

export async function upsertUserPreference(params: {
  tenantId: string;
  userId: string;
  eventType: string;
  channels: unknown;
  isEnabled?: boolean;
  note?: string | null;
  actorId?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const safeEvent = notificationEventKeySchema.parse(params.eventType);
  const payload = {
    tenant_id: params.tenantId,
    user_id: params.userId,
    event_type: safeEvent,
    channels: normalizeChannels(channelPreferencesSchema.parse(params.channels)),
    is_enabled: params.isEnabled !== false,
    note: params.note || null,
    updated_by: params.actorId || null,
    updated_at: nowIso,
    created_by: params.actorId || null,
  };
  const result = await admin
    .from("notification_user_preferences")
    .upsert(payload, { onConflict: "tenant_id,user_id,event_type" })
    .select("id, tenant_id, user_id, event_type, channels, is_enabled, note, created_by, updated_by, created_at, updated_at")
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as NotificationUserPreferenceRow | null };
  const item = result.data
    ? ({
        ...result.data,
        channels: normalizeChannels(channelPreferencesSchema.parse((result.data as { channels: unknown }).channels)),
      } as NotificationUserPreferenceRow)
    : null;
  return { ok: true as const, item };
}
