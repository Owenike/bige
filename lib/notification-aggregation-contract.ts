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

export const NOTIFICATION_AGGREGATION_METADATA_FIELDS = [
  "aggregationModeRequested",
  "aggregationModeResolved",
  "dataSource",
  "isWholeUtcDayWindow",
  "rollupEligible",
] as const;

export type NotificationAggregationMetadataField = (typeof NOTIFICATION_AGGREGATION_METADATA_FIELDS)[number];

export type NotificationAggregationMetadataPayload = {
  data?: Record<string, unknown> | null;
} & Record<string, unknown>;

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
