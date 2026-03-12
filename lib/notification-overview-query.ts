import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import type { DeliveryChannel } from "./notification-ops";

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

export type NotificationPerformanceOverviewSnapshot = {
  from: string;
  to: string;
  tenantId: string | null;
  channel: DeliveryChannel | null;
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

export async function getNotificationPerformanceOverview(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<{ ok: true; snapshot: NotificationPerformanceOverviewSnapshot } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fromIso = normalizeIso(params.from, defaultFrom);
  const toIso = normalizeIso(params.to, now.toISOString());
  const limit = Math.min(50000, Math.max(200, Number(params.limit || 10000)));

  let deliveryQuery = supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, status, created_at, sent_at, failed_at, dead_letter_at")
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (params.tenantId) deliveryQuery = deliveryQuery.eq("tenant_id", params.tenantId);
  if (params.channel) deliveryQuery = deliveryQuery.eq("channel", params.channel);

  let eventQuery = supabase
    .from("notification_delivery_events")
    .select("tenant_id, channel, event_type, event_at")
    .in("event_type", ["opened", "clicked", "conversion"])
    .gte("event_at", fromIso)
    .lte("event_at", toIso)
    .order("event_at", { ascending: false })
    .limit(limit);
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

  const daily = Array.from(dayBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, bucket]) => toDailyStat(day, bucket));

  const byChannel = Array.from(channelBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([channel, bucket]) => toChannelStat(channel, bucket));

  const byTenant = Array.from(tenantBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tenantId, bucket]) => toTenantStat(tenantId, bucket));

  return {
    ok: true,
    snapshot: {
      from: fromIso,
      to: toIso,
      tenantId: params.tenantId || null,
      channel: params.channel || null,
      totalRows: totalBucket.total,
      sent: totalBucket.sent,
      failed: totalBucket.failed,
      pending: totalBucket.pending,
      retrying: totalBucket.retrying,
      deadLetter: totalBucket.deadLetter,
      opened: totalBucket.opened,
      clicked: totalBucket.clicked,
      conversion: totalBucket.conversion,
      successRate: toRate(totalBucket.sent, totalBucket.sent + totalBucket.failed),
      failRate: toRate(totalBucket.failed, totalBucket.sent + totalBucket.failed),
      openRate: toRate(totalBucket.opened, totalBucket.sent),
      clickRate: toRate(totalBucket.clicked, totalBucket.sent),
      conversionRate: toRate(totalBucket.conversion, totalBucket.sent),
      rateDefinitions: {
        successFailDenominator: "sent_plus_failed",
        engagementDenominator: "sent",
      },
      daily,
      byChannel,
      byTenant,
    },
  };
}

export async function getNotificationTenantPerformanceDrilldown(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  channel?: DeliveryChannel | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  anomalyLimit?: number;
}): Promise<{ ok: true; snapshot: NotificationTenantDrilldownSnapshot } | { ok: false; error: string }> {
  const overview = await getNotificationPerformanceOverview({
    supabase: params.supabase,
    tenantId: params.tenantId,
    channel: params.channel || null,
    from: params.from || null,
    to: params.to || null,
    limit: params.limit || 10000,
  });
  if (!overview.ok) return overview;

  const supabase = params.supabase ?? createSupabaseAdminClient();
  const anomalyLimit = Math.min(120, Math.max(10, Number(params.anomalyLimit || 40)));
  let anomalyQuery = supabase
    .from("notification_deliveries")
    .select("id, channel, status, error_code, error_message, last_error, attempts, retry_count, max_attempts, next_retry_at, last_attempt_at, failed_at, dead_letter_at, created_at, updated_at")
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
