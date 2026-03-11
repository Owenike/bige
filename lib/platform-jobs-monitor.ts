import { createSupabaseAdminClient } from "./supabase/admin";

type JobType = "notification_sweep" | "opportunity_sweep" | "delivery_dispatch" | "reminder_bundle";
type JobTriggerMode = "scheduled" | "manual" | "api" | "inline";
type JobStatus = "running" | "success" | "failed" | "partial";

type NotificationJobRunRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  job_type: JobType;
  trigger_mode: JobTriggerMode;
  status: JobStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  affected_count: number | null;
  error_count: number | null;
  error_summary: string | null;
  payload: Record<string, unknown> | null;
  initiated_by: string | null;
  created_at: string;
  updated_at: string;
};

type TenantLabelRow = { id: string; name: string | null };
type BranchLabelRow = { id: string; name: string | null };

export type PlatformJobRunsQuery = {
  tenantId: string | null;
  branchId: string | null;
  jobType: JobType | "all";
  triggerMode: JobTriggerMode | "all";
  status: JobStatus | "all";
  search: string | null;
  createdFrom: string | null;
  createdTo: string | null;
  page: number;
  pageSize: number;
};

export type PlatformJobRunItem = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  branchId: string | null;
  branchName: string | null;
  jobType: JobType;
  triggerMode: JobTriggerMode;
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  affectedCount: number;
  errorCount: number;
  errorSummary: string | null;
  payload: Record<string, unknown>;
  initiatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlatformJobRunsListResult = {
  items: PlatformJobRunItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_TYPES = new Set<JobType>(["notification_sweep", "opportunity_sweep", "delivery_dispatch", "reminder_bundle"]);
const TRIGGER_MODES = new Set<JobTriggerMode>(["scheduled", "manual", "api", "inline"]);
const JOB_STATUSES = new Set<JobStatus>(["running", "success", "failed", "partial"]);
const REDACT_KEY_RE = /(secret|token|password|api[_-]?key|authorization|cookie|bearer|private)/i;

function normalizeOptionalUuid(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return UUID_LIKE.test(trimmed) ? trimmed : null;
}

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function parseIsoOrNull(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function sanitizeLikeQuery(value: string) {
  return value.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, max = 600) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...(truncated)`;
}

function sanitizePayloadValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return truncateText(value, 2000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= 5) return `[array:${value.length}]`;
    return value.slice(0, 30).map((item) => sanitizePayloadValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 5) return "[object]";
    const output: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      if (REDACT_KEY_RE.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = sanitizePayloadValue(entryValue, depth + 1);
      }
    }
    return output;
  }
  return String(value);
}

function sanitizePayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const safe = sanitizePayloadValue(payload, 0);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? (safe as Record<string, unknown>) : {};
}

function computeDurationMs(row: Pick<NotificationJobRunRow, "duration_ms" | "started_at" | "finished_at">) {
  if (typeof row.duration_ms === "number" && Number.isFinite(row.duration_ms) && row.duration_ms >= 0) {
    return Math.floor(row.duration_ms);
  }
  if (!row.started_at || !row.finished_at) return null;
  const started = new Date(row.started_at).getTime();
  const finished = new Date(row.finished_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  return finished - started;
}

async function loadLabelMaps(params: { tenantIds: string[]; branchIds: string[] }) {
  const admin = createSupabaseAdminClient();
  const tenantNameById = new Map<string, string>();
  const branchNameById = new Map<string, string>();

  if (params.tenantIds.length > 0) {
    const tenantResult = await admin.from("tenants").select("id, name").in("id", params.tenantIds);
    if (!tenantResult.error) {
      for (const row of (tenantResult.data || []) as TenantLabelRow[]) {
        if (!row.id) continue;
        tenantNameById.set(row.id, row.name || row.id);
      }
    }
  }

  if (params.branchIds.length > 0) {
    const branchResult = await admin.from("branches").select("id, name").in("id", params.branchIds);
    if (!branchResult.error) {
      for (const row of (branchResult.data || []) as BranchLabelRow[]) {
        if (!row.id) continue;
        branchNameById.set(row.id, row.name || row.id);
      }
    }
  }

  return {
    tenantNameById,
    branchNameById,
  };
}

function mapJobRunRow(params: {
  row: NotificationJobRunRow;
  tenantNameById: Map<string, string>;
  branchNameById: Map<string, string>;
}): PlatformJobRunItem {
  return {
    id: params.row.id,
    tenantId: params.row.tenant_id || null,
    tenantName: params.row.tenant_id ? params.tenantNameById.get(params.row.tenant_id) || null : null,
    branchId: params.row.branch_id || null,
    branchName: params.row.branch_id ? params.branchNameById.get(params.row.branch_id) || null : null,
    jobType: params.row.job_type,
    triggerMode: params.row.trigger_mode,
    status: params.row.status,
    startedAt: params.row.started_at || null,
    finishedAt: params.row.finished_at || null,
    durationMs: computeDurationMs(params.row),
    affectedCount: Number(params.row.affected_count || 0),
    errorCount: Number(params.row.error_count || 0),
    errorSummary: params.row.error_summary || null,
    payload: sanitizePayload(params.row.payload),
    initiatedBy: params.row.initiated_by || null,
    createdAt: params.row.created_at,
    updatedAt: params.row.updated_at,
  };
}

export function parsePlatformJobRunsQuery(params: URLSearchParams) {
  const tenantId = normalizeOptionalUuid(params.get("tenantId"));
  const branchId = normalizeOptionalUuid(params.get("branchId"));

  const jobTypeRaw = (params.get("jobType") || "all").trim();
  const jobType = JOB_TYPES.has(jobTypeRaw as JobType) ? (jobTypeRaw as JobType) : "all";

  const triggerModeRaw = (params.get("triggerMode") || "all").trim();
  const triggerMode = TRIGGER_MODES.has(triggerModeRaw as JobTriggerMode) ? (triggerModeRaw as JobTriggerMode) : "all";

  const statusRaw = (params.get("status") || "all").trim();
  const status = JOB_STATUSES.has(statusRaw as JobStatus) ? (statusRaw as JobStatus) : "all";

  const searchRaw = (params.get("search") || "").trim();
  const search = searchRaw ? searchRaw.slice(0, 120) : null;

  const createdFrom = parseIsoOrNull(params.get("from"));
  const createdTo = parseIsoOrNull(params.get("to"));
  if (createdFrom && createdTo && new Date(createdFrom).getTime() > new Date(createdTo).getTime()) {
    return {
      ok: false as const,
      error: "from must be earlier than to",
    };
  }

  const page = parsePositiveInt(params.get("page"), 1, 1, 10000);
  const pageSize = parsePositiveInt(params.get("pageSize"), 30, 10, 200);

  return {
    ok: true as const,
    query: {
      tenantId,
      branchId,
      jobType,
      triggerMode,
      status,
      search,
      createdFrom,
      createdTo,
      page,
      pageSize,
    } as PlatformJobRunsQuery,
  };
}

export async function listPlatformJobRuns(query: PlatformJobRunsQuery): Promise<{ ok: true; data: PlatformJobRunsListResult } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const offset = (query.page - 1) * query.pageSize;
  const to = offset + query.pageSize - 1;

  let dbQuery = admin
    .from("notification_job_runs")
    .select(
      "id, tenant_id, branch_id, job_type, trigger_mode, status, started_at, finished_at, duration_ms, affected_count, error_count, error_summary, payload, initiated_by, created_at, updated_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, to);

  if (query.tenantId) dbQuery = dbQuery.eq("tenant_id", query.tenantId);
  if (query.branchId) dbQuery = dbQuery.eq("branch_id", query.branchId);
  if (query.jobType !== "all") dbQuery = dbQuery.eq("job_type", query.jobType);
  if (query.triggerMode !== "all") dbQuery = dbQuery.eq("trigger_mode", query.triggerMode);
  if (query.status !== "all") dbQuery = dbQuery.eq("status", query.status);
  if (query.createdFrom) dbQuery = dbQuery.gte("created_at", query.createdFrom);
  if (query.createdTo) dbQuery = dbQuery.lte("created_at", query.createdTo);

  if (query.search) {
    const safe = sanitizeLikeQuery(query.search);
    if (safe) {
      const terms = [
        `job_type.ilike.%${safe}%`,
        `trigger_mode.ilike.%${safe}%`,
        `status.ilike.%${safe}%`,
        `error_summary.ilike.%${safe}%`,
      ];
      if (UUID_LIKE.test(safe)) terms.unshift(`id.eq.${safe}`);
      dbQuery = dbQuery.or(terms.join(","));
    }
  }

  const result = await dbQuery;
  if (result.error) return { ok: false, error: result.error.message };

  const rows = (result.data || []) as NotificationJobRunRow[];
  const tenantIds = Array.from(new Set(rows.map((row) => row.tenant_id).filter((id): id is string => Boolean(id))));
  const branchIds = Array.from(new Set(rows.map((row) => row.branch_id).filter((id): id is string => Boolean(id))));
  const labels = await loadLabelMaps({ tenantIds, branchIds });

  const items = rows.map((row) =>
    mapJobRunRow({
      row,
      tenantNameById: labels.tenantNameById,
      branchNameById: labels.branchNameById,
    }),
  );
  const total = Number(result.count || 0);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  return {
    ok: true,
    data: {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages,
    },
  };
}

export async function getPlatformJobRunDetail(input: { id: string }) {
  if (!UUID_LIKE.test(input.id)) {
    return { ok: false as const, code: "invalid_id" as const, error: "job run id must be a valid uuid" };
  }

  const admin = createSupabaseAdminClient();
  const rowResult = await admin
    .from("notification_job_runs")
    .select("id, tenant_id, branch_id, job_type, trigger_mode, status, started_at, finished_at, duration_ms, affected_count, error_count, error_summary, payload, initiated_by, created_at, updated_at")
    .eq("id", input.id)
    .maybeSingle();

  if (rowResult.error) return { ok: false as const, code: "query_failed" as const, error: rowResult.error.message };
  if (!rowResult.data) return { ok: false as const, code: "not_found" as const, error: "job run not found" };

  const row = rowResult.data as NotificationJobRunRow;
  const labels = await loadLabelMaps({
    tenantIds: row.tenant_id ? [row.tenant_id] : [],
    branchIds: row.branch_id ? [row.branch_id] : [],
  });

  let relatedQuery = admin
    .from("notification_job_runs")
    .select("id, tenant_id, branch_id, job_type, trigger_mode, status, started_at, finished_at, duration_ms, affected_count, error_count, error_summary, payload, initiated_by, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (row.tenant_id) relatedQuery = relatedQuery.eq("tenant_id", row.tenant_id);
  else relatedQuery = relatedQuery.is("tenant_id", null);

  const relatedResult = await relatedQuery;
  const relatedRows = relatedResult.error ? [] : ((relatedResult.data || []) as NotificationJobRunRow[]);
  const related = relatedRows
    .filter((item) => item.id !== row.id)
    .slice(0, 10)
    .map((item) =>
      mapJobRunRow({
        row: item,
        tenantNameById: labels.tenantNameById,
        branchNameById: labels.branchNameById,
      }),
    );

  return {
    ok: true as const,
    data: {
      item: mapJobRunRow({
        row,
        tenantNameById: labels.tenantNameById,
        branchNameById: labels.branchNameById,
      }),
      related,
    },
  };
}

