"use client";

import type { NotificationReadApiRequestState } from "./notification-read-api-request-state";
import type { NotificationReadApiOrchestrationError } from "./notification-read-api-hooks";

export type NotificationReadApiSurfaceStatus =
  | "idle"
  | "initial_loading"
  | "refreshing"
  | "ready"
  | "ready_stale"
  | "soft_failure_with_data"
  | "hard_failure_no_data"
  | "partial_failure"
  | "cancelled";

export type NotificationReadApiStatusTone = "neutral" | "info" | "warning" | "danger";

export type NotificationReadApiStatusSurface = {
  status: NotificationReadApiSurfaceStatus;
  tone: NotificationReadApiStatusTone;
  message: string;
};

export type NotificationReadApiSurfaceSubject =
  | "overview_page"
  | "overview_primary"
  | "insights_panel"
  | "trends_panel"
  | "tenant_drilldown_page";

function getStatusTone(status: NotificationReadApiSurfaceStatus): NotificationReadApiStatusTone {
  switch (status) {
    case "hard_failure_no_data":
      return "danger";
    case "soft_failure_with_data":
    case "partial_failure":
      return "warning";
    case "refreshing":
    case "ready_stale":
      return "info";
    default:
      return "neutral";
  }
}

function getSubjectLabel(subject: NotificationReadApiSurfaceSubject) {
  switch (subject) {
    case "overview_page":
      return "Overview";
    case "overview_primary":
      return "Overview data";
    case "insights_panel":
      return "Analytics panels";
    case "trends_panel":
      return "Trend panels";
    case "tenant_drilldown_page":
      return "Tenant drilldown";
  }
}

export function resolveNotificationReadApiPageStatus<TData>(
  state: NotificationReadApiRequestState<TData, NotificationReadApiOrchestrationError>,
  options: {
    resourceErrors?: NotificationReadApiOrchestrationError[];
  } = {},
): NotificationReadApiSurfaceStatus {
  const hasData = state.data !== null;
  const hasResourceErrors = (options.resourceErrors?.length ?? 0) > 0;

  if (state.loading && state.isInitialLoading && !hasData) return "initial_loading";
  if (state.errorMode === "hard" && !hasData) return "hard_failure_no_data";
  if (state.errorMode === "soft" && hasData) return "soft_failure_with_data";
  if (state.loading && hasData && state.cacheStatus === "stale") return "ready_stale";
  if (state.loading && hasData) return "refreshing";
  if (hasResourceErrors && hasData) return "partial_failure";
  if (!state.loading && state.lastEvent === "cancelled" && !state.error) return "cancelled";
  if (hasData) return "ready";
  return "idle";
}

export function resolveNotificationReadApiPanelStatus(options: {
  pageStatus: NotificationReadApiSurfaceStatus;
  hasData: boolean;
  issue?: NotificationReadApiOrchestrationError | null;
}): NotificationReadApiSurfaceStatus {
  if (!options.hasData && options.pageStatus === "hard_failure_no_data") {
    return "hard_failure_no_data";
  }

  if (options.issue) {
    return options.hasData ? "soft_failure_with_data" : "partial_failure";
  }

  if (!options.hasData) {
    if (options.pageStatus === "initial_loading") return "initial_loading";
    if (options.pageStatus === "cancelled") return "cancelled";
    return "idle";
  }

  if (options.pageStatus === "ready_stale") return "ready_stale";
  if (options.pageStatus === "refreshing") return "refreshing";
  if (options.pageStatus === "soft_failure_with_data") return "soft_failure_with_data";
  return "ready";
}

export function buildNotificationReadApiStatusSurface(
  status: NotificationReadApiSurfaceStatus,
  subject: NotificationReadApiSurfaceSubject,
  issue?: NotificationReadApiOrchestrationError | null,
): NotificationReadApiStatusSurface {
  const label = getSubjectLabel(subject);

  let message: string;
  switch (status) {
    case "initial_loading":
      message = `${label} is loading for the first time.`;
      break;
    case "refreshing":
      message = `${label} is updating with the current query.`;
      break;
    case "ready_stale":
      message = `${label} is showing cached data while a background refresh is running.`;
      break;
    case "soft_failure_with_data":
      message = `${label} kept the last successful data because the latest refresh failed.${issue ? ` ${issue.source} ${issue.kind}: ${issue.message}` : ""}`;
      break;
    case "hard_failure_no_data":
      message = `${label} could not be loaded and no prior data is available.${issue ? ` ${issue.message}` : ""}`;
      break;
    case "partial_failure":
      message = `${label} is partially unavailable.${issue ? ` ${issue.source} ${issue.kind}: ${issue.message}` : ""}`;
      break;
    case "cancelled":
      message = `${label} update was cancelled before completion.`;
      break;
    case "ready":
      message = `${label} is up to date.`;
      break;
    default:
      message = `${label} is idle.`;
      break;
  }

  return {
    status,
    tone: getStatusTone(status),
    message,
  };
}
