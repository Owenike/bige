import { canUseDailyRollupWindow, isUtcDayBoundary } from "./notification-rollup";

export type NotificationAggregationModeRequested = "auto" | "raw" | "rollup";
export type NotificationAggregationDataSource = "raw" | "rollup";

export type NotificationAggregationMetadata = {
  aggregationModeRequested: NotificationAggregationModeRequested;
  aggregationModeResolved: NotificationAggregationDataSource;
  dataSource: NotificationAggregationDataSource;
  isWholeUtcDayWindow: boolean;
  rollupEligible: boolean;
  resolutionReason: string;
  requestedWindowType: NotificationAggregationWindowType;
  snapshotWindowType: NotificationAggregationWindowType;
};

export type NotificationAggregationWindowType = "whole_utc_day" | "partial_utc_window";

export const NOTIFICATION_AGGREGATION_CORE_METADATA_FIELDS = [
  "aggregationModeRequested",
  "aggregationModeResolved",
  "dataSource",
  "isWholeUtcDayWindow",
  "rollupEligible",
] as const;

export const NOTIFICATION_AGGREGATION_EXPLAINABILITY_FIELDS = [
  "resolutionReason",
  "requestedWindowType",
  "snapshotWindowType",
] as const;

export const NOTIFICATION_AGGREGATION_METADATA_FIELDS = [
  ...NOTIFICATION_AGGREGATION_CORE_METADATA_FIELDS,
  ...NOTIFICATION_AGGREGATION_EXPLAINABILITY_FIELDS,
] as const;

export type NotificationAggregationMetadataField = (typeof NOTIFICATION_AGGREGATION_METADATA_FIELDS)[number];

export type NotificationAggregationMetadataPayload = {
  data?: Record<string, unknown> | null;
} & Record<string, unknown>;

export function isWholeUtcDayWindow(fromIso: string, toIso: string) {
  return isUtcDayBoundary(fromIso, "start") && isUtcDayBoundary(toIso, "end");
}

export function getNotificationAggregationWindowType(isWholeWindow: boolean): NotificationAggregationWindowType {
  return isWholeWindow ? "whole_utc_day" : "partial_utc_window";
}

export function buildNotificationAggregationResolutionReason(params: {
  aggregationModeRequested?: NotificationAggregationModeRequested | null;
  dataSource: NotificationAggregationDataSource;
  isWholeUtcDayWindow: boolean;
  rollupEligible: boolean;
  reasonScope?: "default" | "trends";
}) {
  const aggregationModeRequested = params.aggregationModeRequested || "auto";

  if (aggregationModeRequested === "raw") {
    return "aggregationMode=raw was explicitly requested, so raw query aggregation was used.";
  }
  if (aggregationModeRequested === "rollup") {
    return "aggregationMode=rollup was explicitly requested, so daily rollup aggregation was used.";
  }

  if (params.reasonScope === "trends") {
    if (params.dataSource === "rollup") {
      return "aggregationMode=auto resolved to daily rollup aggregation because both current and previous trend windows are whole UTC-day windows.";
    }
    if (params.isWholeUtcDayWindow && !params.rollupEligible) {
      return "aggregationMode=auto fell back to raw query aggregation because trend rollups require both current and previous windows to be whole UTC-day windows.";
    }
    return "aggregationMode=auto fell back to raw query aggregation because the current trend window is not a whole UTC-day window.";
  }

  if (params.dataSource === "rollup") {
    return "aggregationMode=auto resolved to daily rollup aggregation because the requested window is a whole UTC-day window.";
  }
  if (params.isWholeUtcDayWindow && !params.rollupEligible) {
    return "aggregationMode=auto fell back to raw query aggregation because the requested window was not eligible for daily rollup aggregation.";
  }
  return "aggregationMode=auto fell back to raw query aggregation because the requested window is not a whole UTC-day window.";
}

export function buildNotificationAggregationMetadata(params: {
  aggregationModeRequested?: NotificationAggregationModeRequested | null;
  dataSource: NotificationAggregationDataSource;
  isWholeUtcDayWindow: boolean;
  rollupEligible: boolean;
  resolutionReason?: string | null;
  requestedWindowType?: NotificationAggregationWindowType | null;
  snapshotWindowType?: NotificationAggregationWindowType | null;
  reasonScope?: "default" | "trends";
}): NotificationAggregationMetadata {
  const aggregationModeRequested = params.aggregationModeRequested || "auto";
  const requestedWindowType =
    params.requestedWindowType || getNotificationAggregationWindowType(Boolean(params.isWholeUtcDayWindow));
  const snapshotWindowType =
    params.snapshotWindowType || getNotificationAggregationWindowType(Boolean(params.isWholeUtcDayWindow));
  return {
    aggregationModeRequested,
    aggregationModeResolved: params.dataSource,
    dataSource: params.dataSource,
    isWholeUtcDayWindow: Boolean(params.isWholeUtcDayWindow),
    rollupEligible: Boolean(params.rollupEligible),
    resolutionReason:
      params.resolutionReason ||
      buildNotificationAggregationResolutionReason({
        aggregationModeRequested,
        dataSource: params.dataSource,
        isWholeUtcDayWindow: Boolean(params.isWholeUtcDayWindow),
        rollupEligible: Boolean(params.rollupEligible),
        reasonScope: params.reasonScope || "default",
      }),
    requestedWindowType,
    snapshotWindowType,
  };
}

export function pickNotificationAggregationMetadataField(
  payload: NotificationAggregationMetadataPayload | null | undefined,
  field: NotificationAggregationMetadataField,
) {
  if (!payload || typeof payload !== "object") return undefined;
  const data = payload.data && typeof payload.data === "object" ? payload.data : null;
  if (data && Object.prototype.hasOwnProperty.call(data, field)) return data[field];
  return payload[field];
}

export function listMissingNotificationAggregationMetadataFields(
  payload: NotificationAggregationMetadataPayload | null | undefined,
) {
  return NOTIFICATION_AGGREGATION_METADATA_FIELDS.filter(
    (field) => typeof pickNotificationAggregationMetadataField(payload, field) === "undefined",
  );
}

export function getNotificationAggregationMetadata(
  payload: NotificationAggregationMetadataPayload | null | undefined,
): NotificationAggregationMetadata | null {
  const missingFields = listMissingNotificationAggregationMetadataFields(payload);
  if (missingFields.length > 0) return null;
  return {
    aggregationModeRequested: pickNotificationAggregationMetadataField(
      payload,
      "aggregationModeRequested",
    ) as NotificationAggregationModeRequested,
    aggregationModeResolved: pickNotificationAggregationMetadataField(
      payload,
      "aggregationModeResolved",
    ) as NotificationAggregationDataSource,
    dataSource: pickNotificationAggregationMetadataField(payload, "dataSource") as NotificationAggregationDataSource,
    isWholeUtcDayWindow: Boolean(pickNotificationAggregationMetadataField(payload, "isWholeUtcDayWindow")),
    rollupEligible: Boolean(pickNotificationAggregationMetadataField(payload, "rollupEligible")),
    resolutionReason: String(pickNotificationAggregationMetadataField(payload, "resolutionReason") || ""),
    requestedWindowType: pickNotificationAggregationMetadataField(
      payload,
      "requestedWindowType",
    ) as NotificationAggregationWindowType,
    snapshotWindowType: pickNotificationAggregationMetadataField(
      payload,
      "snapshotWindowType",
    ) as NotificationAggregationWindowType,
  };
}

export function describeNotificationAggregationMetadataContractIssues(params: {
  payload: NotificationAggregationMetadataPayload | null | undefined;
  expected?: Partial<NotificationAggregationMetadata>;
}) {
  const issues: string[] = [];
  const missingFields = listMissingNotificationAggregationMetadataFields(params.payload);
  if (missingFields.length > 0) {
    issues.push(`missing fields: ${missingFields.join(", ")}`);
    return issues;
  }

  const metadata = getNotificationAggregationMetadata(params.payload);
  if (!metadata) {
    issues.push("metadata payload unreadable");
    return issues;
  }

  if (metadata.aggregationModeResolved !== metadata.dataSource) {
    issues.push(
      `aggregationModeResolved/dataSource mismatch: ${metadata.aggregationModeResolved} vs ${metadata.dataSource}`,
    );
  }

  for (const field of NOTIFICATION_AGGREGATION_METADATA_FIELDS) {
    const expectedValue = params.expected?.[field];
    if (typeof expectedValue === "undefined") continue;
    if (metadata[field] !== expectedValue) {
      issues.push(`${field} expected ${String(expectedValue)}, got ${String(metadata[field])}`);
    }
  }

  return issues;
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
