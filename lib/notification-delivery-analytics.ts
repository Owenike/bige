import type { SupabaseClient } from "@supabase/supabase-js";
import { isUtcDayBoundary, readNotificationDailyRollups } from "./notification-rollup";
import { createSupabaseAdminClient } from "./supabase/admin";

type DeliveryAnalyticsRow = {
  tenant_id: string | null;
  channel: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  failed_at: string | null;
  dead_letter_at: string | null;
};

type EventAnalyticsRow = {
  tenant_id: string | null;
  channel: string;
  event_type: string;
  event_at: string;
};

export type NotificationDeliveryDailyStat = {
  day: string;
  sent: number;
  failed: number;
  deadLetter: number;
  opened: number;
  clicked: number;
  conversion: number;
  total: number;
  successRate: number;
  failRate: number;
};

export type NotificationDeliveryChannelStat = {
  channel: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  retrying: number;
  deadLetter: number;
  opened: number;
  clicked: number;
  conversion: number;
  successRate: number;
  failRate: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
};

export type NotificationDeliveryTenantStat = {
  tenantId: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  retrying: number;
  deadLetter: number;
  opened: number;
  clicked: number;
  conversion: number;
  successRate: number;
  failRate: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
};

export type NotificationDeliveryAnalyticsAggregationMode = "auto" | "raw" | "rollup";

export type NotificationDeliveryAnalyticsSnapshot = {
  from: string;
  to: string;
  tenantId: string | null;
  dataSource: "raw" | "rollup";
  totalRows: number;
  sent: number;
  failed: number;
  pending: number;
  retrying: number;
  deadLetter: number;
  opened: number;
  clicked: number;
  conversion: number;
  successRate: number;
  failRate: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
  rateDefinitions: {
    successFailDenominator: "sent_plus_failed";
    engagementDenominator: "sent";
  };
  daily: NotificationDeliveryDailyStat[];
  byChannel: NotificationDeliveryChannelStat[];
  byTenant: NotificationDeliveryTenantStat[];
};

type DeliveryAnalyticsBucket = {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  retrying: number;
  deadLetter: number;
  opened: number;
  clicked: number;
  conversion: number;
};

function normalizeIso(input: string | null | undefined, fallback: string) {
  if (!input) return fallback;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function dateKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function toRate(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function bucketInit(): DeliveryAnalyticsBucket {
  return {
    total: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    retrying: 0,
    deadLetter: 0,
    opened: 0,
    clicked: 0,
    conversion: 0,
  };
}

function applyStatusBucket(bucket: DeliveryAnalyticsBucket, status: string) {
  bucket.total += 1;
  if (status === "sent") bucket.sent += 1;
  if (status === "pending") bucket.pending += 1;
  if (status === "retrying") bucket.retrying += 1;
  if (status === "failed") bucket.failed += 1;
  if (status === "dead_letter") {
    bucket.failed += 1;
    bucket.deadLetter += 1;
  }
}

function applyEventBucket(bucket: DeliveryAnalyticsBucket, eventType: string) {
  if (eventType === "opened") bucket.opened += 1;
  if (eventType === "clicked") bucket.clicked += 1;
  if (eventType === "conversion") bucket.conversion += 1;
}

function mergeRollupBucket(bucket: DeliveryAnalyticsBucket, row: {
  total_count: number;
  sent_count: number;
  failed_count: number;
  pending_count: number;
  retrying_count: number;
  dead_letter_count: number;
  opened_count: number;
  clicked_count: number;
  conversion_count: number;
}) {
  bucket.total += Number(row.total_count || 0);
  bucket.sent += Number(row.sent_count || 0);
  bucket.failed += Number(row.failed_count || 0);
  bucket.pending += Number(row.pending_count || 0);
  bucket.retrying += Number(row.retrying_count || 0);
  bucket.deadLetter += Number(row.dead_letter_count || 0);
  bucket.opened += Number(row.opened_count || 0);
  bucket.clicked += Number(row.clicked_count || 0);
  bucket.conversion += Number(row.conversion_count || 0);
}

function toChannelStat(channel: string, bucket: DeliveryAnalyticsBucket): NotificationDeliveryChannelStat {
  return {
    channel,
    total: bucket.total,
    sent: bucket.sent,
    failed: bucket.failed,
    pending: bucket.pending,
    retrying: bucket.retrying,
    deadLetter: bucket.deadLetter,
    opened: bucket.opened,
    clicked: bucket.clicked,
    conversion: bucket.conversion,
    successRate: toRate(bucket.sent, bucket.sent + bucket.failed),
    failRate: toRate(bucket.failed, bucket.sent + bucket.failed),
    openRate: toRate(bucket.opened, bucket.sent),
    clickRate: toRate(bucket.clicked, bucket.sent),
    conversionRate: toRate(bucket.conversion, bucket.sent),
  };
}

function toTenantStat(tenantId: string, bucket: DeliveryAnalyticsBucket): NotificationDeliveryTenantStat {
  return {
    tenantId,
    total: bucket.total,
    sent: bucket.sent,
    failed: bucket.failed,
    pending: bucket.pending,
    retrying: bucket.retrying,
    deadLetter: bucket.deadLetter,
    opened: bucket.opened,
    clicked: bucket.clicked,
    conversion: bucket.conversion,
    successRate: toRate(bucket.sent, bucket.sent + bucket.failed),
    failRate: toRate(bucket.failed, bucket.sent + bucket.failed),
    openRate: toRate(bucket.opened, bucket.sent),
    clickRate: toRate(bucket.clicked, bucket.sent),
    conversionRate: toRate(bucket.conversion, bucket.sent),
  };
}

function toDailyStat(day: string, bucket: DeliveryAnalyticsBucket): NotificationDeliveryDailyStat {
  return {
    day,
    sent: bucket.sent,
    failed: bucket.failed,
    deadLetter: bucket.deadLetter,
    opened: bucket.opened,
    clicked: bucket.clicked,
    conversion: bucket.conversion,
    total: bucket.sent + bucket.failed,
    successRate: toRate(bucket.sent, bucket.sent + bucket.failed),
    failRate: toRate(bucket.failed, bucket.sent + bucket.failed),
  };
}

function buildSnapshot(params: {
  fromIso: string;
  toIso: string;
  tenantId: string | null;
  dataSource: "raw" | "rollup";
  totalBucket: DeliveryAnalyticsBucket;
  dayBuckets: Map<string, DeliveryAnalyticsBucket>;
  channelBuckets: Map<string, DeliveryAnalyticsBucket>;
  tenantBuckets: Map<string, DeliveryAnalyticsBucket>;
}): NotificationDeliveryAnalyticsSnapshot {
  const daily: NotificationDeliveryDailyStat[] = Array.from(params.dayBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, bucket]) => toDailyStat(day, bucket));

  const byChannel: NotificationDeliveryChannelStat[] = Array.from(params.channelBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([channel, bucket]) => toChannelStat(channel, bucket));

  const byTenant: NotificationDeliveryTenantStat[] = Array.from(params.tenantBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tenantId, bucket]) => toTenantStat(tenantId, bucket));

  return {
    from: params.fromIso,
    to: params.toIso,
    tenantId: params.tenantId,
    dataSource: params.dataSource,
    totalRows: params.totalBucket.total,
    sent: params.totalBucket.sent,
    failed: params.totalBucket.failed,
    pending: params.totalBucket.pending,
    retrying: params.totalBucket.retrying,
    deadLetter: params.totalBucket.deadLetter,
    opened: params.totalBucket.opened,
    clicked: params.totalBucket.clicked,
    conversion: params.totalBucket.conversion,
    successRate: toRate(params.totalBucket.sent, params.totalBucket.sent + params.totalBucket.failed),
    failRate: toRate(params.totalBucket.failed, params.totalBucket.sent + params.totalBucket.failed),
    openRate: toRate(params.totalBucket.opened, params.totalBucket.sent),
    clickRate: toRate(params.totalBucket.clicked, params.totalBucket.sent),
    conversionRate: toRate(params.totalBucket.conversion, params.totalBucket.sent),
    rateDefinitions: {
      successFailDenominator: "sent_plus_failed",
      engagementDenominator: "sent",
    },
    daily,
    byChannel,
    byTenant,
  };
}

export function canUseAnalyticsDailyRollupWindow(fromIso: string, toIso: string) {
  return isUtcDayBoundary(fromIso, "start") && isUtcDayBoundary(toIso, "end");
}

async function getAnalyticsFromRaw(params: {
  supabase: SupabaseClient;
  tenantId?: string | null;
  fromIso: string;
  toIso: string;
  limit: number;
}): Promise<{ ok: true; snapshot: NotificationDeliveryAnalyticsSnapshot } | { ok: false; error: string }> {
  let deliveryQuery = params.supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, status, created_at, sent_at, failed_at, dead_letter_at")
    .gte("created_at", params.fromIso)
    .lte("created_at", params.toIso)
    .order("created_at", { ascending: false })
    .limit(params.limit);
  if (params.tenantId) deliveryQuery = deliveryQuery.eq("tenant_id", params.tenantId);

  let eventQuery = params.supabase
    .from("notification_delivery_events")
    .select("tenant_id, channel, event_type, event_at")
    .in("event_type", ["opened", "clicked", "conversion"])
    .gte("event_at", params.fromIso)
    .lte("event_at", params.toIso)
    .order("event_at", { ascending: false })
    .limit(params.limit);
  if (params.tenantId) eventQuery = eventQuery.eq("tenant_id", params.tenantId);

  const [deliveryResult, eventResult] = await Promise.all([deliveryQuery, eventQuery]);
  if (deliveryResult.error) return { ok: false, error: deliveryResult.error.message };
  if (eventResult.error) return { ok: false, error: eventResult.error.message };

  const deliveryRows = (deliveryResult.data || []) as DeliveryAnalyticsRow[];
  const eventRows = (eventResult.data || []) as EventAnalyticsRow[];

  const totalBucket = bucketInit();
  const dayBuckets = new Map<string, DeliveryAnalyticsBucket>();
  const channelBuckets = new Map<string, DeliveryAnalyticsBucket>();
  const tenantBuckets = new Map<string, DeliveryAnalyticsBucket>();

  for (const row of deliveryRows) {
    const status = String(row.status || "");
    applyStatusBucket(totalBucket, status);

    const daySource = row.sent_at || row.failed_at || row.dead_letter_at || row.created_at;
    const day = dateKey(daySource);
    const dayBucket = dayBuckets.get(day) || bucketInit();
    applyStatusBucket(dayBucket, status);
    dayBuckets.set(day, dayBucket);

    const channel = String(row.channel || "unknown");
    const channelBucket = channelBuckets.get(channel) || bucketInit();
    applyStatusBucket(channelBucket, status);
    channelBuckets.set(channel, channelBucket);

    const tenantId = row.tenant_id || "unknown";
    const tenantBucket = tenantBuckets.get(tenantId) || bucketInit();
    applyStatusBucket(tenantBucket, status);
    tenantBuckets.set(tenantId, tenantBucket);
  }

  for (const row of eventRows) {
    const eventType = String(row.event_type || "");
    applyEventBucket(totalBucket, eventType);

    const day = dateKey(row.event_at);
    const dayBucket = dayBuckets.get(day) || bucketInit();
    applyEventBucket(dayBucket, eventType);
    dayBuckets.set(day, dayBucket);

    const channel = String(row.channel || "unknown");
    const channelBucket = channelBuckets.get(channel) || bucketInit();
    applyEventBucket(channelBucket, eventType);
    channelBuckets.set(channel, channelBucket);

    const tenantId = row.tenant_id || "unknown";
    const tenantBucket = tenantBuckets.get(tenantId) || bucketInit();
    applyEventBucket(tenantBucket, eventType);
    tenantBuckets.set(tenantId, tenantBucket);
  }

  return {
    ok: true,
    snapshot: buildSnapshot({
      fromIso: params.fromIso,
      toIso: params.toIso,
      tenantId: params.tenantId || null,
      dataSource: "raw",
      totalBucket,
      dayBuckets,
      channelBuckets,
      tenantBuckets,
    }),
  };
}

async function getAnalyticsFromRollup(params: {
  supabase: SupabaseClient;
  tenantId?: string | null;
  fromIso: string;
  toIso: string;
}): Promise<{ ok: true; snapshot: NotificationDeliveryAnalyticsSnapshot } | { ok: false; error: string }> {
  const rollupRowsResult = await readNotificationDailyRollups({
    supabase: params.supabase,
    fromIso: params.fromIso,
    toIso: params.toIso,
    tenantId: params.tenantId || null,
    channel: null,
  });
  if ("error" in rollupRowsResult) return { ok: false, error: rollupRowsResult.error };

  const totalBucket = bucketInit();
  const dayBuckets = new Map<string, DeliveryAnalyticsBucket>();
  const channelBuckets = new Map<string, DeliveryAnalyticsBucket>();
  const tenantBuckets = new Map<string, DeliveryAnalyticsBucket>();

  for (const row of rollupRowsResult.rows) {
    mergeRollupBucket(totalBucket, row);

    const day = String(row.day || "").slice(0, 10);
    const dayBucket = dayBuckets.get(day) || bucketInit();
    mergeRollupBucket(dayBucket, row);
    dayBuckets.set(day, dayBucket);

    const channel = String(row.channel || "unknown");
    const channelBucket = channelBuckets.get(channel) || bucketInit();
    mergeRollupBucket(channelBucket, row);
    channelBuckets.set(channel, channelBucket);

    const tenantId = row.tenant_id || "unknown";
    const tenantBucket = tenantBuckets.get(tenantId) || bucketInit();
    mergeRollupBucket(tenantBucket, row);
    tenantBuckets.set(tenantId, tenantBucket);
  }

  return {
    ok: true,
    snapshot: buildSnapshot({
      fromIso: params.fromIso,
      toIso: params.toIso,
      tenantId: params.tenantId || null,
      dataSource: "rollup",
      totalBucket,
      dayBuckets,
      channelBuckets,
      tenantBuckets,
    }),
  };
}

export async function getNotificationDeliveryAnalytics(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  aggregationMode?: NotificationDeliveryAnalyticsAggregationMode;
}): Promise<{ ok: true; snapshot: NotificationDeliveryAnalyticsSnapshot } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fromIso = normalizeIso(params.from, defaultFrom);
  const toIso = normalizeIso(params.to, now.toISOString());
  const limit = Math.min(50000, Math.max(200, Number(params.limit || 10000)));
  const mode = params.aggregationMode || "auto";

  const canUseRollup = canUseAnalyticsDailyRollupWindow(fromIso, toIso);
  const shouldUseRollup = mode === "rollup" || (mode === "auto" && canUseRollup);
  if (shouldUseRollup) {
    if (!canUseRollup) {
      if (mode === "rollup") return { ok: false, error: "Rollup mode requires whole-day windows (UTC 00:00:00 to 23:59:59)." };
    } else {
      const rollup = await getAnalyticsFromRollup({
        supabase,
        tenantId: params.tenantId || null,
        fromIso,
        toIso,
      });
      if (rollup.ok) return rollup;
      if (mode === "rollup") return rollup;
    }
  }

  return getAnalyticsFromRaw({
    supabase,
    tenantId: params.tenantId || null,
    fromIso,
    toIso,
    limit,
  });
}
