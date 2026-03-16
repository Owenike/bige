import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeChannels, type NotificationChannelKey } from "./notification-productization";
import { createSupabaseAdminClient } from "./supabase/admin";

export type JobType = "notification_sweep" | "opportunity_sweep" | "delivery_dispatch" | "reminder_bundle";
export type DeliveryChannel = Exclude<NotificationChannelKey, "in_app">;
type ScopeSource = "default" | "tenant" | "branch";

export type TenantJobSettingRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  job_type: JobType;
  enabled: boolean;
  window_minutes: number;
  max_batch_size: number;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantNotificationSettingRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  job_type: JobType;
  is_enabled: boolean;
  channels: Record<NotificationChannelKey, boolean>;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantDeliveryChannelSettingRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  channel: DeliveryChannel;
  is_enabled: boolean;
  provider: string | null;
  rate_limit_per_minute: number | null;
  timeout_ms: number | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FeatureFlagRow = {
  id: string;
  tenant_id: string;
  key: string;
  enabled: boolean;
  updated_at: string;
};

export type ResolvedJobSettingItem = {
  jobType: JobType;
  enabled: boolean;
  windowMinutes: number;
  maxBatchSize: number;
  source: ScopeSource;
  featureFlag: { key: string; enabled: boolean } | null;
};

export type ResolvedNotificationSettingItem = {
  jobType: JobType;
  isEnabled: boolean;
  channels: Record<NotificationChannelKey, boolean>;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  source: ScopeSource;
  featureFlag: { key: string; enabled: boolean } | null;
  channelFeatureFlags: Array<{ channel: NotificationChannelKey; key: string; enabled: boolean }>;
};

export type ResolvedDeliveryChannelSettingItem = {
  channel: DeliveryChannel;
  isEnabled: boolean;
  provider: string | null;
  rateLimitPerMinute: number | null;
  timeoutMs: number | null;
  source: ScopeSource;
  featureFlag: { key: string; enabled: boolean } | null;
};

export type ResolvedJobSettings = {
  tenantId: string;
  branchId: string | null;
  resolvedAt: string;
  jobs: ResolvedJobSettingItem[];
  notifications: ResolvedNotificationSettingItem[];
  deliveryChannels: ResolvedDeliveryChannelSettingItem[];
  featureFlags: {
    relevant: FeatureFlagRow[];
  };
  sources: {
    tenantJobSettings: TenantJobSettingRow[];
    tenantNotificationSettings: TenantNotificationSettingRow[];
    tenantDeliveryChannelSettings: TenantDeliveryChannelSettingRow[];
  };
  warnings: string[];
};

const JOB_TYPES: JobType[] = ["notification_sweep", "opportunity_sweep", "delivery_dispatch", "reminder_bundle"];
const DELIVERY_CHANNELS: DeliveryChannel[] = ["email", "line", "sms", "webhook"];
const EMPTY_CHANNELS = normalizeChannels({});

const DEFAULT_JOB_SETTINGS: Record<JobType, Omit<ResolvedJobSettingItem, "source" | "featureFlag" | "jobType">> = {
  notification_sweep: { enabled: true, windowMinutes: 30, maxBatchSize: 500 },
  opportunity_sweep: { enabled: true, windowMinutes: 30, maxBatchSize: 500 },
  delivery_dispatch: { enabled: true, windowMinutes: 30, maxBatchSize: 500 },
  reminder_bundle: { enabled: false, windowMinutes: 60, maxBatchSize: 200 },
};

const DEFAULT_NOTIFICATION_SETTINGS: Record<
  JobType,
  Omit<ResolvedNotificationSettingItem, "source" | "featureFlag" | "channelFeatureFlags" | "jobType">
> = {
  notification_sweep: { isEnabled: true, channels: { ...EMPTY_CHANNELS, in_app: true }, quietHoursStart: null, quietHoursEnd: null },
  opportunity_sweep: { isEnabled: true, channels: { ...EMPTY_CHANNELS, in_app: true }, quietHoursStart: null, quietHoursEnd: null },
  delivery_dispatch: { isEnabled: false, channels: { ...EMPTY_CHANNELS }, quietHoursStart: null, quietHoursEnd: null },
  reminder_bundle: { isEnabled: false, channels: { ...EMPTY_CHANNELS }, quietHoursStart: null, quietHoursEnd: null },
};

const DEFAULT_DELIVERY_CHANNEL_SETTINGS: Record<DeliveryChannel, Omit<ResolvedDeliveryChannelSettingItem, "source" | "featureFlag" | "channel">> = {
  email: { isEnabled: false, provider: null, rateLimitPerMinute: null, timeoutMs: null },
  line: { isEnabled: false, provider: null, rateLimitPerMinute: null, timeoutMs: null },
  sms: { isEnabled: false, provider: null, rateLimitPerMinute: null, timeoutMs: null },
  webhook: { isEnabled: false, provider: null, rateLimitPerMinute: null, timeoutMs: null },
};

function isMissingRelationError(message: string | undefined, relation: string) {
  const lower = String(message || "").toLowerCase();
  return lower.includes(`relation "${relation}" does not exist`) || lower.includes(`could not find the table 'public.${relation}'`);
}

function normalizeChannelsSafe(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return normalizeChannels({});
  return normalizeChannels(input as Partial<Record<NotificationChannelKey, boolean>>);
}

function pickScopedRow<T extends { branch_id: string | null }>(rows: T[], branchId: string | null, matcher: (row: T) => boolean) {
  if (branchId) {
    const branchRow = rows.find((row) => row.branch_id === branchId && matcher(row));
    if (branchRow) return { row: branchRow, source: "branch" as const };
  }
  const tenantRow = rows.find((row) => !row.branch_id && matcher(row));
  if (tenantRow) return { row: tenantRow, source: "tenant" as const };
  return null;
}

function toRelevantFeatureFlags(rows: FeatureFlagRow[]) {
  return rows
    .filter(
      (row) =>
        row.key.startsWith("jobs.") ||
        row.key.startsWith("jobs.notifications.") ||
        row.key.startsWith("jobs.channels."),
    )
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildFlagMap(rows: FeatureFlagRow[]) {
  const map = new Map<string, boolean>();
  for (const row of rows) map.set(row.key, row.enabled);
  return map;
}

async function loadScopedRows<T>(
  params: {
    supabase: SupabaseClient;
    table: string;
    select: string;
    tenantId: string;
    branchId: string | null;
  },
): Promise<{ ok: true; items: T[]; warning: string | null } | { ok: false; error: string }> {
  let query = params.supabase.from(params.table).select(params.select).eq("tenant_id", params.tenantId);
  if (params.branchId) query = query.or(`branch_id.is.null,branch_id.eq.${params.branchId}`);
  else query = query.is("branch_id", null);
  const result = await query;
  if (result.error) {
    if (isMissingRelationError(result.error.message, params.table)) {
      return { ok: true as const, items: [] as T[], warning: `${params.table} table not found` };
    }
    return { ok: false as const, error: result.error.message };
  }
  return { ok: true as const, items: (result.data || []) as T[], warning: null };
}

async function listTenantFeatureFlags(params: { supabase: SupabaseClient; tenantId: string }) {
  const result = await params.supabase
    .from("feature_flags")
    .select("id, tenant_id, key, enabled, updated_at")
    .eq("tenant_id", params.tenantId)
    .order("key", { ascending: true });
  if (result.error) {
    if (isMissingRelationError(result.error.message, "feature_flags")) {
      return { ok: true as const, items: [] as FeatureFlagRow[], warning: "feature_flags table not found" };
    }
    return { ok: false as const, error: result.error.message };
  }
  return { ok: true as const, items: (result.data || []) as FeatureFlagRow[], warning: null };
}

export async function resolveJobSettings(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
}): Promise<{ ok: true; data: ResolvedJobSettings } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const branchId = params.branchId || null;
  const warnings: string[] = [];

  const [jobRowsResult, notificationRowsResult, deliveryRowsResult, featureFlagsResult] = await Promise.all([
    loadScopedRows<TenantJobSettingRow>({
      supabase,
      table: "tenant_job_settings",
      select: "id, tenant_id, branch_id, job_type, enabled, window_minutes, max_batch_size, note, metadata, created_by, updated_by, created_at, updated_at",
      tenantId: params.tenantId,
      branchId,
    }),
    loadScopedRows<TenantNotificationSettingRow>({
      supabase,
      table: "tenant_notification_settings",
      select:
        "id, tenant_id, branch_id, job_type, is_enabled, channels, quiet_hours_start, quiet_hours_end, note, metadata, created_by, updated_by, created_at, updated_at",
      tenantId: params.tenantId,
      branchId,
    }),
    loadScopedRows<TenantDeliveryChannelSettingRow>({
      supabase,
      table: "tenant_delivery_channel_settings",
      select:
        "id, tenant_id, branch_id, channel, is_enabled, provider, rate_limit_per_minute, timeout_ms, note, metadata, created_by, updated_by, created_at, updated_at",
      tenantId: params.tenantId,
      branchId,
    }),
    listTenantFeatureFlags({ supabase, tenantId: params.tenantId }),
  ]);

  if ("error" in jobRowsResult) return { ok: false as const, error: jobRowsResult.error };
  if ("error" in notificationRowsResult) return { ok: false as const, error: notificationRowsResult.error };
  if ("error" in deliveryRowsResult) return { ok: false as const, error: deliveryRowsResult.error };
  if ("error" in featureFlagsResult) return { ok: false as const, error: featureFlagsResult.error ?? "feature_flags_load_failed" };

  if (jobRowsResult.warning) warnings.push(jobRowsResult.warning);
  if (notificationRowsResult.warning) warnings.push(notificationRowsResult.warning);
  if (deliveryRowsResult.warning) warnings.push(deliveryRowsResult.warning);
  if (featureFlagsResult.warning) warnings.push(featureFlagsResult.warning);

  const jobRows = jobRowsResult.items;
  const notificationRows = notificationRowsResult.items.map((row) => ({
    ...row,
    channels: normalizeChannelsSafe((row as { channels: unknown }).channels),
  }));
  const deliveryRows = deliveryRowsResult.items;
  const relevantFlags = toRelevantFeatureFlags(featureFlagsResult.items);
  const flagMap = buildFlagMap(relevantFlags);

  const jobs: ResolvedJobSettingItem[] = JOB_TYPES.map((jobType) => {
    const base = DEFAULT_JOB_SETTINGS[jobType];
    const picked = pickScopedRow(jobRows, branchId, (row) => row.job_type === jobType);
    const key = `jobs.${jobType}.enabled`;
    const featureFlag = flagMap.has(key) ? { key, enabled: Boolean(flagMap.get(key)) } : null;
    return {
      jobType,
      enabled: featureFlag ? featureFlag.enabled : picked ? picked.row.enabled : base.enabled,
      windowMinutes: picked ? Number(picked.row.window_minutes || base.windowMinutes) : base.windowMinutes,
      maxBatchSize: picked ? Number(picked.row.max_batch_size || base.maxBatchSize) : base.maxBatchSize,
      source: picked ? picked.source : "default",
      featureFlag,
    };
  });

  const notifications: ResolvedNotificationSettingItem[] = JOB_TYPES.map((jobType) => {
    const base = DEFAULT_NOTIFICATION_SETTINGS[jobType];
    const picked = pickScopedRow(notificationRows, branchId, (row) => row.job_type === jobType);
    const notificationFlagKey = `jobs.notifications.${jobType}.enabled`;
    const notificationFlag = flagMap.has(notificationFlagKey) ? { key: notificationFlagKey, enabled: Boolean(flagMap.get(notificationFlagKey)) } : null;
    const channelFeatureFlags: Array<{ channel: NotificationChannelKey; key: string; enabled: boolean }> = [];

    const channels = picked ? { ...picked.row.channels } : { ...base.channels };
    for (const channel of Object.keys(channels) as NotificationChannelKey[]) {
      const key = `jobs.channels.${channel}.enabled`;
      if (!flagMap.has(key)) continue;
      const enabled = Boolean(flagMap.get(key));
      channels[channel] = enabled;
      channelFeatureFlags.push({ channel, key, enabled });
    }

    return {
      jobType,
      isEnabled: notificationFlag ? notificationFlag.enabled : picked ? picked.row.is_enabled : base.isEnabled,
      channels,
      quietHoursStart: picked ? picked.row.quiet_hours_start : base.quietHoursStart,
      quietHoursEnd: picked ? picked.row.quiet_hours_end : base.quietHoursEnd,
      source: picked ? picked.source : "default",
      featureFlag: notificationFlag,
      channelFeatureFlags,
    };
  });

  const deliveryChannels: ResolvedDeliveryChannelSettingItem[] = DELIVERY_CHANNELS.map((channel) => {
    const base = DEFAULT_DELIVERY_CHANNEL_SETTINGS[channel];
    const picked = pickScopedRow(deliveryRows, branchId, (row) => row.channel === channel);
    const channelFlagKey = `jobs.channels.${channel}.enabled`;
    const channelFlag = flagMap.has(channelFlagKey) ? { key: channelFlagKey, enabled: Boolean(flagMap.get(channelFlagKey)) } : null;
    return {
      channel,
      isEnabled: channelFlag ? channelFlag.enabled : picked ? picked.row.is_enabled : base.isEnabled,
      provider: picked ? picked.row.provider || null : base.provider,
      rateLimitPerMinute: picked ? (picked.row.rate_limit_per_minute || null) : base.rateLimitPerMinute,
      timeoutMs: picked ? (picked.row.timeout_ms || null) : base.timeoutMs,
      source: picked ? picked.source : "default",
      featureFlag: channelFlag,
    };
  });

  return {
    ok: true,
    data: {
      tenantId: params.tenantId,
      branchId,
      resolvedAt: new Date().toISOString(),
      jobs,
      notifications,
      deliveryChannels,
      featureFlags: {
        relevant: relevantFlags,
      },
      sources: {
        tenantJobSettings: jobRows,
        tenantNotificationSettings: notificationRows,
        tenantDeliveryChannelSettings: deliveryRows,
      },
      warnings,
    },
  };
}

async function getScopedSingle<T>(
  params: {
    supabase: SupabaseClient;
    table: string;
    select: string;
    tenantId: string;
    branchId: string | null;
    key: Record<string, string>;
  },
) {
  let query = params.supabase.from(params.table).select(params.select).eq("tenant_id", params.tenantId);
  for (const [column, value] of Object.entries(params.key)) query = query.eq(column, value);
  if (params.branchId) query = query.eq("branch_id", params.branchId);
  else query = query.is("branch_id", null);
  const result = await query.maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as T | null };
  return { ok: true as const, item: (result.data || null) as T | null };
}

export async function getTenantJobSettingDetail(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
  jobType: JobType;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  return getScopedSingle<TenantJobSettingRow>({
    supabase,
    table: "tenant_job_settings",
    select: "id, tenant_id, branch_id, job_type, enabled, window_minutes, max_batch_size, note, metadata, created_by, updated_by, created_at, updated_at",
    tenantId: params.tenantId,
    branchId: params.branchId || null,
    key: { job_type: params.jobType },
  });
}

export async function getTenantNotificationSettingDetail(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
  jobType: JobType;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const result = await getScopedSingle<TenantNotificationSettingRow>({
    supabase,
    table: "tenant_notification_settings",
    select:
      "id, tenant_id, branch_id, job_type, is_enabled, channels, quiet_hours_start, quiet_hours_end, note, metadata, created_by, updated_by, created_at, updated_at",
    tenantId: params.tenantId,
    branchId: params.branchId || null,
    key: { job_type: params.jobType },
  });
  if (!result.ok || !result.item) return result;
  return {
    ok: true as const,
    item: {
      ...result.item,
      channels: normalizeChannelsSafe((result.item as { channels: unknown }).channels),
    } as TenantNotificationSettingRow,
  };
}

export async function getTenantDeliveryChannelSettingDetail(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
  channel: DeliveryChannel;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  return getScopedSingle<TenantDeliveryChannelSettingRow>({
    supabase,
    table: "tenant_delivery_channel_settings",
    select:
      "id, tenant_id, branch_id, channel, is_enabled, provider, rate_limit_per_minute, timeout_ms, note, metadata, created_by, updated_by, created_at, updated_at",
    tenantId: params.tenantId,
    branchId: params.branchId || null,
    key: { channel: params.channel },
  });
}

async function updateOrInsert(
  supabase: SupabaseClient,
  params: {
    table: string;
    existingId: string | null;
    payload: Record<string, unknown>;
    select: string;
  },
) {
  if (params.existingId) {
    const updated = await supabase
      .from(params.table)
      .update(params.payload)
      .eq("id", params.existingId)
      .select(params.select)
      .maybeSingle();
    if (updated.error) return { ok: false as const, error: updated.error.message, item: null as Record<string, unknown> | null };
    return { ok: true as const, item: ((updated.data || null) as unknown) as Record<string, unknown> | null };
  }
  const inserted = await supabase.from(params.table).insert(params.payload).select(params.select).maybeSingle();
  if (inserted.error) return { ok: false as const, error: inserted.error.message, item: null as Record<string, unknown> | null };
  return { ok: true as const, item: ((inserted.data || null) as unknown) as Record<string, unknown> | null };
}

export async function upsertTenantJobSetting(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
  jobType: JobType;
  enabled: boolean;
  windowMinutes: number;
  maxBatchSize: number;
  note?: string | null;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const existing = await getTenantJobSettingDetail({
    supabase,
    tenantId: params.tenantId,
    branchId: params.branchId || null,
    jobType: params.jobType,
  });
  if (!existing.ok) return existing;

  const nowIso = new Date().toISOString();
  const write = await updateOrInsert(supabase, {
    table: "tenant_job_settings",
    existingId: existing.item?.id || null,
    payload: {
      tenant_id: params.tenantId,
      branch_id: params.branchId || null,
      job_type: params.jobType,
      enabled: params.enabled,
      window_minutes: params.windowMinutes,
      max_batch_size: params.maxBatchSize,
      note: params.note || null,
      metadata: params.metadata || {},
      updated_by: params.actorId || null,
      updated_at: nowIso,
      ...(existing.item ? {} : { created_by: params.actorId || null }),
    },
    select: "id, tenant_id, branch_id, job_type, enabled, window_minutes, max_batch_size, note, metadata, created_by, updated_by, created_at, updated_at",
  });
  if (!write.ok) return { ok: false as const, error: write.error, item: null as TenantJobSettingRow | null };
  return {
    ok: true as const,
    item: (write.item || null) as TenantJobSettingRow | null,
    before: existing.item,
  };
}

export async function upsertTenantNotificationSetting(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
  jobType: JobType;
  isEnabled: boolean;
  channels: unknown;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const existing = await getTenantNotificationSettingDetail({
    supabase,
    tenantId: params.tenantId,
    branchId: params.branchId || null,
    jobType: params.jobType,
  });
  if (!existing.ok) return existing;

  const nowIso = new Date().toISOString();
  const write = await updateOrInsert(supabase, {
    table: "tenant_notification_settings",
    existingId: existing.item?.id || null,
    payload: {
      tenant_id: params.tenantId,
      branch_id: params.branchId || null,
      job_type: params.jobType,
      is_enabled: params.isEnabled,
      channels: normalizeChannelsSafe(params.channels),
      quiet_hours_start: params.quietHoursStart ?? null,
      quiet_hours_end: params.quietHoursEnd ?? null,
      note: params.note || null,
      metadata: params.metadata || {},
      updated_by: params.actorId || null,
      updated_at: nowIso,
      ...(existing.item ? {} : { created_by: params.actorId || null }),
    },
    select:
      "id, tenant_id, branch_id, job_type, is_enabled, channels, quiet_hours_start, quiet_hours_end, note, metadata, created_by, updated_by, created_at, updated_at",
  });
  if (!write.ok) return { ok: false as const, error: write.error, item: null as TenantNotificationSettingRow | null };
  return {
    ok: true as const,
    item: write.item
      ? ({
          ...(write.item as Record<string, unknown>),
          channels: normalizeChannelsSafe((write.item as { channels?: unknown }).channels),
        } as TenantNotificationSettingRow)
      : null,
    before: existing.item,
  };
}

export async function upsertTenantDeliveryChannelSetting(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
  channel: DeliveryChannel;
  isEnabled: boolean;
  provider?: string | null;
  rateLimitPerMinute?: number | null;
  timeoutMs?: number | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const existing = await getTenantDeliveryChannelSettingDetail({
    supabase,
    tenantId: params.tenantId,
    branchId: params.branchId || null,
    channel: params.channel,
  });
  if (!existing.ok) return existing;

  const nowIso = new Date().toISOString();
  const write = await updateOrInsert(supabase, {
    table: "tenant_delivery_channel_settings",
    existingId: existing.item?.id || null,
    payload: {
      tenant_id: params.tenantId,
      branch_id: params.branchId || null,
      channel: params.channel,
      is_enabled: params.isEnabled,
      provider: params.provider || null,
      rate_limit_per_minute: params.rateLimitPerMinute ?? null,
      timeout_ms: params.timeoutMs ?? null,
      note: params.note || null,
      metadata: params.metadata || {},
      updated_by: params.actorId || null,
      updated_at: nowIso,
      ...(existing.item ? {} : { created_by: params.actorId || null }),
    },
    select:
      "id, tenant_id, branch_id, channel, is_enabled, provider, rate_limit_per_minute, timeout_ms, note, metadata, created_by, updated_by, created_at, updated_at",
  });
  if (!write.ok) return { ok: false as const, error: write.error, item: null as TenantDeliveryChannelSettingRow | null };
  return {
    ok: true as const,
    item: (write.item || null) as TenantDeliveryChannelSettingRow | null,
    before: existing.item,
  };
}
