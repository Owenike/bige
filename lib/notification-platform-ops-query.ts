import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MANAGER_EDITABLE_ROLE_KEYS,
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  type NotificationChannelKey,
  type NotificationEventKey,
} from "./notification-productization";
import { createSupabaseAdminClient } from "./supabase/admin";
import { selectTemplateWithFallback, type NotificationTemplateFallbackInput } from "./notification-productization-resolution";

export type NotificationOpsScope = "platform" | "tenant";

export type NotificationHealthSummary = {
  total: number;
  sent: number;
  failed: number;
  retrying: number;
  skipped: number;
  pending: number;
  channelNotConfigured: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  providerErrorCodes: Record<string, number>;
};

export type ScheduledHealthSummary = {
  latestRun: {
    id: string;
    createdAt: string;
    status: string;
    jobType: string;
    errorCount: number;
  } | null;
  lastScheduledAt: string | null;
  minutesSinceLastScheduled: number | null;
  healthStatus: "healthy" | "degraded" | "stale" | "no_runs";
  byJobTypeLatest: Record<string, { id: string; status: string; createdAt: string; errorCount: number }>;
};

export type TemplateCoverageSummary = {
  expectedCombinations: number;
  coveredCombinations: number;
  missingCombinations: number;
  missing: Array<{ eventType: NotificationEventKey; channel: NotificationChannelKey }>;
};

export type PreferenceCoverageSummary = {
  expectedRoleEventPairs: number;
  configuredRoleEventPairs: number;
  missingRoleEventPairs: number;
  missing: Array<{ role: string; eventType: NotificationEventKey }>;
  channelEnabledCount: Record<NotificationChannelKey, number>;
  userPreferenceRows: number;
};

export type RetryOperationsSummary = {
  executeRuns: number;
  executeByStatus: Record<string, number>;
  auditRows: number;
  dryRunActions: number;
  executeActions: number;
  blockedReasons: Record<string, number>;
};

export type NotificationOpsReliabilitySnapshot = {
  scope: NotificationOpsScope;
  tenantId: string | null;
  notificationHealth: NotificationHealthSummary;
  scheduledHealth: ScheduledHealthSummary;
  templateCoverage: TemplateCoverageSummary;
  preferenceCoverage: PreferenceCoverageSummary;
  retryOperations: RetryOperationsSummary;
};

type SharedQueryParams = {
  supabase?: SupabaseClient;
  scope: NotificationOpsScope;
  tenantId?: string | null;
  limit?: number;
};

function nowMs() {
  return Date.now();
}

function countBy<T>(items: T[], toKey: (item: T) => string | null | undefined) {
  const output: Record<string, number> = {};
  for (const item of items) {
    const key = toKey(item);
    if (!key) continue;
    output[key] = (output[key] || 0) + 1;
  }
  return output;
}

function resolveScopeTenantId(scope: NotificationOpsScope, tenantId: string | null | undefined) {
  if (scope === "tenant" && !tenantId) {
    throw new Error("tenantId is required for tenant scope query");
  }
  return tenantId || null;
}

function isMissingRelationError(message: string) {
  return message.includes("does not exist") || message.includes("schema cache");
}

function toMinutesSince(iso: string | null) {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((nowMs() - ts) / (60 * 1000)));
}

export function computeScheduledHealthFromRows(params: {
  rows: Array<{ id: string; created_at: string; status: string; job_type: string; error_count: number }>;
  staleAfterMinutes?: number;
}): ScheduledHealthSummary {
  const staleAfterMinutes = Math.max(1, Number(params.staleAfterMinutes || 1440));
  const rows = params.rows.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const latest = rows[0] || null;
  const minutesSince = toMinutesSince(latest?.created_at || null);
  const byJobTypeLatest: ScheduledHealthSummary["byJobTypeLatest"] = {};

  for (const row of rows) {
    if (!byJobTypeLatest[row.job_type]) {
      byJobTypeLatest[row.job_type] = {
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        errorCount: Number(row.error_count || 0),
      };
    }
  }

  let healthStatus: ScheduledHealthSummary["healthStatus"] = "healthy";
  if (!latest) healthStatus = "no_runs";
  else if ((minutesSince || 0) > staleAfterMinutes) healthStatus = "stale";
  else if (latest.status === "failed" || Number(latest.error_count || 0) > 0) healthStatus = "degraded";

  return {
    latestRun: latest
      ? {
          id: latest.id,
          createdAt: latest.created_at,
          status: latest.status,
          jobType: latest.job_type,
          errorCount: Number(latest.error_count || 0),
        }
      : null,
    lastScheduledAt: latest?.created_at || null,
    minutesSinceLastScheduled: minutesSince,
    healthStatus,
    byJobTypeLatest,
  };
}

export function computeTemplateCoverageFromRows(params: {
  tenantId: string | null;
  rows: NotificationTemplateFallbackInput[];
  defaultLocale?: string;
}): TemplateCoverageSummary {
  const missing: TemplateCoverageSummary["missing"] = [];
  const defaultLocale = params.defaultLocale || "zh-TW";
  const expectedCombinations = NOTIFICATION_EVENT_KEYS.length * NOTIFICATION_CHANNEL_KEYS.length;
  let coveredCombinations = 0;

  for (const eventType of NOTIFICATION_EVENT_KEYS) {
    for (const channel of NOTIFICATION_CHANNEL_KEYS) {
      const selected = selectTemplateWithFallback({
        templates: params.rows,
        tenantId: params.tenantId,
        eventType,
        channel,
        locale: defaultLocale,
        defaultLocale,
      }).selected;
      if (selected) coveredCombinations += 1;
      else missing.push({ eventType, channel });
    }
  }

  return {
    expectedCombinations,
    coveredCombinations,
    missingCombinations: missing.length,
    missing,
  };
}

export function computePreferenceCoverageFromRows(params: {
  roleRows: Array<{ role: string; event_type: string; channels: Record<string, boolean> }>;
  userRowsCount: number;
}): PreferenceCoverageSummary {
  const expectedPairs = MANAGER_EDITABLE_ROLE_KEYS.length * NOTIFICATION_EVENT_KEYS.length;
  const pairSet = new Set<string>();
  const channelEnabledCount = NOTIFICATION_CHANNEL_KEYS.reduce<Record<NotificationChannelKey, number>>((acc, channel) => {
    acc[channel] = 0;
    return acc;
  }, {} as Record<NotificationChannelKey, number>);

  for (const row of params.roleRows) {
    const role = row.role;
    const eventType = row.event_type;
    pairSet.add(`${role}:${eventType}`);
    for (const channel of NOTIFICATION_CHANNEL_KEYS) {
      if (row.channels?.[channel]) channelEnabledCount[channel] += 1;
    }
  }

  const missing: PreferenceCoverageSummary["missing"] = [];
  for (const role of MANAGER_EDITABLE_ROLE_KEYS) {
    for (const eventType of NOTIFICATION_EVENT_KEYS) {
      const key = `${role}:${eventType}`;
      if (!pairSet.has(key)) missing.push({ role, eventType });
    }
  }

  return {
    expectedRoleEventPairs: expectedPairs,
    configuredRoleEventPairs: pairSet.size,
    missingRoleEventPairs: missing.length,
    missing,
    channelEnabledCount,
    userPreferenceRows: params.userRowsCount,
  };
}

export async function getTenantNotificationHealthSummary(params: SharedQueryParams) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const scopedTenantId = resolveScopeTenantId(params.scope, params.tenantId);
  let query = supabase
    .from("notification_deliveries")
    .select("status, channel, error_code, created_at, tenant_id")
    .order("created_at", { ascending: false })
    .limit(Math.min(2000, Math.max(100, Number(params.limit || 800))));
  if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);
  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message };

  const rows = (result.data || []) as Array<{
    status: string;
    channel: string;
    error_code: string | null;
  }>;
  const byStatus = countBy(rows, (row) => row.status);
  const byChannel = countBy(rows, (row) => row.channel);
  const providerErrorCodes = countBy(
    rows.filter((row) => row.error_code && row.error_code !== "CHANNEL_POLICY_SKIPPED"),
    (row) => row.error_code,
  );

  const summary: NotificationHealthSummary = {
    total: rows.length,
    sent: byStatus.sent || 0,
    failed: byStatus.failed || 0,
    retrying: byStatus.retrying || 0,
    skipped: byStatus.skipped || 0,
    pending: byStatus.pending || 0,
    channelNotConfigured: rows.filter((row) => row.error_code === "CHANNEL_NOT_CONFIGURED").length,
    byStatus,
    byChannel,
    providerErrorCodes,
  };
  return { ok: true as const, summary };
}

export async function getTenantScheduledHealthSummary(params: SharedQueryParams & { staleAfterMinutes?: number }) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const scopedTenantId = resolveScopeTenantId(params.scope, params.tenantId);
  let query = supabase
    .from("notification_job_runs")
    .select("id, created_at, status, job_type, error_count, trigger_mode, tenant_id")
    .eq("trigger_mode", "scheduled")
    .order("created_at", { ascending: false })
    .limit(Math.min(400, Math.max(30, Number(params.limit || 120))));
  if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);
  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message };

  const rows = (result.data || []) as Array<{
    id: string;
    created_at: string;
    status: string;
    job_type: string;
    error_count: number;
  }>;
  return {
    ok: true as const,
    summary: computeScheduledHealthFromRows({
      rows,
      staleAfterMinutes: params.staleAfterMinutes || 1440,
    }),
  };
}

export async function getTemplateCoverageSummary(params: SharedQueryParams & { defaultLocale?: string }) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const scopedTenantId = resolveScopeTenantId(params.scope, params.tenantId);
  let query = supabase
    .from("notification_templates")
    .select("id, tenant_id, event_type, channel, locale, is_active, version, updated_at")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(Math.min(3000, Math.max(100, Number(params.limit || 1500))));
  if (scopedTenantId) query = query.or(`tenant_id.is.null,tenant_id.eq.${scopedTenantId}`);
  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message };
  const rows = (result.data || []) as NotificationTemplateFallbackInput[];
  return {
    ok: true as const,
    summary: computeTemplateCoverageFromRows({
      tenantId: scopedTenantId,
      rows,
      defaultLocale: params.defaultLocale || "zh-TW",
    }),
  };
}

export async function getPreferenceCoverageSummary(params: SharedQueryParams) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const scopedTenantId = resolveScopeTenantId(params.scope, params.tenantId);
  if (!scopedTenantId) {
    return {
      ok: true as const,
      summary: computePreferenceCoverageFromRows({ roleRows: [], userRowsCount: 0 }),
    };
  }

  const [roleResult, userResult] = await Promise.all([
    supabase
      .from("notification_role_preferences")
      .select("role, event_type, channels")
      .eq("tenant_id", scopedTenantId)
      .limit(4000),
    supabase
      .from("notification_user_preferences")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", scopedTenantId),
  ]);

  if (roleResult.error) return { ok: false as const, error: roleResult.error.message };
  if (userResult.error) return { ok: false as const, error: userResult.error.message };

  return {
    ok: true as const,
    summary: computePreferenceCoverageFromRows({
      roleRows: (roleResult.data || []) as Array<{ role: string; event_type: string; channels: Record<string, boolean> }>,
      userRowsCount: userResult.count || 0,
    }),
  };
}

export async function getRetryOperationsSummary(params: SharedQueryParams) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const scopedTenantId = resolveScopeTenantId(params.scope, params.tenantId);
  let jobQuery = supabase
    .from("notification_job_runs")
    .select("id, status, payload, tenant_id, created_at, job_type, trigger_mode")
    .eq("job_type", "delivery_dispatch")
    .eq("trigger_mode", "manual")
    .order("created_at", { ascending: false })
    .limit(Math.min(1200, Math.max(100, Number(params.limit || 500))));
  if (scopedTenantId) jobQuery = jobQuery.eq("tenant_id", scopedTenantId);
  const jobResult = await jobQuery;
  if (jobResult.error) return { ok: false as const, error: jobResult.error.message };

  const retryRuns = ((jobResult.data || []) as Array<{ status: string; payload: Record<string, unknown> | null }>).filter((row) => {
    const payload = row.payload || {};
    return payload && typeof payload === "object" && (payload as { source?: string }).source === "notification_retry_operation";
  });
  const executeByStatus = countBy(retryRuns, (row) => row.status);

  let auditRows: Array<{ action: string; metadata: Record<string, unknown> | null }> = [];
  let auditError: string | null = null;
  let auditQuery = supabase
    .from("notification_admin_audit_logs")
    .select("action, metadata, tenant_id, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(1200, Math.max(100, Number(params.limit || 500))));
  if (scopedTenantId) auditQuery = auditQuery.eq("tenant_id", scopedTenantId);
  const auditResult = await auditQuery;
  if (auditResult.error) {
    if (!isMissingRelationError(auditResult.error.message)) {
      auditError = auditResult.error.message;
    }
  } else {
    auditRows = (auditResult.data || []) as Array<{ action: string; metadata: Record<string, unknown> | null }>;
  }

  const blockedReasons: Record<string, number> = {};
  for (const row of auditRows) {
    const blocked = (row.metadata as { blocked?: Array<{ code?: string }> } | null)?.blocked;
    if (!Array.isArray(blocked)) continue;
    for (const item of blocked) {
      const code = String(item?.code || "UNKNOWN");
      blockedReasons[code] = (blockedReasons[code] || 0) + 1;
    }
  }

  return {
    ok: true as const,
    summary: {
      executeRuns: retryRuns.length,
      executeByStatus,
      auditRows: auditRows.length,
      dryRunActions: auditRows.filter((row) => row.action === "retry_dry_run").length,
      executeActions: auditRows.filter((row) => row.action === "retry_execute").length,
      blockedReasons,
    } as RetryOperationsSummary,
    warning: auditError,
  };
}

export async function getNotificationOpsReliabilitySnapshot(params: SharedQueryParams & {
  defaultLocale?: string;
  staleAfterMinutes?: number;
}) {
  const scope = params.scope;
  const tenantId = resolveScopeTenantId(scope, params.tenantId);
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const [notificationHealth, scheduledHealth, templateCoverage, preferenceCoverage, retryOperations] = await Promise.all([
    getTenantNotificationHealthSummary({ ...params, supabase, tenantId, scope }),
    getTenantScheduledHealthSummary({ ...params, supabase, tenantId, scope, staleAfterMinutes: params.staleAfterMinutes }),
    getTemplateCoverageSummary({ ...params, supabase, tenantId, scope, defaultLocale: params.defaultLocale }),
    getPreferenceCoverageSummary({ ...params, supabase, tenantId, scope }),
    getRetryOperationsSummary({ ...params, supabase, tenantId, scope }),
  ]);

  if (!notificationHealth.ok) return notificationHealth;
  if (!scheduledHealth.ok) return scheduledHealth;
  if (!templateCoverage.ok) return templateCoverage;
  if (!preferenceCoverage.ok) return preferenceCoverage;
  if (!retryOperations.ok) return retryOperations;

  return {
    ok: true as const,
    snapshot: {
      scope,
      tenantId,
      notificationHealth: notificationHealth.summary,
      scheduledHealth: scheduledHealth.summary,
      templateCoverage: templateCoverage.summary,
      preferenceCoverage: preferenceCoverage.summary,
      retryOperations: retryOperations.summary,
    } as NotificationOpsReliabilitySnapshot,
    warning: retryOperations.warning || null,
  };
}
