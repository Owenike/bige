"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  NotificationReadApiConsumerError,
  fetchNotificationOverviewReadApi,
  fetchNotificationTenantDrilldownReadApi,
  fetchNotificationTrendsReadApi,
  getTenantDrilldownRecentAnomaliesSupportNote,
  type NotificationOverviewReadModel,
  type NotificationTenantDrilldownReadModel,
  type NotificationTrendsReadModel,
} from "./notification-read-api-client";

type DeliveryChannel = "in_app" | "email" | "line" | "sms" | "webhook" | "other";

const anomalyReasonItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  sample: z.string().nullable(),
  count: z.number(),
  deadLetter: z.number(),
  failed: z.number(),
  retrying: z.number(),
  tenantCount: z.number(),
  channelCount: z.number(),
});

const tenantPriorityItemSchema = z.object({
  tenantId: z.string(),
  priority: z.enum(["P1", "P2", "P3", "P4"]),
  severity: z.enum(["critical", "high", "medium", "low"]),
  score: z.number(),
  deadLetter: z.number(),
  failedRate: z.number(),
  retrying: z.number(),
  anomalyTotal: z.number(),
  recentAnomalies: z.number(),
  previousAnomalies: z.number(),
  surgeRatio: z.number(),
  summary: z.string(),
});

const anomalyInsightsSnapshotSchema = z.object({
  from: z.string(),
  to: z.string(),
  tenantId: z.string().nullable(),
  channel: z.enum(["in_app", "email", "line", "sms", "webhook", "other"]).nullable(),
  totalAnomalies: z.number(),
  reasonClusters: z.array(anomalyReasonItemSchema),
  tenantPriorities: z.array(tenantPriorityItemSchema),
  priorityRule: z.object({
    scoreFormula: z.string(),
    weights: z.object({
      deadLetter: z.number(),
      failed: z.number(),
      retrying: z.number(),
      failedRateBands: z.array(z.object({ threshold: z.number(), bonus: z.number() })),
      surgeBands: z.array(z.object({ condition: z.string(), bonus: z.number() })),
    }),
    severityBands: z.array(
      z.object({
        severity: z.enum(["critical", "high", "medium", "low"]),
        minScore: z.number(),
      }),
    ),
  }),
});

export type NotificationOverviewPageFilters = {
  tenantId: string;
  channel: "" | DeliveryChannel;
  from: string;
  to: string;
  limit: number;
};

export type NotificationTenantDrilldownFilters = {
  channel: "" | DeliveryChannel;
  aggregationMode: "auto" | "raw" | "rollup";
  from: string;
  to: string;
  limit: number;
  anomalyLimit: number;
};

export type NotificationAnomalyInsightsSnapshot = z.infer<typeof anomalyInsightsSnapshotSchema>;

export type NotificationOverviewPageData = {
  overview: NotificationOverviewReadModel;
  insights: NotificationAnomalyInsightsSnapshot;
  trends: NotificationTrendsReadModel;
  isEmpty: boolean;
};

export type NotificationTenantDrilldownPageData = {
  drilldown: NotificationTenantDrilldownReadModel;
  isEmpty: boolean;
  recentAnomaliesSupportNote: string;
};

export type NotificationReadApiOrchestrationSource =
  | "overview"
  | "analytics"
  | "trends"
  | "tenant_drilldown"
  | "anomalies";

export type NotificationReadApiOrchestrationErrorKind = "network" | "api" | "contract" | "empty";

export class NotificationReadApiOrchestrationError extends Error {
  kind: NotificationReadApiOrchestrationErrorKind;
  source: NotificationReadApiOrchestrationSource;
  status: number | null;
  issues: string[];

  constructor(params: {
    kind: NotificationReadApiOrchestrationErrorKind;
    source: NotificationReadApiOrchestrationSource;
    message: string;
    status?: number | null;
    issues?: string[];
  }) {
    super(params.message);
    this.name = "NotificationReadApiOrchestrationError";
    this.kind = params.kind;
    this.source = params.source;
    this.status = typeof params.status === "number" ? params.status : null;
    this.issues = params.issues || [];
  }
}

type OverviewPageLoaderDependencies = {
  fetchOverview?: typeof fetchNotificationOverviewReadApi;
  fetchTrends?: typeof fetchNotificationTrendsReadApi;
  fetchImpl?: typeof fetch;
};

type TenantDrilldownLoaderDependencies = {
  fetchDrilldown?: typeof fetchNotificationTenantDrilldownReadApi;
};

function toIsoDateTime(input: string) {
  const value = String(input || "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function buildBaseOverviewParams(filters: NotificationOverviewPageFilters) {
  const params = new URLSearchParams();
  if (filters.tenantId.trim()) params.set("tenantId", filters.tenantId.trim());
  if (filters.channel) params.set("channel", filters.channel);
  const fromIso = toIsoDateTime(filters.from);
  const toIso = toIsoDateTime(filters.to);
  if (fromIso) params.set("from", fromIso);
  if (toIso) params.set("to", toIso);
  params.set("limit", String(filters.limit));
  return params;
}

function getPayloadErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.errorMessage === "string") return record.errorMessage;
    if (record.error && typeof record.error === "object" && typeof (record.error as Record<string, unknown>).message === "string") {
      return (record.error as Record<string, string>).message;
    }
  }
  return fallback;
}

async function jsonSafe(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function buildSchemaIssues(error: z.ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `snapshot.${issue.path.join(".")}` : "snapshot";
    return `${path} ${issue.message}`;
  });
}

export function buildNotificationOverviewPagePaths(filters: NotificationOverviewPageFilters) {
  const params = buildBaseOverviewParams(filters);
  return {
    overviewPath: `/api/platform/notifications/overview?${params.toString()}&aggregationMode=auto`,
    anomaliesPath: `/api/platform/notifications/anomalies?${params.toString()}`,
    trendsPath: `/api/platform/notifications/trends?${params.toString()}&topLimit=8`,
  };
}

export function buildNotificationTenantDrilldownPath(
  tenantId: string,
  filters: NotificationTenantDrilldownFilters,
) {
  const params = new URLSearchParams();
  if (filters.channel) params.set("channel", filters.channel);
  params.set("aggregationMode", filters.aggregationMode);
  const fromIso = toIsoDateTime(filters.from);
  const toIso = toIsoDateTime(filters.to);
  if (fromIso) params.set("from", fromIso);
  if (toIso) params.set("to", toIso);
  params.set("limit", String(filters.limit));
  params.set("anomalyLimit", String(filters.anomalyLimit));
  return `/api/platform/notifications/overview/tenants/${encodeURIComponent(tenantId)}?${params.toString()}`;
}

export function classifyNotificationReadApiOrchestrationError(
  error: unknown,
  fallback: {
    source: NotificationReadApiOrchestrationSource;
    message: string;
  },
) {
  if (error instanceof NotificationReadApiOrchestrationError) return error;

  if (error instanceof NotificationReadApiConsumerError) {
    return new NotificationReadApiOrchestrationError({
      kind: error.status === null ? "contract" : "api",
      source: error.api,
      status: error.status,
      message: error.message,
      issues: error.issues,
    });
  }

  if (error instanceof TypeError) {
    return new NotificationReadApiOrchestrationError({
      kind: "network",
      source: fallback.source,
      message: `${fallback.source} network request failed: ${error.message}`,
      issues: [error.message],
    });
  }

  if (error instanceof Error) {
    return new NotificationReadApiOrchestrationError({
      kind: "contract",
      source: fallback.source,
      message: error.message || fallback.message,
      issues: [error.message || fallback.message],
    });
  }

  return new NotificationReadApiOrchestrationError({
    kind: "contract",
    source: fallback.source,
    message: fallback.message,
    issues: [fallback.message],
  });
}

export async function fetchNotificationAnomalyInsightsSnapshot(
  input: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetchImpl(input, init);
  } catch (error) {
    throw classifyNotificationReadApiOrchestrationError(error, {
      source: "anomalies",
      message: "Load anomalies failed",
    });
  }

  const payload = await jsonSafe(response);
  if (!response.ok) {
    const message = getPayloadErrorMessage(payload, "Load anomalies failed");
    throw new NotificationReadApiOrchestrationError({
      kind: "api",
      source: "anomalies",
      status: response.status,
      message: `anomalies request failed (${response.status}): ${message}`,
      issues: [message],
    });
  }

  const snapshot =
    payload && typeof payload === "object"
      ? ((payload as Record<string, unknown>).snapshot ??
          ((payload as Record<string, unknown>).data &&
          typeof (payload as Record<string, unknown>).data === "object"
            ? ((payload as Record<string, unknown>).data as Record<string, unknown>).snapshot
            : null))
      : null;

  if (!snapshot || typeof snapshot !== "object") {
    throw new NotificationReadApiOrchestrationError({
      kind: "empty",
      source: "anomalies",
      message: "anomalies payload is empty",
      issues: ["snapshot missing"],
    });
  }

  const parsed = anomalyInsightsSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new NotificationReadApiOrchestrationError({
      kind: "contract",
      source: "anomalies",
      message: `anomalies response contract drift: ${buildSchemaIssues(parsed.error).join("; ")}`,
      issues: buildSchemaIssues(parsed.error),
    });
  }

  return parsed.data;
}

export async function loadNotificationOverviewPageData(
  filters: NotificationOverviewPageFilters,
  dependencies: OverviewPageLoaderDependencies = {},
): Promise<NotificationOverviewPageData> {
  const paths = buildNotificationOverviewPagePaths(filters);
  const fetchOverview = dependencies.fetchOverview ?? fetchNotificationOverviewReadApi;
  const fetchTrends = dependencies.fetchTrends ?? fetchNotificationTrendsReadApi;
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  try {
    const [overview, insights, trends] = await Promise.all([
      fetchOverview(paths.overviewPath, { cache: "no-store" }),
      fetchNotificationAnomalyInsightsSnapshot(paths.anomaliesPath, { cache: "no-store" }, fetchImpl),
      fetchTrends(paths.trendsPath, { cache: "no-store" }),
    ]);

    return {
      overview,
      insights,
      trends,
      isEmpty: overview.snapshot.totalRows === 0,
    };
  } catch (error) {
    throw classifyNotificationReadApiOrchestrationError(error, {
      source: "overview",
      message: "Load overview page failed",
    });
  }
}

export async function loadNotificationTenantDrilldownPageData(
  tenantId: string,
  filters: NotificationTenantDrilldownFilters,
  dependencies: TenantDrilldownLoaderDependencies = {},
): Promise<NotificationTenantDrilldownPageData> {
  const fetchDrilldown = dependencies.fetchDrilldown ?? fetchNotificationTenantDrilldownReadApi;
  const path = buildNotificationTenantDrilldownPath(tenantId, filters);

  try {
    const drilldown = await fetchDrilldown(path, { cache: "no-store" });
    return {
      drilldown,
      isEmpty: drilldown.snapshot.totalRows === 0,
      recentAnomaliesSupportNote: drilldown.recentAnomaliesReason,
    };
  } catch (error) {
    throw classifyNotificationReadApiOrchestrationError(error, {
      source: "tenant_drilldown",
      message: "Load tenant drilldown failed",
    });
  }
}

type NotificationAsyncState<TData> = {
  data: TData | null;
  loading: boolean;
  error: NotificationReadApiOrchestrationError | null;
};

export function useNotificationOverviewPageData(filters: NotificationOverviewPageFilters, refreshKey: number) {
  const [state, setState] = useState<NotificationAsyncState<NotificationOverviewPageData>>({
    data: null,
    loading: true,
    error: null,
  });
  const requestKey = useMemo(() => {
    const paths = buildNotificationOverviewPagePaths(filters);
    return `${paths.overviewPath}|${paths.anomaliesPath}|${paths.trendsPath}|${refreshKey}`;
  }, [filters, refreshKey]);

  useEffect(() => {
    let active = true;
    setState((current) => ({ data: current.data, loading: true, error: null }));
    void loadNotificationOverviewPageData(filters)
      .then((data) => {
        if (!active) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (!active) return;
        const nextError = classifyNotificationReadApiOrchestrationError(error, {
          source: "overview",
          message: "Load overview page failed",
        });
        setState((current) => ({ data: current.data, loading: false, error: nextError }));
      });

    return () => {
      active = false;
    };
  }, [filters, requestKey]);

  return state;
}

export function useNotificationTenantDrilldownPageData(
  tenantId: string,
  filters: NotificationTenantDrilldownFilters,
  refreshKey: number,
) {
  const [state, setState] = useState<NotificationAsyncState<NotificationTenantDrilldownPageData>>({
    data: null,
    loading: true,
    error: null,
  });
  const requestKey = useMemo(
    () => `${buildNotificationTenantDrilldownPath(tenantId, filters)}|${refreshKey}`,
    [tenantId, filters, refreshKey],
  );

  useEffect(() => {
    let active = true;
    setState((current) => ({ data: current.data, loading: true, error: null }));
    void loadNotificationTenantDrilldownPageData(tenantId, filters)
      .then((data) => {
        if (!active) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (!active) return;
        const nextError = classifyNotificationReadApiOrchestrationError(error, {
          source: "tenant_drilldown",
          message: "Load tenant drilldown failed",
        });
        setState((current) => ({ data: current.data, loading: false, error: nextError }));
      });

    return () => {
      active = false;
    };
  }, [tenantId, filters, requestKey]);

  return state;
}

export function getDefaultTenantDrilldownSupportNote() {
  return getTenantDrilldownRecentAnomaliesSupportNote();
}
