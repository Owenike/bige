import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import type { AppRole } from "./auth-context";

export type JobType = "notification_sweep" | "opportunity_sweep" | "delivery_dispatch" | "reminder_bundle";
export type JobTriggerMode = "scheduled" | "manual" | "api" | "inline";
export type JobStatus = "running" | "success" | "failed" | "partial";

export type DeliveryChannel = "in_app" | "email" | "line" | "sms" | "webhook" | "other";
export type DeliveryStatus = "pending" | "sent" | "failed" | "skipped" | "retrying";

export type DeliveryRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  notification_id: string | null;
  opportunity_id: string | null;
  source_ref_type: string | null;
  source_ref_id: string | null;
  recipient_user_id: string | null;
  recipient_role: AppRole | null;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  attempts: number;
  max_attempts: number;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  provider_message_id: string | null;
  provider_response: Record<string, unknown> | null;
  dedupe_key: string | null;
  payload: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type CreateJobRunInput = {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  branchId?: string | null;
  jobType: JobType;
  triggerMode: JobTriggerMode;
  initiatedBy?: string | null;
  payload?: Record<string, unknown>;
};

type CompleteJobRunInput = {
  supabase?: SupabaseClient;
  jobRunId: string | null;
  status: JobStatus;
  affectedCount: number;
  errorCount: number;
  errorSummary?: string | null;
  payload?: Record<string, unknown>;
};

type DeliveryInsertInput = {
  supabase?: SupabaseClient;
  rows: Array<{
    tenantId?: string | null;
    branchId?: string | null;
    notificationId?: string | null;
    opportunityId?: string | null;
    sourceRefType?: string | null;
    sourceRefId?: string | null;
    recipientUserId?: string | null;
    recipientRole?: AppRole | null;
    channel: DeliveryChannel;
    status: DeliveryStatus;
    attempts?: number;
    maxAttempts?: number;
    lastAttemptAt?: string | null;
    nextRetryAt?: string | null;
    sentAt?: string | null;
    failedAt?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    providerMessageId?: string | null;
    providerResponse?: Record<string, unknown> | null;
    dedupeKey?: string | null;
    payload?: Record<string, unknown>;
    createdBy?: string | null;
  }>;
};

function nowIso() {
  return new Date().toISOString();
}

export async function createJobRun(input: CreateJobRunInput) {
  const supabase = input.supabase ?? createSupabaseAdminClient();
  const result = await supabase
    .from("notification_job_runs")
    .insert({
      tenant_id: input.tenantId ?? null,
      branch_id: input.branchId ?? null,
      job_type: input.jobType,
      trigger_mode: input.triggerMode,
      status: "running",
      started_at: nowIso(),
      initiated_by: input.initiatedBy ?? null,
      payload: input.payload || {},
      updated_at: nowIso(),
    })
    .select("id, started_at")
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, jobRunId: null };
  return {
    ok: true as const,
    jobRunId: String(result.data?.id || ""),
    startedAt: String(result.data?.started_at || nowIso()),
  };
}

export async function completeJobRun(input: CompleteJobRunInput) {
  if (!input.jobRunId) return { ok: true as const };
  const supabase = input.supabase ?? createSupabaseAdminClient();
  const finishedAt = nowIso();
  const update = await supabase
    .from("notification_job_runs")
    .update({
      status: input.status,
      finished_at: finishedAt,
      duration_ms: null,
      affected_count: input.affectedCount,
      error_count: input.errorCount,
      error_summary: input.errorSummary || null,
      payload: input.payload || {},
      updated_at: finishedAt,
    })
    .eq("id", input.jobRunId);
  if (update.error) return { ok: false as const, error: update.error.message };
  return { ok: true as const };
}

export async function insertDeliveryRows(input: DeliveryInsertInput) {
  if (input.rows.length === 0) return { ok: true as const, items: [] as DeliveryRow[] };
  const supabase = input.supabase ?? createSupabaseAdminClient();
  const rows = input.rows.map((row) => ({
    tenant_id: row.tenantId ?? null,
    branch_id: row.branchId ?? null,
    notification_id: row.notificationId ?? null,
    opportunity_id: row.opportunityId ?? null,
    source_ref_type: row.sourceRefType ?? null,
    source_ref_id: row.sourceRefId ?? null,
    recipient_user_id: row.recipientUserId ?? null,
    recipient_role: row.recipientRole ?? null,
    channel: row.channel,
    status: row.status,
    attempts: typeof row.attempts === "number" ? row.attempts : 0,
    max_attempts: typeof row.maxAttempts === "number" ? row.maxAttempts : 3,
    last_attempt_at: row.lastAttemptAt ?? null,
    next_retry_at: row.nextRetryAt ?? null,
    sent_at: row.sentAt ?? null,
    failed_at: row.failedAt ?? null,
    error_code: row.errorCode ?? null,
    error_message: row.errorMessage ?? null,
    provider_message_id: row.providerMessageId ?? null,
    provider_response: row.providerResponse || {},
    dedupe_key: row.dedupeKey ?? null,
    payload: row.payload || {},
    created_by: row.createdBy ?? null,
    updated_at: nowIso(),
  }));
  const insert = await supabase
    .from("notification_deliveries")
    .upsert(rows, { onConflict: "channel,dedupe_key", ignoreDuplicates: true })
    .select("id, tenant_id, branch_id, notification_id, opportunity_id, source_ref_type, source_ref_id, recipient_user_id, recipient_role, channel, status, attempts, max_attempts, last_attempt_at, next_retry_at, sent_at, failed_at, error_code, error_message, provider_message_id, provider_response, dedupe_key, payload, created_by, created_at, updated_at");
  if (insert.error) return { ok: false as const, error: insert.error.message, items: [] as DeliveryRow[] };
  return { ok: true as const, items: (insert.data || []) as DeliveryRow[] };
}

export async function updateDeliveryStatus(params: {
  supabase?: SupabaseClient;
  id: string;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt?: string | null;
  nextRetryAt?: string | null;
  sentAt?: string | null;
  failedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerMessageId?: string | null;
  providerResponse?: Record<string, unknown> | null;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const patch: {
    status: DeliveryStatus;
    attempts: number;
    last_attempt_at: string | null;
    next_retry_at: string | null;
    sent_at: string | null;
    failed_at: string | null;
    error_code: string | null;
    error_message: string | null;
    provider_message_id?: string | null;
    provider_response?: Record<string, unknown> | null;
    updated_at: string;
  } = {
    status: params.status,
    attempts: params.attempts,
    last_attempt_at: params.lastAttemptAt ?? null,
    next_retry_at: params.nextRetryAt ?? null,
    sent_at: params.sentAt ?? null,
    failed_at: params.failedAt ?? null,
    error_code: params.errorCode ?? null,
    error_message: params.errorMessage ?? null,
    updated_at: nowIso(),
  };
  if (Object.prototype.hasOwnProperty.call(params, "providerMessageId")) {
    patch.provider_message_id = params.providerMessageId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(params, "providerResponse")) {
    patch.provider_response = params.providerResponse ?? null;
  }
  const update = await supabase
    .from("notification_deliveries")
    .update(patch)
    .eq("id", params.id);
  if (update.error) return { ok: false as const, error: update.error.message };
  return { ok: true as const };
}

export async function listRecentJobRuns(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  limit?: number;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  let query = supabase
    .from("notification_job_runs")
    .select("id, tenant_id, branch_id, job_type, trigger_mode, status, started_at, finished_at, duration_ms, affected_count, error_count, error_summary, payload, initiated_by, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, params.limit || 40)));
  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message, items: [] as Array<Record<string, unknown>> };
  return { ok: true as const, items: (result.data || []) as Array<Record<string, unknown>> };
}

export async function listDeliveryRows(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  statuses?: DeliveryStatus[];
  channels?: DeliveryChannel[];
  includeInApp?: boolean;
  limit?: number;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  let query = supabase
    .from("notification_deliveries")
    .select("id, tenant_id, branch_id, notification_id, opportunity_id, source_ref_type, source_ref_id, recipient_user_id, recipient_role, channel, status, attempts, max_attempts, last_attempt_at, next_retry_at, sent_at, failed_at, error_code, error_message, provider_message_id, provider_response, dedupe_key, payload, created_by, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(500, Math.max(1, params.limit || 120)));
  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  if (params.statuses && params.statuses.length > 0) query = query.in("status", params.statuses);
  if (params.channels && params.channels.length > 0) query = query.in("channel", params.channels);
  if (params.includeInApp === false) query = query.neq("channel", "in_app");
  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message, items: [] as DeliveryRow[] };
  return { ok: true as const, items: (result.data || []) as DeliveryRow[] };
}
