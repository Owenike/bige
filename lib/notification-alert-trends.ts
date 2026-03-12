import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import type { DeliveryChannel } from "./notification-ops";

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

export type NotificationAlertTrendComparisonSnapshot = {
  tenantId: string | null;
  channel: DeliveryChannel | null;
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

function isInWindow(input: string, fromTime: number, toTime: number) {
  const date = new Date(input);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  if (time < fromTime || time > toTime) return null;
  return time;
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

function sortByWorsening<T extends NotificationTrendComparisonItem>(rows: T[]) {
  return [...rows].sort(
    (a, b) => b.countDelta - a.countDelta || b.rateDelta - a.rateDelta || b.currentCount - a.currentCount || a.previousCount - b.previousCount,
  );
}

export async function getNotificationAlertTrendComparison(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  topLimit?: number;
}): Promise<{ ok: true; snapshot: NotificationAlertTrendComparisonSnapshot } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const currentFromIso = normalizeIso(params.from, defaultFrom);
  const currentToIso = normalizeIso(params.to, now.toISOString());

  const currentFromTs = asTimestamp(currentFromIso, now.getTime() - 24 * 60 * 60 * 1000);
  const currentToTs = asTimestamp(currentToIso, now.getTime());
  if (currentToTs <= currentFromTs) {
    return { ok: false, error: "Invalid window: to must be greater than from" };
  }

  const durationMs = currentToTs - currentFromTs;
  const previousToTs = currentFromTs - 1;
  const previousFromTs = currentFromTs - durationMs;
  const previousFromIso = new Date(previousFromTs).toISOString();
  const previousToIso = new Date(previousToTs).toISOString();
  const combinedFromIso = previousFromIso;
  const combinedToIso = currentToIso;

  const limit = Math.min(80000, Math.max(200, Number(params.limit || 12000)));
  const topLimit = Math.min(30, Math.max(3, Number(params.topLimit || 10)));

  let anomalyQuery = supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, status, error_code, error_message, last_error, created_at")
    .in("status", ["dead_letter", "failed", "retrying"])
    .gte("created_at", combinedFromIso)
    .lte("created_at", combinedToIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  let volumeQuery = supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, created_at")
    .gte("created_at", combinedFromIso)
    .lte("created_at", combinedToIso)
    .order("created_at", { ascending: false })
    .limit(limit);

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
    const inCurrent = isInWindow(row.created_at, currentFromTs, currentToTs);
    const inPrevious = isInWindow(row.created_at, previousFromTs, previousToTs);
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
    const inCurrent = isInWindow(row.created_at, currentFromTs, currentToTs);
    const inPrevious = isInWindow(row.created_at, previousFromTs, previousToTs);
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

  for (const tenant of tenantMap.values()) {
    tenant.currentDenominator = tenant.currentDenominator || currentTotalDeliveries;
    tenant.previousDenominator = tenant.previousDenominator || previousTotalDeliveries;
  }
  for (const channel of channelMap.values()) {
    channel.currentDenominator = channel.currentDenominator || currentTotalDeliveries;
    channel.previousDenominator = channel.previousDenominator || previousTotalDeliveries;
  }
  for (const item of anomalyTypeMap.values()) {
    item.currentDenominator = currentTotalDeliveries;
    item.previousDenominator = previousTotalDeliveries;
  }

  const byTenant = sortByWorsening(
    Array.from(tenantMap.values()).map((item) => ({
      tenantId: item.tenantId,
      ...buildNotificationTrendComparisonItem(item),
    })),
  );

  const byAnomalyType = sortByWorsening(
    Array.from(anomalyTypeMap.values()).map((item) => ({
      key: item.key,
      label: item.label,
      sample: item.sample,
      ...buildNotificationTrendComparisonItem(item),
    })),
  );

  const byChannel = sortByWorsening(
    Array.from(channelMap.values()).map((item) => ({
      channel: item.channel,
      ...buildNotificationTrendComparisonItem(item),
    })),
  );

  const topWorseningTenants = byTenant.filter((item) => item.direction === "up" && item.countDelta > 0).slice(0, topLimit);
  const topWorseningAnomalyTypes = byAnomalyType
    .filter((item) => item.direction === "up" && item.countDelta > 0)
    .slice(0, topLimit);
  const topWorseningChannels = byChannel.filter((item) => item.direction === "up" && item.countDelta > 0).slice(0, topLimit);

  const overall = buildNotificationTrendComparisonItem({
    currentCount: currentAnomalyCount,
    previousCount: previousAnomalyCount,
    currentDenominator: currentTotalDeliveries,
    previousDenominator: previousTotalDeliveries,
  });

  return {
    ok: true,
    snapshot: {
      tenantId: params.tenantId || null,
      channel: params.channel || null,
      currentWindow: {
        from: currentFromIso,
        to: currentToIso,
        durationMinutes: Math.round(durationMs / 60000),
        totalDeliveries: currentTotalDeliveries,
        anomalyCount: currentAnomalyCount,
        anomalyRate: toRate(currentAnomalyCount, currentTotalDeliveries),
      },
      previousWindow: {
        from: previousFromIso,
        to: previousToIso,
        durationMinutes: Math.round(durationMs / 60000),
        totalDeliveries: previousTotalDeliveries,
        anomalyCount: previousAnomalyCount,
        anomalyRate: toRate(previousAnomalyCount, previousTotalDeliveries),
      },
      overall,
      byTenant,
      byAnomalyType,
      byChannel,
      topWorseningTenants,
      topWorseningAnomalyTypes,
      topWorseningChannels,
      rateDefinitions: {
        anomalyRateDenominator: "total_deliveries_in_window",
      },
    },
  };
}
