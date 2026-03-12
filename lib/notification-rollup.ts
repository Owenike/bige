import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import type { DeliveryChannel } from "./notification-ops";

export type NotificationDailyRollupRow = {
  day: string;
  tenant_id: string;
  channel: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  pending_count: number;
  retrying_count: number;
  dead_letter_count: number;
  anomaly_count: number;
  opened_count: number;
  clicked_count: number;
  conversion_count: number;
};

export type NotificationDailyAnomalyRollupRow = {
  day: string;
  tenant_id: string;
  channel: string;
  anomaly_key: string;
  anomaly_label: string;
  sample_error: string | null;
  anomaly_count: number;
};

function normalizeDate(input: string | null | undefined) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function normalizeIso(input: string | null | undefined, fallback: string) {
  if (!input) return fallback;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

export function isUtcDayBoundary(input: string | null | undefined, kind: "start" | "end") {
  if (!input) return false;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return false;
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();
  if (kind === "start") return hour === 0 && minute === 0 && second === 0 && ms === 0;
  return hour === 23 && minute === 59 && second === 59;
}

export function canUseDailyRollupWindow(params: {
  currentFromIso: string;
  currentToIso: string;
  previousFromIso: string;
  previousToIso: string;
}) {
  return (
    isUtcDayBoundary(params.currentFromIso, "start") &&
    isUtcDayBoundary(params.currentToIso, "end") &&
    isUtcDayBoundary(params.previousFromIso, "start") &&
    isUtcDayBoundary(params.previousToIso, "end")
  );
}

export function toUtcDateKey(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export async function rebuildNotificationDailyRollups(params: {
  supabase?: SupabaseClient;
  fromDate?: string | null;
  toDate?: string | null;
  tenantId?: string | null;
}): Promise<{ ok: true; summary: Record<string, unknown> } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date();
  const defaultFromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const defaultToDate = now.toISOString().slice(0, 10);
  const fromDate = normalizeDate(params.fromDate) || defaultFromDate;
  const toDate = normalizeDate(params.toDate) || defaultToDate;

  const { data, error } = await supabase.rpc("rebuild_notification_daily_rollups", {
    p_from_date: fromDate,
    p_to_date: toDate,
    p_tenant_id: params.tenantId || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, summary: (data || {}) as Record<string, unknown> };
}

export async function refreshNotificationDailyRollupsIncremental(params?: {
  supabase?: SupabaseClient;
  days?: number;
  tenantId?: string | null;
}): Promise<{ ok: true; summary: Record<string, unknown> } | { ok: false; error: string }> {
  const supabase = params?.supabase ?? createSupabaseAdminClient();
  const days = Math.min(30, Math.max(1, Number(params?.days || 3)));
  const { data, error } = await supabase.rpc("refresh_notification_daily_rollups_incremental", {
    p_days: days,
    p_tenant_id: params?.tenantId || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, summary: (data || {}) as Record<string, unknown> };
}

export async function readNotificationDailyRollups(params: {
  supabase?: SupabaseClient;
  fromIso: string;
  toIso: string;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
}): Promise<{ ok: true; rows: NotificationDailyRollupRow[]; fromDate: string; toDate: string } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date().toISOString();
  const fromIso = normalizeIso(params.fromIso, now);
  const toIso = normalizeIso(params.toIso, now);
  const fromDate = toUtcDateKey(fromIso);
  const toDate = toUtcDateKey(toIso);

  let query = supabase
    .from("notification_delivery_daily_rollups")
    .select(
      "day, tenant_id, channel, total_count, sent_count, failed_count, pending_count, retrying_count, dead_letter_count, anomaly_count, opened_count, clicked_count, conversion_count",
    )
    .gte("day", fromDate)
    .lte("day", toDate)
    .order("day", { ascending: true });
  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  if (params.channel) query = query.eq("channel", params.channel);

  const result = await query;
  if (result.error) return { ok: false, error: result.error.message };
  return {
    ok: true,
    rows: (result.data || []) as NotificationDailyRollupRow[],
    fromDate,
    toDate,
  };
}

export async function readNotificationDailyAnomalyRollups(params: {
  supabase?: SupabaseClient;
  fromIso: string;
  toIso: string;
  tenantId?: string | null;
  channel?: DeliveryChannel | null;
}): Promise<{ ok: true; rows: NotificationDailyAnomalyRollupRow[]; fromDate: string; toDate: string } | { ok: false; error: string }> {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const now = new Date().toISOString();
  const fromIso = normalizeIso(params.fromIso, now);
  const toIso = normalizeIso(params.toIso, now);
  const fromDate = toUtcDateKey(fromIso);
  const toDate = toUtcDateKey(toIso);

  let query = supabase
    .from("notification_delivery_anomaly_daily_rollups")
    .select("day, tenant_id, channel, anomaly_key, anomaly_label, sample_error, anomaly_count")
    .gte("day", fromDate)
    .lte("day", toDate)
    .order("day", { ascending: true });
  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  if (params.channel) query = query.eq("channel", params.channel);

  const result = await query;
  if (result.error) return { ok: false, error: result.error.message };
  return {
    ok: true,
    rows: (result.data || []) as NotificationDailyAnomalyRollupRow[],
    fromDate,
    toDate,
  };
}
