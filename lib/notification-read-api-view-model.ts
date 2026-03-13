import type {
  NotificationAsyncState,
  NotificationOverviewPageData,
  NotificationReadApiOrchestrationError,
  NotificationTenantDrilldownPageData,
} from "./notification-read-api-hooks";
import {
  buildNotificationReadApiStatusSurface,
  resolveNotificationReadApiPageStatus,
  resolveNotificationReadApiPanelStatus,
  type NotificationReadApiSurfaceSubject,
  type NotificationReadApiStatusSurface,
  type NotificationReadApiStatusTone,
  type NotificationReadApiSurfaceStatus,
} from "./notification-read-api-status-model";

export type NotificationReadApiActionKind =
  | "refresh"
  | "retry"
  | "open_drilldown"
  | "back_to_overview"
  | "back_to_platform"
  | "open_ops"
  | "open_alert_workflow";

export type NotificationReadApiActionContract = {
  kind: NotificationReadApiActionKind;
  enabled: boolean;
  busy: boolean;
  label: string;
  href: string | null;
  prefetchKey: string | null;
};

export type NotificationReadApiDisplayPayload = {
  status: NotificationReadApiSurfaceStatus;
  tone: NotificationReadApiStatusTone;
  headline: string;
  assistiveMessage: string;
  errorSummary: string[];
  hasData: boolean;
  isEmpty: boolean;
  emptyMessage: string | null;
};

export type NotificationReadApiPageViewModel = NotificationReadApiDisplayPayload & {
  showStatusNotice: boolean;
};

export type NotificationReadApiPanelViewModel = NotificationReadApiDisplayPayload & {
  key: string;
  title: string;
  subtitle: string;
  hint: string;
  isBlocking: boolean;
};

export type NotificationOverviewDashboardViewModel = {
  page: NotificationReadApiPageViewModel;
  overviewPanel: NotificationReadApiPanelViewModel;
  insightsPriorityPanel: NotificationReadApiPanelViewModel;
  insightsReasonsPanel: NotificationReadApiPanelViewModel;
  trendsPanel: NotificationReadApiPanelViewModel;
  actions: {
    backToPlatform: NotificationReadApiActionContract;
    openOps: NotificationReadApiActionContract;
    openAlertWorkflow: NotificationReadApiActionContract;
    refresh: NotificationReadApiActionContract;
  };
};

export type NotificationTenantDrilldownViewModel = {
  page: NotificationReadApiPageViewModel;
  summaryPanel: NotificationReadApiPanelViewModel;
  actions: {
    backToOverview: NotificationReadApiActionContract;
    refresh: NotificationReadApiActionContract;
  };
};

function formatIssueSummary(issue: NotificationReadApiOrchestrationError | null | undefined) {
  if (!issue) return null;
  return `${issue.source} ${issue.kind}: ${issue.message}`;
}

function buildErrorSummary(issues: Array<NotificationReadApiOrchestrationError | null | undefined>) {
  const summaries = new Set<string>();
  for (const issue of issues) {
    const summary = formatIssueSummary(issue);
    if (summary) summaries.add(summary);
  }
  return Array.from(summaries);
}

function buildHeadline(label: string, status: NotificationReadApiSurfaceStatus) {
  switch (status) {
    case "initial_loading":
      return `${label} loading`;
    case "refreshing":
      return `${label} refreshing`;
    case "ready_stale":
      return `${label} showing cached data`;
    case "soft_failure_with_data":
      return `${label} kept last good data`;
    case "hard_failure_no_data":
      return `${label} unavailable`;
    case "partial_failure":
      return `${label} partially unavailable`;
    case "cancelled":
      return `${label} update cancelled`;
    case "ready":
      return `${label} ready`;
    default:
      return `${label} idle`;
  }
}

function buildDisplayPayload(params: {
  label: string;
  surface: NotificationReadApiStatusSurface;
  errorSummary: string[];
  hasData: boolean;
  isEmpty: boolean;
  emptyMessage: string | null;
}) {
  return {
    status: params.surface.status,
    tone: params.surface.tone,
    headline: buildHeadline(params.label, params.surface.status),
    assistiveMessage: params.surface.message,
    errorSummary: params.errorSummary,
    hasData: params.hasData,
    isEmpty: params.isEmpty,
    emptyMessage: params.emptyMessage,
  };
}

function buildRefreshAction(params: {
  status: NotificationReadApiSurfaceStatus;
  loading: boolean;
}) {
  const isRetry = params.status === "hard_failure_no_data";
  return {
    kind: isRetry ? "retry" : "refresh",
    enabled: !params.loading,
    busy: params.loading,
    label: params.loading ? "Refreshing..." : isRetry ? "Retry" : "Refresh",
    href: null,
    prefetchKey: null,
  } satisfies NotificationReadApiActionContract;
}

function buildNavigationAction(params: {
  kind: Exclude<NotificationReadApiActionKind, "refresh" | "retry">;
  label: string;
  href: string;
  prefetchKey?: string | null;
}) {
  return {
    kind: params.kind,
    enabled: true,
    busy: false,
    label: params.label,
    href: params.href,
    prefetchKey: params.prefetchKey ?? null,
  } satisfies NotificationReadApiActionContract;
}

function buildPanelViewModel(params: {
  key: string;
  title: string;
  subtitle: string;
  label: NotificationReadApiSurfaceSubject;
  status: NotificationReadApiSurfaceStatus;
  issue?: NotificationReadApiOrchestrationError | null;
  hasData: boolean;
  isEmpty: boolean;
  emptyMessage: string | null;
  isBlocking: boolean;
}) {
  const surface = buildNotificationReadApiStatusSurface(params.status, params.label, params.issue ?? null);
  const payload = buildDisplayPayload({
    label: params.title,
    surface,
    errorSummary: buildErrorSummary([params.issue]),
    hasData: params.hasData,
    isEmpty: params.isEmpty,
    emptyMessage: params.emptyMessage,
  });

  return {
    key: params.key,
    title: params.title,
    subtitle: params.subtitle,
    hint: surface.message,
    isBlocking: params.isBlocking,
    ...payload,
  } satisfies NotificationReadApiPanelViewModel;
}

export function buildNotificationOpenTenantDrilldownAction(params: {
  tenantId: string;
  href: string;
  label?: string;
}) {
  return buildNavigationAction({
    kind: "open_drilldown",
    label: params.label ?? "Open Tenant Drilldown",
    href: params.href,
    prefetchKey: params.tenantId,
  });
}

export function buildNotificationOverviewDashboardViewModel(params: {
  request: NotificationAsyncState<NotificationOverviewPageData>;
  backHref: string;
  opsHref: string;
  alertWorkflowHref: string;
}) {
  const data = params.request.data;
  const snapshot = data?.overview.snapshot ?? null;
  const insights = data?.insights ?? null;
  const trend = data?.trends?.snapshot ?? null;
  const resourceErrors = data?.resourceErrors ?? [];
  const insightsIssue = resourceErrors.find((issue) => issue.source === "anomalies") ?? null;
  const trendsIssue = resourceErrors.find((issue) => issue.source === "trends") ?? null;
  const pageStatus = resolveNotificationReadApiPageStatus(params.request, { resourceErrors });
  const pageSurface = buildNotificationReadApiStatusSurface(
    pageStatus,
    "overview_page",
    params.request.error ?? resourceErrors[0] ?? null,
  );
  const hasData = snapshot !== null;
  const isEmpty = Boolean(data?.isEmpty);

  const page = {
    ...buildDisplayPayload({
      label: "Notification overview",
      surface: pageSurface,
      errorSummary: buildErrorSummary([params.request.error, ...resourceErrors]),
      hasData,
      isEmpty,
      emptyMessage: isEmpty ? "No delivery rows in current filter scope." : null,
    }),
    showStatusNotice: pageSurface.status !== "ready" && pageSurface.status !== "idle",
  } satisfies NotificationReadApiPageViewModel;

  return {
    page,
    overviewPanel: buildPanelViewModel({
      key: "overview_primary",
      title: "Overview Summary",
      subtitle: "Aggregated delivery, engagement, and failure metrics for the current filter scope.",
      label: "overview_primary",
      status: resolveNotificationReadApiPanelStatus({
        pageStatus,
        hasData,
        issue: params.request.error,
      }),
      issue: params.request.error,
      hasData,
      isEmpty,
      emptyMessage: isEmpty ? "No delivery rows in current filter scope." : null,
      isBlocking: true,
    }),
    insightsPriorityPanel: buildPanelViewModel({
      key: "insights_priority",
      title: "Tenant Alert Priority",
      subtitle: "Priority-ranked tenants based on anomaly volume, retry pressure, and surge signals.",
      label: "insights_panel",
      status: resolveNotificationReadApiPanelStatus({
        pageStatus,
        hasData: insights !== null,
        issue: insightsIssue,
      }),
      issue: insightsIssue,
      hasData: insights !== null,
      isEmpty: Boolean(insights && insights.tenantPriorities.length === 0),
      emptyMessage: "No tenant alerts.",
      isBlocking: false,
    }),
    insightsReasonsPanel: buildPanelViewModel({
      key: "insights_reasons",
      title: "Top Anomaly Reasons",
      subtitle: "Most common anomaly clusters in the current filter scope.",
      label: "insights_panel",
      status: resolveNotificationReadApiPanelStatus({
        pageStatus,
        hasData: insights !== null,
        issue: insightsIssue,
      }),
      issue: insightsIssue,
      hasData: insights !== null,
      isEmpty: Boolean(insights && insights.reasonClusters.length === 0),
      emptyMessage: "No anomaly reasons.",
      isBlocking: false,
    }),
    trendsPanel: buildPanelViewModel({
      key: "trends",
      title: "Alert Trend Comparison (Current vs Previous Window)",
      subtitle: "Current window versus previous window anomaly movement.",
      label: "trends_panel",
      status: resolveNotificationReadApiPanelStatus({
        pageStatus,
        hasData: trend !== null,
        issue: trendsIssue,
      }),
      issue: trendsIssue,
      hasData: trend !== null,
      isEmpty: Boolean(
        trend &&
          trend.topWorseningTenants.length === 0 &&
          trend.topWorseningAnomalyTypes.length === 0 &&
          trend.topWorseningChannels.length === 0,
      ),
      emptyMessage: "No worsening trends in current window.",
      isBlocking: false,
    }),
    actions: {
      backToPlatform: buildNavigationAction({
        kind: "back_to_platform",
        label: "Back",
        href: params.backHref,
      }),
      openOps: buildNavigationAction({
        kind: "open_ops",
        label: "Notification Ops",
        href: params.opsHref,
      }),
      openAlertWorkflow: buildNavigationAction({
        kind: "open_alert_workflow",
        label: "Alert Workflow",
        href: params.alertWorkflowHref,
      }),
      refresh: buildRefreshAction({
        status: pageStatus,
        loading: params.request.loading,
      }),
    },
  } satisfies NotificationOverviewDashboardViewModel;
}

export function buildNotificationTenantDrilldownViewModel(params: {
  request: NotificationAsyncState<NotificationTenantDrilldownPageData>;
  backHref: string;
}) {
  const data = params.request.data;
  const snapshot = data?.drilldown.snapshot ?? null;
  const pageStatus = resolveNotificationReadApiPageStatus(params.request);
  const pageSurface = buildNotificationReadApiStatusSurface(
    pageStatus,
    "tenant_drilldown_page",
    params.request.error,
  );
  const hasData = snapshot !== null;
  const isEmpty = Boolean(data?.isEmpty);

  return {
    page: {
      ...buildDisplayPayload({
        label: "Tenant drilldown",
        surface: pageSurface,
        errorSummary: buildErrorSummary([params.request.error]),
        hasData,
        isEmpty,
        emptyMessage: isEmpty ? "No tenant delivery rows in current filter scope." : null,
      }),
      showStatusNotice: pageSurface.status !== "ready" && pageSurface.status !== "idle",
    },
    summaryPanel: buildPanelViewModel({
      key: "tenant_drilldown_summary",
      title: "Tenant Drilldown Summary",
      subtitle: "Tenant-scoped delivery, engagement, and anomaly context.",
      label: "tenant_drilldown_page",
      status: resolveNotificationReadApiPanelStatus({
        pageStatus,
        hasData,
        issue: params.request.error,
      }),
      issue: params.request.error,
      hasData,
      isEmpty,
      emptyMessage: isEmpty ? "No tenant delivery rows in current filter scope." : null,
      isBlocking: true,
    }),
    actions: {
      backToOverview: buildNavigationAction({
        kind: "back_to_overview",
        label: "Back To Overview",
        href: params.backHref,
      }),
      refresh: buildRefreshAction({
        status: pageStatus,
        loading: params.request.loading,
      }),
    },
  } satisfies NotificationTenantDrilldownViewModel;
}
