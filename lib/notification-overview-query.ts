import type { SupabaseClient } from "@supabase/supabase-js";
import { isUtcDayBoundary, readNotificationDailyRollups } from "./notification-rollup";
import type { DeliveryChannel } from "./notification-ops";
import { createSupabaseAdminClient } from "./supabase/admin";

type DeliveryOverviewRow = {
  tenant_id: string | null;
  channel: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  failed_at: string | null;
  dead_letter_at: string | null;
};

type EventOverviewRow = {
  tenant_id: string | null;
  channel: string;
  event_type: string;
  event_at: string;
};

type DeliveryAnomalyRow = {
  id: string;
  channel: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  last_error: string | null;
  attempts: number;
  retry_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_attempt_at: string | null;
  failed_at: string | null;
  dead_letter_at: string | null;
  created_at: string;
  updated_at: string;
};

type OverviewBucket = {
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

export type NotificationOverviewDailyStat = {
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

export type NotificationOverviewChannelStat = {
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

export type NotificationOverviewTenantStat = {
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

export type NotificationOverviewAggregationMode = "auto" | "raw" | "rollup";

export type NotificationPerformanceOverviewSnapshot = {
  from: string;
  to: string;
  tenantId: string | null;
  channel: DeliveryChannel | null;
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
  daily: NotificationOverviewDailyStat[];
  byChannel: NotificationOverviewChannelStat[];
  byTenant: NotificationOverviewTenantStat[];
};

export type NotificationTenantAnomalyItem = {
  id: string;
  channel: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  lastError: string | null;
  attempts: number;
  retryCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  failedAt: string | null;
  deadLetterAt: string | null;
  occurredAt: string;
};

export type NotificationTenantDrilldownSnapshot = {
  from: string;
  to: string;
  tenantId: string;
  channel: DeliveryChannel | null;
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
  daily: NotificationOverviewDailyStat[];
  byChannel: NotificationOverviewChannelStat[];
  recentAnomalies: NotificationTenantAnomalyItem[];
  anomalySummary: {
    total: number;
    failed: number;
    deadLetter: number;
    retrying: number;
  };
};

export type NotificationTenantDrilldownAggregationMode = "auto" | "raw" | "rollup";

function normalizeIso(input: string | null | undefined, fallback: string) {
  if (!input) return fallback;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function toDateKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function toRate(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function createBucket(): OverviewBucket {
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

function applyDeliveryStatus(bucket: OverviewBucket, status: string) {
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

function applyEngagementEvent(bucket: OverviewBucket, eventType: string) {
  if (eventType === "opened") bucket.opened += 1;
  if (eventType === "clicked") bucket.clicked += 1;
  if (eventType === "conversion") bucket.conversion += 1;
}

function mergeRollupRow(bucket: OverviewBucket, row: {
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

function toChannelStat(channel: string, bucket: OverviewBucket): NotificationOverviewChannelStat {
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

function toTenantStat(tenantId: string, bucket: OverviewBucket): NotificationOverviewTenantStat {
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

function toDailyStat(day: string, bucket: OverviewBucket): NotificationOverviewDailyStat {
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

function buildOverviewSnapshot(params: {
  fromIso: string;
  toIso: string;
  tenantId: string | null;
  channel: DeliveryChannel | null;
  dataSource: "raw" | "rollup";
  totalBucket: OverviewBucket;
  dayBuckets: Map<string, OverviewBucket>;
  channelBuckets: Map<string, OverviewBucket>;
  tenantBuckets: Map<string, OverviewBucket>;
}): NotificationPerformanceOverviewSnapshot {
  const daily = Array.from(params.dayBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, bucket]) => toDailyStat(day, bucket));

  const byChannel = Array.from(params.channelBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([channel, bucket]) => toChannelStat(channel, bucket));

  const byTenant = Array.from(params.tenantBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tenantId, bucket]) => toTenantStat(tenantId, bucket));

  return {
    from: params.fromIso,
    to: params.toIso,
    tenantId: params.tenantId,
    channel: params.channel,
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

export function canUseOverviewDailyRollupWindow(fromIso: string, toIso: string) {
  return isUtcDayBoundary(fromIso, "start") && isUtcDayBoundary(toIso, "end");
}

export function canUseTenantDrilldownDailyRollupWindow(fromIso: string, toIso: string) {
  return canUseOverviewDailyRollupWindow(fromIso, toIso);
}

async function getOverviewFromRaw(params: {
  supabase: SupabaseClient;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
  fromIso: string;
  toIso: string;
  limit: number;
}): Promise<{ ok: true; snapshot: NotificationPerformanceOverviewSnapshot } | { ok: false; error: string }> {
  let deliveryQuery = params.supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, status, created_at, sent_at, failed_at, dead_letter_at")
    .gte("created_at", params.fromIso)
    .lte("created_at", params.toIso)
    .order("created_at", { ascending: false })
    .limit(params.limit);
  if (params.tenantId) deliveryQuery = deliveryQuery.eq("tenant_id", params.tenantId);
  if (params.channel) deliveryQuery = deliveryQuery.eq("channel", params.channel);

  let eventQuery = params.supabase
    .from("notification_delivery_events")
    .select("tenant_id, channel, event_type, event_at")
    .in("event_type", ["opened", "clicked", "conversion"])
    .gte("event_at", params.fromIso)
    .lte("event_at", params.toIso)
    .order("event_at", { ascending: false })
    .limit(params.limit);
  if (params.tenantId) eventQuery = eventQuery.eq("tenant_id", params.tenantId);
  if (params.channel) eventQuery = eventQuery.eq("channel", params.channel);

  const [deliveriesResult, eventsResult] = await Promise.all([deliveryQuery, eventQuery]);
  if (deliveriesResult.error) return { ok: false, error: deliveriesResult.error.message };
  if (eventsResult.error) return { ok: false, error: eventsResult.error.message };

  const deliveries = (deliveriesResult.data || []) as DeliveryOverviewRow[];
  const events = (eventsResult.data || []) as EventOverviewRow[];

  const totalBucket = createBucket();
  const dayBuckets = new Map<string, OverviewBucket>();
  const channelBuckets = new Map<string, OverviewBucket>();
  const tenantBuckets = new Map<string, OverviewBucket>();

  for (const row of deliveries) {
    const status = String(row.status || "");
    applyDeliveryStatus(totalBucket, status);

    const daySource = row.sent_at || row.failed_at || row.dead_letter_at || row.created_at;
    const day = toDateKey(daySource);
    const dayBucket = dayBuckets.get(day) || createBucket();
    applyDeliveryStatus(dayBucket, status);
    dayBuckets.set(day, dayBucket);

    const channel = String(row.channel || "unknown");
    const channelBucket = channelBuckets.get(channel) || createBucket();
    applyDeliveryStatus(channelBucket, status);
    channelBuckets.set(channel, channelBucket);

    const tenantId = row.tenant_id || "unknown";
    const tenantBucket = tenantBuckets.get(tenantId) || createBucket();
    applyDeliveryStatus(tenantBucket, status);
    tenantBuckets.set(tenantId, tenantBucket);
  }

  for (const row of events) {
    const eventType = String(row.event_type || "");
    applyEngagementEvent(totalBucket, eventType);

    const day = toDateKey(row.event_at);
    const dayBucket = dayBuckets.get(day) || createBucket();
    applyEngagementEvent(dayBucket, eventType);
    dayBuckets.set(day, dayBucket);

    const channel = String(row.channel || "unknown");
    const channelBucket = channelBuckets.get(channel) || createBucket();
    applyEngagementEvent(channelBucket, eventType);
    channelBuckets.set(channel, channelBucket);

    const tenantId = row.tenant_id || "unknown";
    const tenantBucket = tenantBuckets.get(tenantId) || createBucket();
    applyEngagementEvent(tenantBucket, eventType);
    tenantBuckets.set(tenantId, tenantBucket);
  }

  return {
    ok: true,
    snapshot: buildOverviewSnapshot({
      fromIso: params.fromIso,
      toIso: params.toIso,
      tenantId: params.tenantId || null,
      channel: params.channel || null,
      dataSource: "raw",
      totalBucket,
      dayBuckets,
      channelBuckets,
      tenantBuckets,
    }),
  };
}

async function getOverviewFromRollup(params: {
  supabase: SupabaseClient;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
  fromIso: string;
  toIso: string;
}): Promise<{ ok: true; snapshot: NotificationPerformanceOverviewSnapshot } | { ok: false; error: string }> {
  const rollupRowsResult = await readNotificationDailyRollups({
    supabase: params.supabase,
    fromIso: params.fromIso,
    toIso: params.toIso,
    tenantId: params.tenantId || null,
    channel: params.channel || null,
  });
  if ("error" in rollupRowsResult) return { ok: false, error: rollupRowsResult.error };

  const totalBucket = createBucket();
  const dayBuckets = new Map<string, OverviewBucket>();
  const channelBuckets = new Map<string, OverviewBucket>();
  const tenantBuckets = new Map<string, OverviewBucket>();

  for (const row of rollupRowsResult.rows) {
    mergeRollupRow(totalBucket, row);

    const day = String(row.day || "").slice(0, 10);
    const dayBucket = dayBuckets.get(day) || createBucket();
    mergeRollupRow(dayBucket, row);
    dayBuckets.set(day, dayBucket);

    const channel = String(row.channel || "unknown");
    const channelBucket = channelBuckets.get(channel) || createBucket();
    mergeRollupRow(channelBucket, row);
    channelBuckets.set(channel, channelBucket);

    const tenantId = row.tenant_id || "unknown";
    const tenantBucket = tenantBuckets.get(tenantId) || createBucket();
    mergeRollupRow(tenantBucket, row);
    tenantBuckets.set(tenantId, tenantBucket);
  }

  return {
    ok: true,
    snapshot: buildOverviewSnapshot({
      fromIso: params.fromIso,
      toIso: params.toIso,
      tenantId: params.tenantId || null,
      channel: params.channel || null,
      dataSource: "rollup",
      totalBucket,
      dayBuckets,
      channelBuckets,
      tenantBuckets,
    }),
  };
}

export async function getNotificationPerformanceOverview(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  aggregationMode?: NotificationOverviewAggregationMode;
}): Promise<{ ok: true; snapshot: NotificationPerformanceOverviewSnapshot } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fromIso = normalizeIso(params.from, defaultFrom);
  const toIso = normalizeIso(params.to, now.toISOString());
  const limit = Math.min(50000, Math.max(200, Number(params.limit || 10000)));
  const mode = params.aggregationMode || "auto";

  const canUseRollup = canUseOverviewDailyRollupWindow(fromIso, toIso);
  const shouldUseRollup = mode === "rollup" || (mode === "auto" && canUseRollup);
  if (shouldUseRollup) {
    if (!canUseRollup) {
      if (mode === "rollup") {
        return { ok: false, error: "Rollup mode requires whole-day windows (UTC 00:00:00 to 23:59:59)." };
      }
    } else {
      const rollup = await getOverviewFromRollup({
        supabase,
        tenantId: params.tenantId || null,
        channel: params.channel || null,
        fromIso,
        toIso,
      });
      if (rollup.ok) return rollup;
      if (mode === "rollup") return rollup;
    }
  }

  return getOverviewFromRaw({
    supabase,
    tenantId: params.tenantId || null,
    channel: params.channel || null,
    fromIso,
    toIso,
    limit,
  });
}

export async function getNotificationTenantPerformanceDrilldown(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  channel?: DeliveryChannel | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  anomalyLimit?: number;
  aggregationMode?: NotificationTenantDrilldownAggregationMode;
}): Promise<{ ok: true; snapshot: NotificationTenantDrilldownSnapshot } | { ok: false; error: string }> {
  const overview = await getNotificationPerformanceOverview({
    supabase: params.supabase,
    tenantId: params.tenantId,
    channel: params.channel || null,
    from: params.from || null,
    to: params.to || null,
    limit: params.limit || 10000,
    aggregationMode: params.aggregationMode || "auto",
  });
  if ("error" in overview) return { ok: false, error: overview.error };

  const supabase = params.supabase ?? createSupabaseAdminClient();
  const anomalyLimit = Math.min(120, Math.max(10, Number(params.anomalyLimit || 40)));
  let anomalyQuery = supabase
    .from("notification_deliveries")
    .select(
      "id, channel, status, error_code, error_message, last_error, attempts, retry_count, max_attempts, next_retry_at, last_attempt_at, failed_at, dead_letter_at, created_at, updated_at",
    )
    .eq("tenant_id", params.tenantId)
    .in("status", ["failed", "dead_letter", "retrying"])
    .gte("created_at", overview.snapshot.from)
    .lte("created_at", overview.snapshot.to)
    .order("updated_at", { ascending: false })
    .limit(anomalyLimit);
  if (params.channel) anomalyQuery = anomalyQuery.eq("channel", params.channel);
  const anomaliesResult = await anomalyQuery;
  if (anomaliesResult.error) return { ok: false, error: anomaliesResult.error.message };
  const anomalies = (anomaliesResult.data || []) as DeliveryAnomalyRow[];

  const recentAnomalies: NotificationTenantAnomalyItem[] = anomalies.map((row) => {
    const occurredAt = row.dead_letter_at || row.failed_at || row.last_attempt_at || row.updated_at || row.created_at;
    return {
      id: row.id,
      channel: row.channel,
      status: row.status,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      lastError: row.last_error,
      attempts: Number(row.attempts || 0),
      retryCount: Number(row.retry_count || 0),
      maxAttempts: Number(row.max_attempts || 0),
      nextRetryAt: row.next_retry_at,
      lastAttemptAt: row.last_attempt_at,
      failedAt: row.failed_at,
      deadLetterAt: row.dead_letter_at,
      occurredAt,
    };
  });

  const anomalySummary = {
    total: recentAnomalies.length,
    failed: recentAnomalies.filter((item) => item.status === "failed").length,
    deadLetter: recentAnomalies.filter((item) => item.status === "dead_letter").length,
    retrying: recentAnomalies.filter((item) => item.status === "retrying").length,
  };

  return {
    ok: true,
    snapshot: {
      from: overview.snapshot.from,
      to: overview.snapshot.to,
      tenantId: params.tenantId,
      channel: overview.snapshot.channel,
      dataSource: overview.snapshot.dataSource,
      totalRows: overview.snapshot.totalRows,
      sent: overview.snapshot.sent,
      failed: overview.snapshot.failed,
      pending: overview.snapshot.pending,
      retrying: overview.snapshot.retrying,
      deadLetter: overview.snapshot.deadLetter,
      opened: overview.snapshot.opened,
      clicked: overview.snapshot.clicked,
      conversion: overview.snapshot.conversion,
      successRate: overview.snapshot.successRate,
      failRate: overview.snapshot.failRate,
      openRate: overview.snapshot.openRate,
      clickRate: overview.snapshot.clickRate,
      conversionRate: overview.snapshot.conversionRate,
      rateDefinitions: overview.snapshot.rateDefinitions,
      daily: overview.snapshot.daily,
      byChannel: overview.snapshot.byChannel,
      recentAnomalies,
      anomalySummary,
    },
  };
}
