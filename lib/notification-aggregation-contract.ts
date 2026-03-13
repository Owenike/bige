import { canUseDailyRollupWindow, isUtcDayBoundary } from "./notification-rollup";

export type NotificationAggregationModeRequested = "auto" | "raw" | "rollup";
export type NotificationAggregationDataSource = "raw" | "rollup";

export type NotificationAggregationMetadata = {
  aggregationModeRequested: NotificationAggregationModeRequested;
  aggregationModeResolved: NotificationAggregationDataSource;
  dataSource: NotificationAggregationDataSource;
  isWholeUtcDayWindow: boolean;
  rollupEligible: boolean;
};

export function isWholeUtcDayWindow(fromIso: string, toIso: string) {
  return isUtcDayBoundary(fromIso, "start") && isUtcDayBoundary(toIso, "end");
}

export function buildNotificationAggregationMetadata(params: {
  aggregationModeRequested?: NotificationAggregationModeRequested | null;
  dataSource: NotificationAggregationDataSource;
  isWholeUtcDayWindow: boolean;
  rollupEligible: boolean;
}): NotificationAggregationMetadata {
  const aggregationModeRequested = params.aggregationModeRequested || "auto";
  return {
    aggregationModeRequested,
    aggregationModeResolved: params.dataSource,
    dataSource: params.dataSource,
    isWholeUtcDayWindow: Boolean(params.isWholeUtcDayWindow),
    rollupEligible: Boolean(params.rollupEligible),
  };
}

export function buildTrendRollupEligibilityMetadata(params: {
  currentFromIso: string;
  currentToIso: string;
  previousFromIso: string;
  previousToIso: string;
}) {
  const isWholeCurrentWindow = isWholeUtcDayWindow(params.currentFromIso, params.currentToIso);
  const rollupEligible = canUseDailyRollupWindow({
    currentFromIso: params.currentFromIso,
    currentToIso: params.currentToIso,
    previousFromIso: params.previousFromIso,
    previousToIso: params.previousToIso,
  });
  return {
    isWholeUtcDayWindow: isWholeCurrentWindow,
    rollupEligible,
  };
}

export function formatNotificationAggregationDataSourceLabel(dataSource: NotificationAggregationDataSource) {
  if (dataSource === "rollup") return "Aggregation source: daily rollup aggregation.";
  return "Aggregation source: raw query aggregation.";
}
