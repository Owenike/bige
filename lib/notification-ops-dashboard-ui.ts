import { fetchApiJson } from "./notification-productization-ui";

export type OpsDashboardMode = "platform" | "manager";
export type OpsStatusFilter = "all" | "failed" | "retrying" | "skipped";

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
  missing: Array<{ eventType: string; channel: string }>;
};

export type PreferenceCoverageSummary = {
  expectedRoleEventPairs: number;
  configuredRoleEventPairs: number;
  missingRoleEventPairs: number;
  missing: Array<{ role: string; eventType: string }>;
  channelEnabledCount: Record<string, number>;
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
  scope: "platform" | "tenant";
  tenantId: string | null;
  notificationHealth: NotificationHealthSummary;
  scheduledHealth: ScheduledHealthSummary;
  templateCoverage: TemplateCoverageSummary;
  preferenceCoverage: PreferenceCoverageSummary;
  retryOperations: RetryOperationsSummary;
};

export type OpsSummaryApiData = {
  scope: "platform" | "tenant";
  tenantId: string | null;
  snapshot: NotificationOpsReliabilitySnapshot;
  warning?: string | null;
};

export type OpsHealthApiData = {
  scope: "platform" | "tenant";
  tenantId: string | null;
  notificationHealth: NotificationHealthSummary;
  scheduledHealth: ScheduledHealthSummary;
};

export type OpsCoverageApiData = {
  scope: "platform" | "tenant";
  tenantId: string | null;
  templateCoverage: TemplateCoverageSummary;
  preferenceCoverage: PreferenceCoverageSummary;
  retryOperations: RetryOperationsSummary;
  warning?: string | null;
};

export type OpsDashboardBundle = {
  scope: "platform" | "tenant";
  tenantId: string | null;
  summary: OpsSummaryApiData;
  health: OpsHealthApiData;
  coverage: OpsCoverageApiData;
  warnings: string[];
};

export type OpsDashboardQuery = {
  tenantId: string | null;
  limit: number;
  staleAfterMinutes: number;
  status: OpsStatusFilter;
};

export type OpsDashboardViewModel = {
  scopeLabel: string;
  cards: {
    sent: number;
    failed: number;
    retrying: number;
    skipped: number;
    channelNotConfigured: number;
    scheduledState: ScheduledHealthSummary["healthStatus"];
    scheduledStatus: string;
  };
  scheduled: ScheduledHealthSummary;
  coverage: {
    templatePercent: number;
    preferencePercent: number;
    missingTemplates: Array<{ eventType: string; channel: string }>;
    missingPreferences: Array<{ role: string; eventType: string }>;
  };
  retry: {
    executeRuns: number;
    executeByStatus: Array<[string, number]>;
    blockedReasons: Array<[string, number]>;
    providerErrors: Array<[string, number]>;
    focusedStatusCount: number;
  };
  warnings: string[];
  hasData: boolean;
};

const STATUS_FILTERS: readonly OpsStatusFilter[] = ["all", "failed", "retrying", "skipped"];

export function parseOpsDashboardQuery(params: URLSearchParams, mode: OpsDashboardMode): OpsDashboardQuery {
  const tenantRaw = (params.get("tenantId") || "").trim();
  const tenantId = mode === "platform" && tenantRaw ? tenantRaw : null;

  const limitRaw = Number(params.get("limit") || 500);
  const limit = Number.isFinite(limitRaw) ? Math.min(3000, Math.max(50, Math.floor(limitRaw))) : 500;

  const staleRaw = Number(params.get("staleAfterMinutes") || 1440);
  const staleAfterMinutes = Number.isFinite(staleRaw) ? Math.min(10080, Math.max(1, Math.floor(staleRaw))) : 1440;

  const statusRaw = String(params.get("status") || "all");
  const status = STATUS_FILTERS.includes(statusRaw as OpsStatusFilter) ? (statusRaw as OpsStatusFilter) : "all";

  return {
    tenantId,
    limit,
    staleAfterMinutes,
    status,
  };
}

export function buildOpsDashboardSearchParams(query: OpsDashboardQuery, mode: OpsDashboardMode) {
  const params = new URLSearchParams();
  if (mode === "platform" && query.tenantId) params.set("tenantId", query.tenantId);
  params.set("limit", String(query.limit));
  params.set("staleAfterMinutes", String(query.staleAfterMinutes));
  if (query.status !== "all") params.set("status", query.status);
  return params;
}

function buildOpsApiQueryString(query: OpsDashboardQuery, mode: OpsDashboardMode) {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  params.set("staleAfterMinutes", String(query.staleAfterMinutes));
  if (mode === "platform" && query.tenantId) params.set("tenantId", query.tenantId);
  return params.toString();
}

function getOpsApiBase(mode: OpsDashboardMode) {
  return mode === "platform" ? "/api/platform/notifications/ops" : "/api/manager/notifications/ops";
}

export async function fetchOpsDashboardBundle(params: {
  mode: OpsDashboardMode;
  query: OpsDashboardQuery;
}): Promise<{ ok: true; bundle: OpsDashboardBundle } | { ok: false; message: string }> {
  const base = getOpsApiBase(params.mode);
  const queryString = buildOpsApiQueryString(params.query, params.mode);
  const summaryPath = `${base}/summary?${queryString}`;
  const healthPath = `${base}/health?${queryString}`;
  const coveragePath = `${base}/coverage?${queryString}`;

  const [summaryResult, healthResult, coverageResult] = await Promise.all([
    fetchApiJson<OpsSummaryApiData>(summaryPath, { cache: "no-store" }),
    fetchApiJson<OpsHealthApiData>(healthPath, { cache: "no-store" }),
    fetchApiJson<OpsCoverageApiData>(coveragePath, { cache: "no-store" }),
  ]);

  if (summaryResult.ok === false) return { ok: false, message: summaryResult.message };
  if (healthResult.ok === false) return { ok: false, message: healthResult.message };
  if (coverageResult.ok === false) return { ok: false, message: coverageResult.message };

  const warnings = [summaryResult.data.warning || null, coverageResult.data.warning || null].filter(
    (value): value is string => Boolean(value),
  );

  return {
    ok: true,
    bundle: {
      scope: summaryResult.data.scope,
      tenantId: summaryResult.data.tenantId || null,
      summary: summaryResult.data,
      health: healthResult.data,
      coverage: coverageResult.data,
      warnings,
    },
  };
}

export function getScheduledHealthTone(status: ScheduledHealthSummary["healthStatus"]) {
  if (status === "healthy") return "good";
  if (status === "degraded") return "warn";
  if (status === "stale") return "danger";
  return "muted";
}

export function computeCoveragePercent(covered: number, expected: number) {
  if (!expected || expected <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((covered / expected) * 100)));
}

function toSortedEntries(record: Record<string, number>, take = 10) {
  return Object.entries(record || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, take);
}

export function buildOpsDashboardViewModel(params: {
  bundle: OpsDashboardBundle;
  query: OpsDashboardQuery;
}): OpsDashboardViewModel {
  const { bundle, query } = params;
  const notificationHealth = bundle.health.notificationHealth;
  const scheduled = bundle.health.scheduledHealth;
  const templateCoverage = bundle.coverage.templateCoverage;
  const preferenceCoverage = bundle.coverage.preferenceCoverage;
  const retryOperations = bundle.coverage.retryOperations;
  const templatePercent = computeCoveragePercent(
    templateCoverage.coveredCombinations,
    templateCoverage.expectedCombinations,
  );
  const preferencePercent = computeCoveragePercent(
    preferenceCoverage.configuredRoleEventPairs,
    preferenceCoverage.expectedRoleEventPairs,
  );
  const focusedStatusCount =
    query.status === "all" ? notificationHealth.total : notificationHealth.byStatus[query.status] || 0;

  const latestScheduledStatus = scheduled.latestRun?.status || "no_runs";
  const scopeLabel = bundle.scope === "platform" ? "Global" : bundle.tenantId || "Tenant";
  const hasData =
    notificationHealth.total > 0 ||
    Boolean(scheduled.latestRun) ||
    retryOperations.executeRuns > 0 ||
    templateCoverage.coveredCombinations > 0 ||
    preferenceCoverage.configuredRoleEventPairs > 0;

  return {
    scopeLabel,
    cards: {
      sent: notificationHealth.sent,
      failed: notificationHealth.failed,
      retrying: notificationHealth.retrying,
      skipped: notificationHealth.skipped,
      channelNotConfigured: notificationHealth.channelNotConfigured,
      scheduledState: scheduled.healthStatus,
      scheduledStatus: latestScheduledStatus,
    },
    scheduled,
    coverage: {
      templatePercent,
      preferencePercent,
      missingTemplates: templateCoverage.missing.slice(0, 12),
      missingPreferences: preferenceCoverage.missing.slice(0, 12),
    },
    retry: {
      executeRuns: retryOperations.executeRuns,
      executeByStatus: toSortedEntries(retryOperations.executeByStatus, 6),
      blockedReasons: toSortedEntries(retryOperations.blockedReasons, 8),
      providerErrors: toSortedEntries(notificationHealth.providerErrorCodes, 8),
      focusedStatusCount,
    },
    warnings: bundle.warnings,
    hasData,
  };
}
