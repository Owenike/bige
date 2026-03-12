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
  status: string;
};

type FailedEventRow = {
  tenant_id: string | null;
  channel: string;
};

type StatusBucket = {
  total: number;
  deadLetter: number;
  failed: number;
  retrying: number;
};

type TenantAggregate = StatusBucket & {
  tenantId: string;
  sent: number;
  recentAnomalies: number;
  previousAnomalies: number;
  failedEvents: number;
};

type ChannelAggregate = StatusBucket & {
  channel: string;
};

type ReasonAggregate = StatusBucket & {
  key: string;
  label: string;
  sample: string | null;
  tenantSet: Set<string>;
  channelSet: Set<string>;
};

export type NotificationAnomalyReasonCluster = {
  key: string;
  label: string;
  sample: string | null;
  count: number;
  deadLetter: number;
  failed: number;
  retrying: number;
  tenantCount: number;
  channelCount: number;
};

export type NotificationAnomalyTenantStat = {
  tenantId: string;
  total: number;
  deadLetter: number;
  failed: number;
  retrying: number;
  sent: number;
  failedEvents: number;
};

export type NotificationAnomalyChannelStat = {
  channel: string;
  total: number;
  deadLetter: number;
  failed: number;
  retrying: number;
};

export type NotificationTenantAlertPriority = {
  tenantId: string;
  priority: "P1" | "P2" | "P3" | "P4";
  severity: "critical" | "high" | "medium" | "low";
  score: number;
  deadLetter: number;
  failedRate: number;
  retrying: number;
  anomalyTotal: number;
  recentAnomalies: number;
  previousAnomalies: number;
  surgeRatio: number;
  summary: string;
};

export type NotificationTenantAlertPriorityRule = {
  scoreFormula: string;
  weights: {
    deadLetter: number;
    failed: number;
    retrying: number;
    failedRateBands: Array<{ threshold: number; bonus: number }>;
    surgeBands: Array<{ condition: string; bonus: number }>;
  };
  severityBands: Array<{ severity: "critical" | "high" | "medium" | "low"; minScore: number }>;
};

export type NotificationAnomalyInsightsSnapshot = {
  from: string;
  to: string;
  tenantId: string | null;
  channel: DeliveryChannel | null;
  totalAnomalies: number;
  reasonClusters: NotificationAnomalyReasonCluster[];
  byTenant: NotificationAnomalyTenantStat[];
  byChannel: NotificationAnomalyChannelStat[];
  tenantPriorities: NotificationTenantAlertPriority[];
  priorityRule: NotificationTenantAlertPriorityRule;
};

const MESSAGE_MAX = 120;

const PRIORITY_RULE: NotificationTenantAlertPriorityRule = {
  scoreFormula:
    "score = dead_letter*5 + failed*2 + retrying*1 + failedRateBonus + surgeBonus (failedRate denominator: sent+failed)",
  weights: {
    deadLetter: 5,
    failed: 2,
    retrying: 1,
    failedRateBands: [
      { threshold: 50, bonus: 15 },
      { threshold: 30, bonus: 10 },
      { threshold: 15, bonus: 5 },
    ],
    surgeBands: [
      { condition: "recent >= 5 and recent >= previous * 2", bonus: 10 },
      { condition: "recent >= 3 and recent > previous", bonus: 5 },
    ],
  },
  severityBands: [
    { severity: "critical", minScore: 35 },
    { severity: "high", minScore: 20 },
    { severity: "medium", minScore: 8 },
    { severity: "low", minScore: 0 },
  ],
};

function normalizeIso(input: string | null | undefined, fallback: string) {
  if (!input) return fallback;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function toRate(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
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

function toReasonKey(row: DeliveryAnomalyRow) {
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
  if (category) {
    return {
      key: `MSG:${category}`,
      label: category,
      sample: message || null,
    };
  }
  return {
    key: "UNKNOWN:unknown_error",
    label: "unknown_error",
    sample: null,
  };
}

function updateStatusBucket(target: StatusBucket, status: string) {
  target.total += 1;
  if (status === "dead_letter") target.deadLetter += 1;
  if (status === "failed") target.failed += 1;
  if (status === "retrying") target.retrying += 1;
}

function computePriority(input: TenantAggregate): NotificationTenantAlertPriority {
  let score = input.deadLetter * PRIORITY_RULE.weights.deadLetter + input.failed * PRIORITY_RULE.weights.failed + input.retrying * PRIORITY_RULE.weights.retrying;
  const failedRate = toRate(input.deadLetter + input.failed, input.sent + input.deadLetter + input.failed);
  if (failedRate >= 50) score += 15;
  else if (failedRate >= 30) score += 10;
  else if (failedRate >= 15) score += 5;

  const previous = Math.max(0, input.previousAnomalies);
  const recent = Math.max(0, input.recentAnomalies);
  const ratio = previous <= 0 ? (recent > 0 ? recent : 0) : Math.round((recent / previous) * 100) / 100;
  if (recent >= 5 && (previous === 0 || recent >= previous * 2)) score += 10;
  else if (recent >= 3 && recent > previous) score += 5;

  let severity: NotificationTenantAlertPriority["severity"] = "low";
  let priority: NotificationTenantAlertPriority["priority"] = "P4";
  if (score >= 35 || input.deadLetter >= 10) {
    severity = "critical";
    priority = "P1";
  } else if (score >= 20 || input.deadLetter >= 4) {
    severity = "high";
    priority = "P2";
  } else if (score >= 8 || input.deadLetter >= 1 || input.retrying >= 3) {
    severity = "medium";
    priority = "P3";
  }

  const summary = `dead_letter ${input.deadLetter}, failed_rate ${failedRate.toFixed(2)}%, retrying ${input.retrying}, recent ${recent}, prev ${previous}`;
  return {
    tenantId: input.tenantId,
    priority,
    severity,
    score,
    deadLetter: input.deadLetter,
    failedRate,
    retrying: input.retrying,
    anomalyTotal: input.total,
    recentAnomalies: recent,
    previousAnomalies: previous,
    surgeRatio: ratio,
    summary,
  };
}

function toDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export async function getNotificationAnomalyInsights(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  topReasonLimit?: number;
  topTenantLimit?: number;
}): Promise<{ ok: true; snapshot: NotificationAnomalyInsightsSnapshot } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fromIso = normalizeIso(params.from, defaultFrom);
  const toIso = normalizeIso(params.to, now.toISOString());
  const limit = Math.min(60000, Math.max(200, Number(params.limit || 12000)));
  const topReasonLimit = Math.min(30, Math.max(5, Number(params.topReasonLimit || 12)));
  const topTenantLimit = Math.min(50, Math.max(5, Number(params.topTenantLimit || 15)));

  let anomalyQuery = supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, status, error_code, error_message, last_error, created_at")
    .in("status", ["dead_letter", "failed", "retrying"])
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  let volumeQuery = supabase
    .from("notification_deliveries")
    .select("tenant_id, channel, status")
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  let failedEventsQuery = supabase
    .from("notification_delivery_events")
    .select("tenant_id, channel")
    .eq("event_type", "failed")
    .gte("event_at", fromIso)
    .lte("event_at", toIso)
    .order("event_at", { ascending: false })
    .limit(limit);

  if (params.tenantId) {
    anomalyQuery = anomalyQuery.eq("tenant_id", params.tenantId);
    volumeQuery = volumeQuery.eq("tenant_id", params.tenantId);
    failedEventsQuery = failedEventsQuery.eq("tenant_id", params.tenantId);
  }
  if (params.channel) {
    anomalyQuery = anomalyQuery.eq("channel", params.channel);
    volumeQuery = volumeQuery.eq("channel", params.channel);
    failedEventsQuery = failedEventsQuery.eq("channel", params.channel);
  }

  const [anomalyResult, volumeResult, failedEventsResult] = await Promise.all([anomalyQuery, volumeQuery, failedEventsQuery]);
  if (anomalyResult.error) return { ok: false, error: anomalyResult.error.message };
  if (volumeResult.error) return { ok: false, error: volumeResult.error.message };
  if (failedEventsResult.error) return { ok: false, error: failedEventsResult.error.message };

  const anomalies = (anomalyResult.data || []) as DeliveryAnomalyRow[];
  const volumes = (volumeResult.data || []) as DeliveryVolumeRow[];
  const failedEvents = (failedEventsResult.data || []) as FailedEventRow[];

  const reasonMap = new Map<string, ReasonAggregate>();
  const tenantMap = new Map<string, TenantAggregate>();
  const channelMap = new Map<string, ChannelAggregate>();

  const toDateTime = toDate(toIso);
  const recentFrom = toDateTime ? new Date(toDateTime.getTime() - 24 * 60 * 60 * 1000) : null;
  const previousFrom = recentFrom ? new Date(recentFrom.getTime() - 24 * 60 * 60 * 1000) : null;

  for (const row of anomalies) {
    const tenantId = row.tenant_id || "unknown";
    const channel = String(row.channel || "unknown");
    const status = String(row.status || "");

    const reason = toReasonKey(row);
    const reasonItem = reasonMap.get(reason.key) || {
      key: reason.key,
      label: reason.label,
      sample: reason.sample,
      total: 0,
      deadLetter: 0,
      failed: 0,
      retrying: 0,
      tenantSet: new Set<string>(),
      channelSet: new Set<string>(),
    };
    updateStatusBucket(reasonItem, status);
    reasonItem.tenantSet.add(tenantId);
    reasonItem.channelSet.add(channel);
    if (!reasonItem.sample && reason.sample) reasonItem.sample = reason.sample;
    reasonMap.set(reason.key, reasonItem);

    const tenantItem = tenantMap.get(tenantId) || {
      tenantId,
      total: 0,
      deadLetter: 0,
      failed: 0,
      retrying: 0,
      sent: 0,
      recentAnomalies: 0,
      previousAnomalies: 0,
      failedEvents: 0,
    };
    updateStatusBucket(tenantItem, status);
    const createdAt = toDate(row.created_at);
    if (createdAt && recentFrom && toDateTime && createdAt >= recentFrom && createdAt <= toDateTime) tenantItem.recentAnomalies += 1;
    if (createdAt && previousFrom && recentFrom && createdAt >= previousFrom && createdAt < recentFrom) tenantItem.previousAnomalies += 1;
    tenantMap.set(tenantId, tenantItem);

    const channelItem = channelMap.get(channel) || { channel, total: 0, deadLetter: 0, failed: 0, retrying: 0 };
    updateStatusBucket(channelItem, status);
    channelMap.set(channel, channelItem);
  }

  for (const row of volumes) {
    if (String(row.status || "") !== "sent") continue;
    const tenantId = row.tenant_id || "unknown";
    const tenantItem = tenantMap.get(tenantId) || {
      tenantId,
      total: 0,
      deadLetter: 0,
      failed: 0,
      retrying: 0,
      sent: 0,
      recentAnomalies: 0,
      previousAnomalies: 0,
      failedEvents: 0,
    };
    tenantItem.sent += 1;
    tenantMap.set(tenantId, tenantItem);
  }

  for (const row of failedEvents) {
    const tenantId = row.tenant_id || "unknown";
    const tenantItem = tenantMap.get(tenantId) || {
      tenantId,
      total: 0,
      deadLetter: 0,
      failed: 0,
      retrying: 0,
      sent: 0,
      recentAnomalies: 0,
      previousAnomalies: 0,
      failedEvents: 0,
    };
    tenantItem.failedEvents += 1;
    tenantMap.set(tenantId, tenantItem);
  }

  const reasonClusters: NotificationAnomalyReasonCluster[] = Array.from(reasonMap.values())
    .map((item) => ({
      key: item.key,
      label: item.label,
      sample: item.sample,
      count: item.total,
      deadLetter: item.deadLetter,
      failed: item.failed,
      retrying: item.retrying,
      tenantCount: item.tenantSet.size,
      channelCount: item.channelSet.size,
    }))
    .sort((a, b) => b.count - a.count || b.deadLetter - a.deadLetter || a.label.localeCompare(b.label))
    .slice(0, topReasonLimit);

  const byTenant: NotificationAnomalyTenantStat[] = Array.from(tenantMap.values())
    .map((item) => ({
      tenantId: item.tenantId,
      total: item.total,
      deadLetter: item.deadLetter,
      failed: item.failed,
      retrying: item.retrying,
      sent: item.sent,
      failedEvents: item.failedEvents,
    }))
    .sort((a, b) => b.total - a.total || b.deadLetter - a.deadLetter || a.tenantId.localeCompare(b.tenantId));

  const byChannel: NotificationAnomalyChannelStat[] = Array.from(channelMap.values())
    .map((item) => ({
      channel: item.channel,
      total: item.total,
      deadLetter: item.deadLetter,
      failed: item.failed,
      retrying: item.retrying,
    }))
    .sort((a, b) => b.total - a.total || b.deadLetter - a.deadLetter || a.channel.localeCompare(b.channel));

  const tenantPriorities = Array.from(tenantMap.values())
    .map((item) => computePriority(item))
    .sort((a, b) => b.score - a.score || b.deadLetter - a.deadLetter || b.failedRate - a.failedRate || a.tenantId.localeCompare(b.tenantId))
    .slice(0, topTenantLimit);

  return {
    ok: true,
    snapshot: {
      from: fromIso,
      to: toIso,
      tenantId: params.tenantId || null,
      channel: params.channel || null,
      totalAnomalies: anomalies.length,
      reasonClusters,
      byTenant,
      byChannel,
      tenantPriorities,
      priorityRule: PRIORITY_RULE,
    },
  };
}
