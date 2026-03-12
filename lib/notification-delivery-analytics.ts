import type { SupabaseClient } from "@supabase/supabase-js";
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

export type NotificationDeliveryDailyStat = {
  day: string;
  sent: number;
  failed: number;
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
  successRate: number;
  failRate: number;
};

export type NotificationDeliveryTenantStat = {
  tenantId: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  retrying: number;
  deadLetter: number;
  successRate: number;
  failRate: number;
};

export type NotificationDeliveryAnalyticsSnapshot = {
  from: string;
  to: string;
  tenantId: string | null;
  totalRows: number;
  sent: number;
  failed: number;
  pending: number;
  retrying: number;
  deadLetter: number;
  successRate: number;
  failRate: number;
  daily: NotificationDeliveryDailyStat[];
  byChannel: NotificationDeliveryChannelStat[];
  byTenant: NotificationDeliveryTenantStat[];
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

function bucketInit() {
  return {
    total: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    retrying: 0,
    deadLetter: 0,
  };
}

function applyStatusBucket(bucket: ReturnType<typeof bucketInit>, status: string) {
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

export async function getNotificationDeliveryAnalytics(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<{ ok: true; snapshot: NotificationDeliveryAnalyticsSnapshot } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fromIso = normalizeIso(params.from, defaultFrom);
  const toIso = normalizeIso(params.to, now.toISOString());
  const limit = Math.min(50000, Math.max(200, Number(params.limit || 10000)));

  let query = supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, status, created_at, sent_at, failed_at, dead_letter_at")
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);

  const result = await query;
  if (result.error) return { ok: false, error: result.error.message };
  const rows = (result.data || []) as DeliveryAnalyticsRow[];

  const totalBucket = bucketInit();
  const dayBuckets = new Map<string, ReturnType<typeof bucketInit>>();
  const channelBuckets = new Map<string, ReturnType<typeof bucketInit>>();
  const tenantBuckets = new Map<string, ReturnType<typeof bucketInit>>();

  for (const row of rows) {
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

  const daily: NotificationDeliveryDailyStat[] = Array.from(dayBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, bucket]) => ({
      day,
      sent: bucket.sent,
      failed: bucket.failed,
      total: bucket.sent + bucket.failed,
      successRate: toRate(bucket.sent, bucket.sent + bucket.failed),
      failRate: toRate(bucket.failed, bucket.sent + bucket.failed),
    }));

  const byChannel: NotificationDeliveryChannelStat[] = Array.from(channelBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([channel, bucket]) => ({
      channel,
      total: bucket.total,
      sent: bucket.sent,
      failed: bucket.failed,
      pending: bucket.pending,
      retrying: bucket.retrying,
      deadLetter: bucket.deadLetter,
      successRate: toRate(bucket.sent, bucket.sent + bucket.failed),
      failRate: toRate(bucket.failed, bucket.sent + bucket.failed),
    }));

  const byTenant: NotificationDeliveryTenantStat[] = Array.from(tenantBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tenantId, bucket]) => ({
      tenantId,
      total: bucket.total,
      sent: bucket.sent,
      failed: bucket.failed,
      pending: bucket.pending,
      retrying: bucket.retrying,
      deadLetter: bucket.deadLetter,
      successRate: toRate(bucket.sent, bucket.sent + bucket.failed),
      failRate: toRate(bucket.failed, bucket.sent + bucket.failed),
    }));

  return {
    ok: true,
    snapshot: {
      from: fromIso,
      to: toIso,
      tenantId: params.tenantId || null,
      totalRows: totalBucket.total,
      sent: totalBucket.sent,
      failed: totalBucket.failed,
      pending: totalBucket.pending,
      retrying: totalBucket.retrying,
      deadLetter: totalBucket.deadLetter,
      successRate: toRate(totalBucket.sent, totalBucket.sent + totalBucket.failed),
      failRate: toRate(totalBucket.failed, totalBucket.sent + totalBucket.failed),
      daily,
      byChannel,
      byTenant,
    },
  };
}
