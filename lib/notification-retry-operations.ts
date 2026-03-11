import { createSupabaseAdminClient } from "./supabase/admin";
import { dispatchNotificationDeliveries } from "./notification-dispatch";
import { createJobRun, completeJobRun, listDeliveryRows, type DeliveryStatus } from "./notification-ops";
import type { NotificationChannelKey, NotificationEventKey } from "./notification-productization";
import {
  evaluateRetryDecision,
  type RetryCandidateInput,
  type RetryDecision,
  type RetryDecisionCode,
} from "./notification-retry-policy";

export type RetryScope = "platform" | "tenant";

export type RetryCandidateRow = {
  id: string;
  tenant_id: string | null;
  channel: string;
  status: DeliveryStatus;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  next_retry_at: string | null;
  created_at: string;
};

export type RetryPlanSummary = {
  totalCandidates: number;
  retryable: number;
  blocked: number;
  failed: number;
  retrying: number;
  byErrorCode: Record<string, number>;
  byDecisionCode: Record<string, number>;
};

export { evaluateRetryDecision };

export async function buildRetryPlan(params: {
  tenantId?: string | null;
  statuses?: DeliveryStatus[];
  channels?: NotificationChannelKey[];
  eventType?: NotificationEventKey | null;
  deliveryIds?: string[];
  limit?: number;
}) {
  const deliveryIdSet = params.deliveryIds && params.deliveryIds.length > 0 ? new Set(params.deliveryIds) : null;
  const rows = await listDeliveryRows({
    tenantId: params.tenantId || null,
    statuses: params.statuses && params.statuses.length > 0 ? params.statuses : ["failed", "retrying"],
    channels: params.channels && params.channels.length > 0 ? params.channels : undefined,
    includeInApp: false,
    limit: Math.min(500, Math.max(1, Number(params.limit || (deliveryIdSet ? params.deliveryIds?.length || 200 : 200)))),
  });
  if (!rows.ok) {
    return {
      ok: false as const,
      error: rows.error,
      summary: {
        totalCandidates: 0,
        retryable: 0,
        blocked: 0,
        failed: 0,
        retrying: 0,
        byErrorCode: {},
        byDecisionCode: {},
      } as RetryPlanSummary,
      deliveryIds: [] as string[],
      candidates: [] as Array<RetryCandidateRow & { decision: RetryDecision }>,
    };
  }

  const filteredRows = rows.items.filter((row) => {
    if (deliveryIdSet && !deliveryIdSet.has(row.id)) return false;
    if (!params.eventType) return true;
    const payload = row.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const eventType = (payload as { event_type?: string; eventType?: string }).event_type || (payload as { event_type?: string; eventType?: string }).eventType;
    return eventType === params.eventType;
  });

  const byErrorCode: Record<string, number> = {};
  const byDecisionCode: Record<string, number> = {};
  const candidates = filteredRows.map((row) => {
    const candidate: RetryCandidateInput = {
      id: row.id,
      tenant_id: row.tenant_id,
      channel: row.channel,
      status: row.status,
      attempts: row.attempts || 0,
      max_attempts: row.max_attempts || 3,
      error_code: row.error_code,
      error_message: row.error_message,
      next_retry_at: row.next_retry_at,
      created_at: row.created_at,
    };
    const decision = evaluateRetryDecision(candidate);
    byDecisionCode[decision.code] = (byDecisionCode[decision.code] || 0) + 1;
    return {
      ...candidate,
      decision,
    };
  });

  for (const row of filteredRows) {
    const code = row.error_code || "UNKNOWN";
    byErrorCode[code] = (byErrorCode[code] || 0) + 1;
  }

  const retryableRows = candidates.filter((item) => item.decision.eligible);

  return {
    ok: true as const,
    summary: {
      totalCandidates: candidates.length,
      retryable: retryableRows.length,
      blocked: candidates.length - retryableRows.length,
      failed: filteredRows.filter((item) => item.status === "failed").length,
      retrying: filteredRows.filter((item) => item.status === "retrying").length,
      byErrorCode,
      byDecisionCode,
    } as RetryPlanSummary,
    deliveryIds: retryableRows.map((item) => item.id),
    rows: rows.items,
    candidates,
  };
}

export async function executeRetryPlan(params: {
  scope: RetryScope;
  tenantId?: string | null;
  actorId: string;
  deliveryIds: string[];
  limit?: number;
}) {
  const scopedTenantId = params.scope === "tenant" ? params.tenantId || null : params.tenantId || null;
  if (params.deliveryIds.length === 0) {
    return {
      ok: true as const,
      summary: {
        processed: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        retrying: 0,
      },
    };
  }
  const job = await createJobRun({
    tenantId: scopedTenantId,
    jobType: "delivery_dispatch",
    triggerMode: "manual",
    initiatedBy: params.actorId,
    payload: {
      source: "notification_retry_operation",
      scope: params.scope,
      deliveryIds: params.deliveryIds.slice(0, 200),
    },
  });

  const result = await dispatchNotificationDeliveries({
    tenantId: scopedTenantId,
    mode: "job",
    includeFailed: true,
    deliveryIds: params.deliveryIds,
    limit: Math.min(500, Math.max(1, Number(params.limit || params.deliveryIds.length || 200))),
  });

  if (result.ok === false) {
    const failedReason = result.error;
    await completeJobRun({
      jobRunId: job.ok ? job.jobRunId : null,
      status: "failed",
      affectedCount: 0,
      errorCount: 1,
      errorSummary: failedReason,
      payload: {},
    });
    return { ok: false as const, error: failedReason };
  }

  await completeJobRun({
    jobRunId: job.ok ? job.jobRunId : null,
    status: result.summary.failed > 0 ? (result.summary.sent > 0 ? "partial" : "failed") : "success",
    affectedCount: result.summary.processed,
    errorCount: result.summary.failed,
    errorSummary: result.summary.failed > 0 ? "Some deliveries failed during retry" : null,
    payload: {
      sent: result.summary.sent,
      skipped: result.summary.skipped,
      failed: result.summary.failed,
      retrying: result.summary.retrying,
    },
  });

  return { ok: true as const, summary: result.summary };
}

export async function validateRetryTargets(params: {
  tenantId?: string | null;
  deliveryIds: string[];
}) {
  if (params.deliveryIds.length === 0) {
    return {
      ok: true as const,
      items: [] as string[],
      rejected: [] as Array<{ id: string; code: RetryDecisionCode; reason: string }>,
    };
  }
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("notification_deliveries")
    .select("id, tenant_id, channel, status, attempts, max_attempts, error_code, error_message, next_retry_at, created_at")
    .in("id", params.deliveryIds)
    .neq("channel", "in_app");
  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  const result = await query;
  if (result.error) {
    return {
      ok: false as const,
      error: result.error.message,
      items: [] as string[],
      rejected: [] as Array<{ id: string; code: RetryDecisionCode; reason: string }>,
    };
  }
  const candidates = (result.data || []) as RetryCandidateRow[];
  const accepted: string[] = [];
  const rejected: Array<{ id: string; code: RetryDecisionCode; reason: string }> = [];
  for (const candidate of candidates) {
    const decision = evaluateRetryDecision(candidate);
    if (decision.eligible) accepted.push(candidate.id);
    else rejected.push({ id: candidate.id, code: decision.code, reason: decision.reason });
  }
  for (const id of params.deliveryIds) {
    if (!accepted.includes(id) && !rejected.find((item) => item.id === id)) {
      rejected.push({
        id,
        code: "STATUS_NOT_RETRYABLE",
        reason: "delivery not found in scope or not retryable",
      });
    }
  }
  return { ok: true as const, items: accepted, rejected };
}



