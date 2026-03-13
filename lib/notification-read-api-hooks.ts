"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
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
import {
  serializeNotificationOverviewQueryParams,
  serializeNotificationTenantDrilldownQueryParams,
  type NotificationDeliveryChannel,
  type NotificationOverviewQueryState,
  type NotificationTenantDrilldownQueryState,
} from "./notification-read-api-query-state";
import {
  NotificationReadApiRequestLifecycleController,
  createNotificationReadApiRequestState,
  type NotificationReadApiRequestCause,
  type NotificationReadApiRequestState,
} from "./notification-read-api-request-state";

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
  channel: "" | NotificationDeliveryChannel;
  from: string;
  to: string;
  limit: number;
};

export type NotificationTenantDrilldownFilters = {
  channel: "" | NotificationDeliveryChannel;
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

export type NotificationReadApiOrchestrationErrorKind = "network" | "api" | "contract" | "empty" | "cancelled";

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

type NotificationReadApiLoadOptions = {
  signal?: AbortSignal;
};

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

function isAbortLikeError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return (
    candidate.name === "AbortError" ||
    candidate.code === "ABORT_ERR" ||
    candidate.message === "The operation was aborted." ||
    candidate.message === "This operation was aborted"
  );
}

export function buildNotificationOverviewPagePaths(filters: NotificationOverviewPageFilters) {
  const { params } = serializeNotificationOverviewQueryParams(filters as NotificationOverviewQueryState);
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
  const { params } = serializeNotificationTenantDrilldownQueryParams(filters as NotificationTenantDrilldownQueryState);
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

  if (isAbortLikeError(error)) {
    return new NotificationReadApiOrchestrationError({
      kind: "cancelled",
      source: fallback.source,
      message: `${fallback.source} request was cancelled`,
      issues: ["request aborted"],
    });
  }

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
  options: NotificationReadApiLoadOptions = {},
): Promise<NotificationOverviewPageData> {
  const paths = buildNotificationOverviewPagePaths(filters);
  const fetchOverview = dependencies.fetchOverview ?? fetchNotificationOverviewReadApi;
  const fetchTrends = dependencies.fetchTrends ?? fetchNotificationTrendsReadApi;
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  try {
    const [overview, insights, trends] = await Promise.all([
      fetchOverview(paths.overviewPath, { cache: "no-store", signal: options.signal }),
      fetchNotificationAnomalyInsightsSnapshot(paths.anomaliesPath, { cache: "no-store", signal: options.signal }, fetchImpl),
      fetchTrends(paths.trendsPath, { cache: "no-store", signal: options.signal }),
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
  options: NotificationReadApiLoadOptions = {},
): Promise<NotificationTenantDrilldownPageData> {
  const fetchDrilldown = dependencies.fetchDrilldown ?? fetchNotificationTenantDrilldownReadApi;
  const path = buildNotificationTenantDrilldownPath(tenantId, filters);

  try {
    const drilldown = await fetchDrilldown(path, { cache: "no-store", signal: options.signal });
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

export type NotificationAsyncState<TData> = NotificationReadApiRequestState<
  TData,
  NotificationReadApiOrchestrationError
>;

function isCancelledNotificationReadApiOrchestrationError(error: NotificationReadApiOrchestrationError) {
  return error.kind === "cancelled";
}

function resolveNotificationReadApiRequestCause(
  previous:
    | {
        queryFingerprint: string;
        refreshKey: number;
      }
    | null,
  next: {
    queryFingerprint: string;
    refreshKey: number;
  },
): NotificationReadApiRequestCause {
  if (previous && previous.queryFingerprint === next.queryFingerprint && previous.refreshKey !== next.refreshKey) {
    return "refresh";
  }
  return "query";
}

function useNotificationManagedRequest<TData>(params: {
  queryFingerprint: string;
  refreshKey: number;
  loader: (signal: AbortSignal) => Promise<TData>;
  classifyError: (error: unknown) => NotificationReadApiOrchestrationError;
}) {
  const [state, setState] = useState<NotificationAsyncState<TData>>(() =>
    createNotificationReadApiRequestState<TData, NotificationReadApiOrchestrationError>(null),
  );
  const [controller] = useState(
    () =>
      new NotificationReadApiRequestLifecycleController<TData, NotificationReadApiOrchestrationError>({
        onStateChange: setState,
        classifyError: params.classifyError,
        isCancelledError: isCancelledNotificationReadApiOrchestrationError,
      }),
  );
  const previousRequestRef = useRef<{
    queryFingerprint: string;
    refreshKey: number;
  } | null>(null);
  const loadRequest = useEffectEvent((signal: AbortSignal) => params.loader(signal));

  useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    const requestKey = `${params.queryFingerprint}|refresh:${params.refreshKey}`;
    const cause = resolveNotificationReadApiRequestCause(previousRequestRef.current, {
      queryFingerprint: params.queryFingerprint,
      refreshKey: params.refreshKey,
    });
    previousRequestRef.current = {
      queryFingerprint: params.queryFingerprint,
      refreshKey: params.refreshKey,
    };

    controller.start({
      requestKey,
      cause,
      loader: loadRequest,
    });
  }, [controller, params.queryFingerprint, params.refreshKey]);

  return state;
}

export function useNotificationOverviewPageData(filters: NotificationOverviewPageFilters, refreshKey: number) {
  const paths = useMemo(() => buildNotificationOverviewPagePaths(filters), [filters]);
  const queryFingerprint = useMemo(
    () => `${paths.overviewPath}|${paths.anomaliesPath}|${paths.trendsPath}`,
    [paths.anomaliesPath, paths.overviewPath, paths.trendsPath],
  );

  return useNotificationManagedRequest({
    queryFingerprint,
    refreshKey,
    loader: (signal) => loadNotificationOverviewPageData(filters, {}, { signal }),
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
  });
}

export function useNotificationTenantDrilldownPageData(
  tenantId: string,
  filters: NotificationTenantDrilldownFilters,
  refreshKey: number,
) {
  const queryFingerprint = useMemo(
    () => buildNotificationTenantDrilldownPath(tenantId, filters),
    [tenantId, filters],
  );

  return useNotificationManagedRequest({
    queryFingerprint,
    refreshKey,
    loader: (signal) => loadNotificationTenantDrilldownPageData(tenantId, filters, {}, { signal }),
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
  });
}

export function getDefaultTenantDrilldownSupportNote() {
  return getTenantDrilldownRecentAnomaliesSupportNote();
}
