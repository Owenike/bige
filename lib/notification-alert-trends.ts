import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canUseDailyRollupWindow,
  isUtcDayBoundary,
  readNotificationDailyAnomalyRollups,
  readNotificationDailyRollups,
} from "./notification-rollup";
import type { DeliveryChannel } from "./notification-ops";
import { createSupabaseAdminClient } from "./supabase/admin";

type DeliveryAnomalyRow = {
  tenant_id: string | null;
  channel: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  last_error: string | null;
  created_at: string;
};

type DeliveryVolumeRow = {
  tenant_id: string | null;
  channel: string;
  created_at: string;
};

type TrendDirection = "up" | "flat" | "down";

type TrendAccumulator = {
  currentCount: number;
  previousCount: number;
  currentDenominator: number;
  previousDenominator: number;
};

type TenantAccumulator = TrendAccumulator & {
  tenantId: string;
};

type ChannelAccumulator = TrendAccumulator & {
  channel: string;
};

type AnomalyTypeAccumulator = TrendAccumulator & {
  key: string;
  label: string;
  sample: string | null;
};

export type NotificationTrendComparisonItem = {
  currentCount: number;
  previousCount: number;
  countDelta: number;
  currentRate: number;
  previousRate: number;
  rateDelta: number;
  direction: TrendDirection;
};

export type NotificationTrendTenantItem = NotificationTrendComparisonItem & {
  tenantId: string;
};

export type NotificationTrendChannelItem = NotificationTrendComparisonItem & {
  channel: string;
};

export type NotificationTrendAnomalyTypeItem = NotificationTrendComparisonItem & {
  key: string;
  label: string;
  sample: string | null;
};

export type NotificationTrendAggregationMode = "auto" | "raw" | "rollup";

export type NotificationAlertTrendComparisonSnapshot = {
  tenantId: string | null;
  channel: DeliveryChannel | null;
  dataSource: "raw" | "rollup";
  currentWindow: {
    from: string;
    to: string;
    durationMinutes: number;
    totalDeliveries: number;
    anomalyCount: number;
    anomalyRate: number;
  };
  previousWindow: {
    from: string;
    to: string;
    durationMinutes: number;
    totalDeliveries: number;
    anomalyCount: number;
    anomalyRate: number;
  };
  overall: NotificationTrendComparisonItem;
  byTenant: NotificationTrendTenantItem[];
  byAnomalyType: NotificationTrendAnomalyTypeItem[];
  byChannel: NotificationTrendChannelItem[];
  topWorseningTenants: NotificationTrendTenantItem[];
  topWorseningAnomalyTypes: NotificationTrendAnomalyTypeItem[];
  topWorseningChannels: NotificationTrendChannelItem[];
  rateDefinitions: {
    anomalyRateDenominator: "total_deliveries_in_window";
  };
};

const MESSAGE_MAX = 120;

function normalizeIso(input: string | null | undefined, fallback: string) {
  if (!input) return fallback;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function round(value: number, digits = 2) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function toRate(count: number, denominator: number) {
  if (denominator <= 0) return 0;
  return round((count / denominator) * 100);
}

function normalizeMessage(raw: string | null | undefined) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  let normalized = value.replace(/\s+/g, " ");
  normalized = normalized.replace(/\b[0-9a-f]{8,}\b/g, "#id");
  normalized = normalized.replace(/\b\d{3,}\b/g, "#");
  return normalized.slice(0, MESSAGE_MAX);
}

function inferMessageCategory(message: string) {
  if (!message) return "unknown_error";
  if (/channel[_\s-]?not[_\s-]?configured|not configured/.test(message)) return "channel_not_configured";
  if (/timeout|timed out/.test(message)) return "timeout";
  if (/rate.?limit|too many requests/.test(message)) return "rate_limited";
  if (/unauthoriz|forbidden|invalid token|signature|auth/.test(message)) return "auth_failure";
  if (/network|dns|socket|connect/.test(message)) return "network_error";
  if (/quota|insufficient/.test(message)) return "quota_exceeded";
  return message;
}

function toAnomalyType(row: DeliveryAnomalyRow) {
  const code = String(row.error_code || "").trim();
  if (code) {
    return {
      key: `CODE:${code}`,
      label: code,
      sample: normalizeMessage(row.last_error || row.error_message || ""),
    };
  }
  const message = normalizeMessage(row.last_error || row.error_message || "");
  const category = inferMessageCategory(message);
  return {
    key: `MSG:${category}`,
    label: category,
    sample: message || null,
  };
}

function toAnomalyTypeFromRollup(row: { anomaly_key: string; anomaly_label: string; sample_error: string | null }) {
  const key = String(row.anomaly_key || "");
  if (key.startsWith("CODE:")) {
    const code = key.slice(5).trim() || String(row.anomaly_label || "").trim() || "unknown_code";
    return {
      key: `CODE:${code}`,
      label: code,
      sample: normalizeMessage(row.sample_error || ""),
    };
  }
  const normalized = normalizeMessage(row.anomaly_label || row.sample_error || "");
  const category = inferMessageCategory(normalized);
  return {
    key: `MSG:${category}`,
    label: category,
    sample: normalized || null,
  };
}

function isInWindow(input: string, fromTime: number, toTime: number) {
  const date = new Date(input);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  if (time < fromTime || time > toTime) return null;
  return time;
}

function isInDayWindow(input: string, fromDay: string, toDay: string) {
  const day = input.slice(0, 10);
  if (!day) return false;
  return day >= fromDay && day <= toDay;
}

export function resolveNotificationTrendDirection(params: {
  countDelta: number;
  rateDelta: number;
  epsilon?: number;
}): TrendDirection {
  const epsilon = Number(params.epsilon ?? 0.05);
  if (params.countDelta > 0 || params.rateDelta > epsilon) return "up";
  if (params.countDelta < 0 || params.rateDelta < -epsilon) return "down";
  return "flat";
}

export function buildNotificationTrendComparisonItem(params: {
  currentCount: number;
  previousCount: number;
  currentDenominator: number;
  previousDenominator: number;
}) {
  const currentCount = Number(params.currentCount || 0);
  const previousCount = Number(params.previousCount || 0);
  const currentRate = toRate(currentCount, Number(params.currentDenominator || 0));
  const previousRate = toRate(previousCount, Number(params.previousDenominator || 0));
  const countDelta = currentCount - previousCount;
  const rateDelta = round(currentRate - previousRate);
  return {
    currentCount,
    previousCount,
    countDelta,
    currentRate,
    previousRate,
    rateDelta,
    direction: resolveNotificationTrendDirection({ countDelta, rateDelta }),
  };
}

function createAccumulator(): TrendAccumulator {
  return {
    currentCount: 0,
    previousCount: 0,
    currentDenominator: 0,
    previousDenominator: 0,
  };
}

function asTimestamp(iso: string, fallback: number) {
  const date = new Date(iso);
  const time = date.getTime();
  if (Number.isNaN(time)) return fallback;
  return time;
}

function countUtcDaysInclusive(fromIso: string, toIso: string) {
  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 1;
  const fromDay = Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate());
  const toDay = Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate());
  const diff = Math.floor((toDay - fromDay) / (24 * 60 * 60 * 1000));
  return Math.max(1, diff + 1);
}

function sortByWorsening<T extends NotificationTrendComparisonItem>(rows: T[]) {
  return [...rows].sort(
    (a, b) => b.countDelta - a.countDelta || b.rateDelta - a.rateDelta || b.currentCount - a.currentCount || a.previousCount - b.previousCount,
  );
}

function buildSnapshotFromMaps(params: {
  tenantId: string | null;
  channel: DeliveryChannel | null;
  currentFromIso: string;
  currentToIso: string;
  previousFromIso: string;
  previousToIso: string;
  durationMs: number;
  topLimit: number;
  currentTotalDeliveries: number;
  previousTotalDeliveries: number;
  currentAnomalyCount: number;
  previousAnomalyCount: number;
  tenantMap: Map<string, TenantAccumulator>;
  channelMap: Map<string, ChannelAccumulator>;
  anomalyTypeMap: Map<string, AnomalyTypeAccumulator>;
  dataSource: "raw" | "rollup";
}) {
  for (const tenant of params.tenantMap.values()) {
    tenant.currentDenominator = tenant.currentDenominator || params.currentTotalDeliveries;
    tenant.previousDenominator = tenant.previousDenominator || params.previousTotalDeliveries;
  }
  for (const channel of params.channelMap.values()) {
    channel.currentDenominator = channel.currentDenominator || params.currentTotalDeliveries;
    channel.previousDenominator = channel.previousDenominator || params.previousTotalDeliveries;
  }
  for (const item of params.anomalyTypeMap.values()) {
    item.currentDenominator = params.currentTotalDeliveries;
    item.previousDenominator = params.previousTotalDeliveries;
  }

  const byTenant = sortByWorsening(
    Array.from(params.tenantMap.values()).map((item) => ({
      tenantId: item.tenantId,
      ...buildNotificationTrendComparisonItem(item),
    })),
  );

  const byAnomalyType = sortByWorsening(
    Array.from(params.anomalyTypeMap.values()).map((item) => ({
      key: item.key,
      label: item.label,
      sample: item.sample,
      ...buildNotificationTrendComparisonItem(item),
    })),
  );

  const byChannel = sortByWorsening(
    Array.from(params.channelMap.values()).map((item) => ({
      channel: item.channel,
      ...buildNotificationTrendComparisonItem(item),
    })),
  );

  const topWorseningTenants = byTenant.filter((item) => item.direction === "up" && item.countDelta > 0).slice(0, params.topLimit);
  const topWorseningAnomalyTypes = byAnomalyType
    .filter((item) => item.direction === "up" && item.countDelta > 0)
    .slice(0, params.topLimit);
  const topWorseningChannels = byChannel.filter((item) => item.direction === "up" && item.countDelta > 0).slice(0, params.topLimit);

  const overall = buildNotificationTrendComparisonItem({
    currentCount: params.currentAnomalyCount,
    previousCount: params.previousAnomalyCount,
    currentDenominator: params.currentTotalDeliveries,
    previousDenominator: params.previousTotalDeliveries,
  });

  return {
    tenantId: params.tenantId,
    channel: params.channel,
    dataSource: params.dataSource,
    currentWindow: {
      from: params.currentFromIso,
      to: params.currentToIso,
      durationMinutes: Math.round(params.durationMs / 60000),
      totalDeliveries: params.currentTotalDeliveries,
      anomalyCount: params.currentAnomalyCount,
      anomalyRate: toRate(params.currentAnomalyCount, params.currentTotalDeliveries),
    },
    previousWindow: {
      from: params.previousFromIso,
      to: params.previousToIso,
      durationMinutes: Math.round(params.durationMs / 60000),
      totalDeliveries: params.previousTotalDeliveries,
      anomalyCount: params.previousAnomalyCount,
      anomalyRate: toRate(params.previousAnomalyCount, params.previousTotalDeliveries),
    },
    overall,
    byTenant,
    byAnomalyType,
    byChannel,
    topWorseningTenants,
    topWorseningAnomalyTypes,
    topWorseningChannels,
    rateDefinitions: {
      anomalyRateDenominator: "total_deliveries_in_window" as const,
    },
  };
}

async function buildFromRaw(params: {
  supabase: SupabaseClient;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
  currentFromIso: string;
  currentToIso: string;
  previousFromIso: string;
  previousToIso: string;
  currentFromTs: number;
  currentToTs: number;
  previousFromTs: number;
  previousToTs: number;
  durationMs: number;
  limit: number;
  topLimit: number;
}): Promise<{ ok: true; snapshot: NotificationAlertTrendComparisonSnapshot } | { ok: false; error: string }> {
  let anomalyQuery = params.supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, status, error_code, error_message, last_error, created_at")
    .in("status", ["dead_letter", "failed", "retrying"])
    .gte("created_at", params.previousFromIso)
    .lte("created_at", params.currentToIso)
    .order("created_at", { ascending: false })
    .limit(params.limit);
  let volumeQuery = params.supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, created_at")
    .gte("created_at", params.previousFromIso)
    .lte("created_at", params.currentToIso)
    .order("created_at", { ascending: false })
    .limit(params.limit);

  if (params.tenantId) {
    anomalyQuery = anomalyQuery.eq("tenant_id", params.tenantId);
    volumeQuery = volumeQuery.eq("tenant_id", params.tenantId);
  }
  if (params.channel) {
    anomalyQuery = anomalyQuery.eq("channel", params.channel);
    volumeQuery = volumeQuery.eq("channel", params.channel);
  }

  const [anomaliesResult, volumesResult] = await Promise.all([anomalyQuery, volumeQuery]);
  if (anomaliesResult.error) return { ok: false, error: anomaliesResult.error.message };
  if (volumesResult.error) return { ok: false, error: volumesResult.error.message };

  const anomalies = (anomaliesResult.data || []) as DeliveryAnomalyRow[];
  const volumes = (volumesResult.data || []) as DeliveryVolumeRow[];

  const tenantMap = new Map<string, TenantAccumulator>();
  const anomalyTypeMap = new Map<string, AnomalyTypeAccumulator>();
  const channelMap = new Map<string, ChannelAccumulator>();

  let currentTotalDeliveries = 0;
  let previousTotalDeliveries = 0;
  let currentAnomalyCount = 0;
  let previousAnomalyCount = 0;

  for (const row of volumes) {
    const inCurrent = isInWindow(row.created_at, params.currentFromTs, params.currentToTs);
    const inPrevious = isInWindow(row.created_at, params.previousFromTs, params.previousToTs);
    if (!inCurrent && !inPrevious) continue;

    const tenantId = row.tenant_id || "unknown";
    const tenant = tenantMap.get(tenantId) || { ...createAccumulator(), tenantId };
    const channel = String(row.channel || "unknown");
    const channelItem = channelMap.get(channel) || { ...createAccumulator(), channel };

    if (inCurrent) {
      currentTotalDeliveries += 1;
      tenant.currentDenominator += 1;
      channelItem.currentDenominator += 1;
    } else if (inPrevious) {
      previousTotalDeliveries += 1;
      tenant.previousDenominator += 1;
      channelItem.previousDenominator += 1;
    }

    tenantMap.set(tenantId, tenant);
    channelMap.set(channel, channelItem);
  }

  for (const row of anomalies) {
    const inCurrent = isInWindow(row.created_at, params.currentFromTs, params.currentToTs);
    const inPrevious = isInWindow(row.created_at, params.previousFromTs, params.previousToTs);
    if (!inCurrent && !inPrevious) continue;

    const tenantId = row.tenant_id || "unknown";
    const tenant = tenantMap.get(tenantId) || { ...createAccumulator(), tenantId };
    const channel = String(row.channel || "unknown");
    const channelItem = channelMap.get(channel) || { ...createAccumulator(), channel };
    const anomalyType = toAnomalyType(row);
    const anomalyTypeItem = anomalyTypeMap.get(anomalyType.key) || { ...createAccumulator(), ...anomalyType };

    if (inCurrent) {
      currentAnomalyCount += 1;
      tenant.currentCount += 1;
      channelItem.currentCount += 1;
      anomalyTypeItem.currentCount += 1;
    } else if (inPrevious) {
      previousAnomalyCount += 1;
      tenant.previousCount += 1;
      channelItem.previousCount += 1;
      anomalyTypeItem.previousCount += 1;
    }

    tenantMap.set(tenantId, tenant);
    channelMap.set(channel, channelItem);
    anomalyTypeMap.set(anomalyType.key, anomalyTypeItem);
  }

  return {
    ok: true,
    snapshot: buildSnapshotFromMaps({
      tenantId: params.tenantId || null,
      channel: params.channel || null,
      currentFromIso: params.currentFromIso,
      currentToIso: params.currentToIso,
      previousFromIso: params.previousFromIso,
      previousToIso: params.previousToIso,
      durationMs: params.durationMs,
      topLimit: params.topLimit,
      currentTotalDeliveries,
      previousTotalDeliveries,
      currentAnomalyCount,
      previousAnomalyCount,
      tenantMap,
      channelMap,
      anomalyTypeMap,
      dataSource: "raw",
    }),
  };
}

async function buildFromRollup(params: {
  supabase: SupabaseClient;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
  currentFromIso: string;
  currentToIso: string;
  previousFromIso: string;
  previousToIso: string;
  durationMs: number;
  topLimit: number;
}): Promise<{ ok: true; snapshot: NotificationAlertTrendComparisonSnapshot } | { ok: false; error: string }> {
  const baseRowsResult = await readNotificationDailyRollups({
    supabase: params.supabase,
    fromIso: params.previousFromIso,
    toIso: params.currentToIso,
    tenantId: params.tenantId || null,
    channel: params.channel || null,
  });
  if ("error" in baseRowsResult) return { ok: false, error: baseRowsResult.error };

  const anomalyRowsResult = await readNotificationDailyAnomalyRollups({
    supabase: params.supabase,
    fromIso: params.previousFromIso,
    toIso: params.currentToIso,
    tenantId: params.tenantId || null,
    channel: params.channel || null,
  });
  if ("error" in anomalyRowsResult) return { ok: false, error: anomalyRowsResult.error };

  const tenantMap = new Map<string, TenantAccumulator>();
  const anomalyTypeMap = new Map<string, AnomalyTypeAccumulator>();
  const channelMap = new Map<string, ChannelAccumulator>();

  const currentFromDay = params.currentFromIso.slice(0, 10);
  const currentToDay = params.currentToIso.slice(0, 10);
  const previousFromDay = params.previousFromIso.slice(0, 10);
  const previousToDay = params.previousToIso.slice(0, 10);

  let currentTotalDeliveries = 0;
  let previousTotalDeliveries = 0;
  let currentAnomalyCount = 0;
  let previousAnomalyCount = 0;

  for (const row of baseRowsResult.rows) {
    const rowDay = String(row.day || "").slice(0, 10);
    const inCurrent = isInDayWindow(rowDay, currentFromDay, currentToDay);
    const inPrevious = isInDayWindow(rowDay, previousFromDay, previousToDay);
    if (!inCurrent && !inPrevious) continue;

    const tenantId = row.tenant_id || "unknown";
    const tenant = tenantMap.get(tenantId) || { ...createAccumulator(), tenantId };
    const channel = String(row.channel || "unknown");
    const channelItem = channelMap.get(channel) || { ...createAccumulator(), channel };
    const deliveryTotal = Number(row.total_count || 0);
    const anomalyCount = Number(row.anomaly_count || 0);

    if (inCurrent) {
      currentTotalDeliveries += deliveryTotal;
      currentAnomalyCount += anomalyCount;
      tenant.currentDenominator += deliveryTotal;
      tenant.currentCount += anomalyCount;
      channelItem.currentDenominator += deliveryTotal;
      channelItem.currentCount += anomalyCount;
    } else if (inPrevious) {
      previousTotalDeliveries += deliveryTotal;
      previousAnomalyCount += anomalyCount;
      tenant.previousDenominator += deliveryTotal;
      tenant.previousCount += anomalyCount;
      channelItem.previousDenominator += deliveryTotal;
      channelItem.previousCount += anomalyCount;
    }

    tenantMap.set(tenantId, tenant);
    channelMap.set(channel, channelItem);
  }

  for (const row of anomalyRowsResult.rows) {
    const rowDay = String(row.day || "").slice(0, 10);
    const inCurrent = isInDayWindow(rowDay, currentFromDay, currentToDay);
    const inPrevious = isInDayWindow(rowDay, previousFromDay, previousToDay);
    if (!inCurrent && !inPrevious) continue;

    const normalizedType = toAnomalyTypeFromRollup(row);
    const anomalyTypeItem = anomalyTypeMap.get(normalizedType.key) || { ...createAccumulator(), ...normalizedType };
    const count = Number(row.anomaly_count || 0);

    if (inCurrent) anomalyTypeItem.currentCount += count;
    else if (inPrevious) anomalyTypeItem.previousCount += count;
    anomalyTypeMap.set(normalizedType.key, anomalyTypeItem);
  }

  return {
    ok: true,
    snapshot: buildSnapshotFromMaps({
      tenantId: params.tenantId || null,
      channel: params.channel || null,
      currentFromIso: params.currentFromIso,
      currentToIso: params.currentToIso,
      previousFromIso: params.previousFromIso,
      previousToIso: params.previousToIso,
      durationMs: params.durationMs,
      topLimit: params.topLimit,
      currentTotalDeliveries,
      previousTotalDeliveries,
      currentAnomalyCount,
      previousAnomalyCount,
      tenantMap,
      channelMap,
      anomalyTypeMap,
      dataSource: "rollup",
    }),
  };
}

export async function getNotificationAlertTrendComparison(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  topLimit?: number;
  aggregationMode?: NotificationTrendAggregationMode;
}): Promise<{ ok: true; snapshot: NotificationAlertTrendComparisonSnapshot } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const currentFromIso = normalizeIso(params.from, defaultFrom);
  const currentToIso = normalizeIso(params.to, now.toISOString());

  const currentFromTs = asTimestamp(currentFromIso, now.getTime() - 24 * 60 * 60 * 1000);
  const currentToTs = asTimestamp(currentToIso, now.getTime());
  if (currentToTs <= currentFromTs) return { ok: false, error: "Invalid window: to must be greater than from" };

  const durationMs = currentToTs - currentFromTs;
  const currentIsWholeDay = isUtcDayBoundary(currentFromIso, "start") && isUtcDayBoundary(currentToIso, "end");
  const previousToTs = currentFromTs - 1;
  let previousFromTs = currentFromTs - durationMs;
  if (currentIsWholeDay) {
    const dayCount = countUtcDaysInclusive(currentFromIso, currentToIso);
    previousFromTs = previousToTs - dayCount * 24 * 60 * 60 * 1000 + 1;
  }
  const previousFromIso = new Date(previousFromTs).toISOString();
  const previousToIso = new Date(previousToTs).toISOString();

  const mode = params.aggregationMode || "auto";
  const canUseRollup = canUseDailyRollupWindow({
    currentFromIso,
    currentToIso,
    previousFromIso,
    previousToIso,
  });
  const shouldUseRollup = mode === "rollup" || (mode === "auto" && canUseRollup);

  if (shouldUseRollup) {
    if (!canUseRollup) {
      if (mode === "rollup") {
        return { ok: false, error: "Rollup mode requires whole-day windows (UTC 00:00:00 to 23:59:59)." };
      }
    } else {
      const rollup = await buildFromRollup({
        supabase,
        tenantId: params.tenantId || null,
        channel: params.channel || null,
        currentFromIso,
        currentToIso,
        previousFromIso,
        previousToIso,
        durationMs,
        topLimit: Math.min(30, Math.max(3, Number(params.topLimit || 10))),
      });
      if (rollup.ok) return rollup;
      if (mode === "rollup") return rollup;
    }
  }

  return buildFromRaw({
    supabase,
    tenantId: params.tenantId || null,
    channel: params.channel || null,
    currentFromIso,
    currentToIso,
    previousFromIso,
    previousToIso,
    currentFromTs,
    currentToTs,
    previousFromTs,
    previousToTs,
    durationMs,
    limit: Math.min(80000, Math.max(200, Number(params.limit || 12000))),
    topLimit: Math.min(30, Math.max(3, Number(params.topLimit || 10))),
  });
}
