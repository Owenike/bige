import { z } from "zod";
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
export type NotificationReadApiName = "overview" | "analytics" | "trends" | "tenant_drilldown";
export type NotificationAggregationContractIssueKind = "missing" | "type_mismatch" | "rule_mismatch" | "fixture_drift";
export type NotificationAggregationContractIssue = {
  kind: NotificationAggregationContractIssueKind;
  path: string;
  message: string;
};
export type NotificationReadApiRegressionFixture = {
  api: NotificationReadApiName;
  scenario: string;
  metadata: NotificationAggregationMetadata;
  snapshot: {
    dataSource: NotificationAggregationDataSource;
    hasDaily: boolean;
    hasByChannel: boolean;
    hasByTenant: boolean;
    hasCurrentWindow: boolean;
    hasPreviousWindow: boolean;
    hasByAnomalyType: boolean;
    hasRecentAnomalies: boolean;
    hasAnomalySummary: boolean;
  };
};

export const notificationAggregationModeRequestedSchema = z.enum(["auto", "raw", "rollup"]);
export const notificationAggregationDataSourceSchema = z.enum(["raw", "rollup"]);
export const notificationAggregationWindowTypeSchema = z.enum(["whole_utc_day", "partial_utc_window"]);

export const notificationAggregationMetadataSchema = z.object({
  aggregationModeRequested: notificationAggregationModeRequestedSchema,
  aggregationModeResolved: notificationAggregationDataSourceSchema,
  dataSource: notificationAggregationDataSourceSchema,
  isWholeUtcDayWindow: z.boolean(),
  rollupEligible: z.boolean(),
  resolutionReason: z.string().min(1),
  requestedWindowType: notificationAggregationWindowTypeSchema,
  snapshotWindowType: notificationAggregationWindowTypeSchema,
});

const notificationReadApiSnapshotBaseSchema = z.object({
  dataSource: notificationAggregationDataSourceSchema,
});

export const notificationReadApiResponseSchemaByApi = {
  overview: z.object({
    snapshot: notificationReadApiSnapshotBaseSchema.extend({
      totalRows: z.number(),
      daily: z.array(z.unknown()),
      byChannel: z.array(z.unknown()),
      byTenant: z.array(z.unknown()),
    }),
  }),
  analytics: z.object({
    snapshot: notificationReadApiSnapshotBaseSchema.extend({
      totalRows: z.number(),
      daily: z.array(z.unknown()),
      byChannel: z.array(z.unknown()),
      byTenant: z.array(z.unknown()),
    }),
  }),
  trends: z.object({
    snapshot: notificationReadApiSnapshotBaseSchema.extend({
      currentWindow: z.object({
        from: z.string(),
        to: z.string(),
        durationMinutes: z.number(),
      }),
      previousWindow: z.object({
        from: z.string(),
        to: z.string(),
        durationMinutes: z.number(),
      }),
      byTenant: z.array(z.unknown()),
      byAnomalyType: z.array(z.unknown()),
      byChannel: z.array(z.unknown()),
    }),
  }),
  tenant_drilldown: z.object({
    snapshot: notificationReadApiSnapshotBaseSchema.extend({
      totalRows: z.number(),
      daily: z.array(z.unknown()),
      byChannel: z.array(z.unknown()),
      recentAnomalies: z.array(z.unknown()),
      anomalySummary: z.object({
        total: z.number(),
        failed: z.number(),
        deadLetter: z.number(),
        retrying: z.number(),
      }),
    }),
  }),
} as const;

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

const NOTIFICATION_AGGREGATION_FIELD_TYPE_HINTS: Record<NotificationAggregationMetadataField, string> = {
  aggregationModeRequested: "auto | raw | rollup",
  aggregationModeResolved: "raw | rollup",
  dataSource: "raw | rollup",
  isWholeUtcDayWindow: "boolean",
  rollupEligible: "boolean",
  resolutionReason: "non-empty string",
  requestedWindowType: "whole_utc_day | partial_utc_window",
  snapshotWindowType: "whole_utc_day | partial_utc_window",
};

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

export function pickNotificationReadApiSnapshot(payload: NotificationAggregationMetadataPayload | null | undefined) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.snapshot && typeof payload.snapshot === "object") return payload.snapshot;
  const data = payload.data && typeof payload.data === "object" ? payload.data : null;
  if (data?.snapshot && typeof data.snapshot === "object") return data.snapshot;
  return null;
}

function extractNotificationAggregationMetadataRecord(
  payload: NotificationAggregationMetadataPayload | null | undefined,
): Record<NotificationAggregationMetadataField, unknown> {
  return Object.fromEntries(
    NOTIFICATION_AGGREGATION_METADATA_FIELDS.map((field) => [field, pickNotificationAggregationMetadataField(payload, field)]),
  ) as Record<NotificationAggregationMetadataField, unknown>;
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
  const parsed = notificationAggregationMetadataSchema.safeParse(extractNotificationAggregationMetadataRecord(payload));
  if (!parsed.success) return null;
  return parsed.data;
}

export function validateNotificationAggregationMetadataSchema(params: {
  payload: NotificationAggregationMetadataPayload | null | undefined;
  expected?: Partial<NotificationAggregationMetadata>;
  mismatchKind?: Extract<NotificationAggregationContractIssueKind, "rule_mismatch" | "fixture_drift">;
}) {
  const issues: NotificationAggregationContractIssue[] = [];
  const missingFields = listMissingNotificationAggregationMetadataFields(params.payload);
  for (const field of missingFields) {
    issues.push({
      kind: "missing",
      path: field,
      message: `${field} missing`,
    });
  }
  if (issues.length > 0) return issues;

  const metadataInput = extractNotificationAggregationMetadataRecord(params.payload);
  const parsed = notificationAggregationMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] || "metadata");
      const knownField = NOTIFICATION_AGGREGATION_METADATA_FIELDS.find((item) => item === field);
      issues.push({
        kind: "type_mismatch",
        path: field,
        message: `${field} expected ${knownField ? NOTIFICATION_AGGREGATION_FIELD_TYPE_HINTS[knownField] : "valid value"}, got ${String(metadataInput[field as NotificationAggregationMetadataField])}`,
      });
    }
    return issues;
  }

  if (parsed.data.aggregationModeResolved !== parsed.data.dataSource) {
    issues.push({
      kind: "rule_mismatch",
      path: "aggregationModeResolved",
      message: `aggregationModeResolved/dataSource mismatch: ${parsed.data.aggregationModeResolved} vs ${parsed.data.dataSource}`,
    });
  }

  const mismatchKind = params.mismatchKind || "rule_mismatch";
  for (const field of NOTIFICATION_AGGREGATION_METADATA_FIELDS) {
    const expectedValue = params.expected?.[field];
    if (typeof expectedValue === "undefined") continue;
    if (parsed.data[field] !== expectedValue) {
      issues.push({
        kind: mismatchKind,
        path: field,
        message: `${field} expected ${String(expectedValue)}, got ${String(parsed.data[field])}`,
      });
    }
  }

  return issues;
}

function appendFixtureDiffs(params: {
  issues: NotificationAggregationContractIssue[];
  actual: unknown;
  expected: unknown;
  path: string[];
}) {
  if (Array.isArray(params.actual) || Array.isArray(params.expected)) {
    if (JSON.stringify(params.actual) !== JSON.stringify(params.expected)) {
      params.issues.push({
        kind: "fixture_drift",
        path: params.path.join("."),
        message: `${params.path.join(".")} expected ${JSON.stringify(params.expected)}, got ${JSON.stringify(params.actual)}`,
      });
    }
    return;
  }

  if (
    params.actual &&
    typeof params.actual === "object" &&
    params.expected &&
    typeof params.expected === "object"
  ) {
    const keys = Array.from(new Set([...Object.keys(params.actual), ...Object.keys(params.expected)])).sort();
    for (const key of keys) {
      appendFixtureDiffs({
        issues: params.issues,
        actual: (params.actual as Record<string, unknown>)[key],
        expected: (params.expected as Record<string, unknown>)[key],
        path: [...params.path, key],
      });
    }
    return;
  }

  if (params.actual !== params.expected) {
    params.issues.push({
      kind: "fixture_drift",
      path: params.path.join("."),
      message: `${params.path.join(".")} expected ${JSON.stringify(params.expected)}, got ${JSON.stringify(params.actual)}`,
    });
  }
}

export function normalizeNotificationReadApiRegressionFixture(params: {
  api: NotificationReadApiName;
  scenario: string;
  payload: NotificationAggregationMetadataPayload | null | undefined;
}) {
  const metadata = getNotificationAggregationMetadata(params.payload);
  const snapshot = pickNotificationReadApiSnapshot(params.payload);
  if (!metadata || !snapshot || typeof snapshot !== "object") return null;
  const snapshotRecord = snapshot as Record<string, unknown>;

  return {
    api: params.api,
    scenario: params.scenario,
    metadata,
    snapshot: {
      dataSource: snapshotRecord.dataSource as NotificationAggregationDataSource,
      hasDaily: Array.isArray(snapshotRecord.daily),
      hasByChannel: Array.isArray(snapshotRecord.byChannel),
      hasByTenant: Array.isArray(snapshotRecord.byTenant),
      hasCurrentWindow: Boolean(snapshotRecord.currentWindow && typeof snapshotRecord.currentWindow === "object"),
      hasPreviousWindow: Boolean(snapshotRecord.previousWindow && typeof snapshotRecord.previousWindow === "object"),
      hasByAnomalyType: Array.isArray(snapshotRecord.byAnomalyType),
      hasRecentAnomalies: Array.isArray(snapshotRecord.recentAnomalies),
      hasAnomalySummary: Boolean(snapshotRecord.anomalySummary && typeof snapshotRecord.anomalySummary === "object"),
    },
  } satisfies NotificationReadApiRegressionFixture;
}

export function validateNotificationReadApiResponseSchema(params: {
  api: NotificationReadApiName;
  scenario: string;
  payload: NotificationAggregationMetadataPayload | null | undefined;
  expectedMetadata?: Partial<NotificationAggregationMetadata>;
  expectedFixture?: NotificationReadApiRegressionFixture;
}) {
  const issues = validateNotificationAggregationMetadataSchema({
    payload: params.payload,
    expected: params.expectedMetadata,
  });

  const snapshot = pickNotificationReadApiSnapshot(params.payload);
  if (!snapshot || typeof snapshot !== "object") {
    issues.push({
      kind: "missing",
      path: "snapshot",
      message: "snapshot missing",
    });
    return issues;
  }

  const metadataInput = extractNotificationAggregationMetadataRecord(params.payload);
  const responseInput = {
    snapshot,
    ...metadataInput,
  };
  const parsed = notificationReadApiResponseSchemaByApi[params.api]
    .merge(notificationAggregationMetadataSchema)
    .safeParse(responseInput);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      issues.push({
        kind: issue.code === "invalid_type" ? "type_mismatch" : "missing",
        path,
        message: `${path} ${issue.message}`,
      });
    }
    return issues;
  }

  if (parsed.data.snapshot.dataSource !== parsed.data.dataSource) {
    issues.push({
      kind: "rule_mismatch",
      path: "snapshot.dataSource",
      message: `snapshot.dataSource expected ${parsed.data.dataSource}, got ${parsed.data.snapshot.dataSource}`,
    });
  }

  const normalizedFixture = normalizeNotificationReadApiRegressionFixture(params);
  if (params.expectedFixture && normalizedFixture) {
    appendFixtureDiffs({
      issues,
      actual: normalizedFixture,
      expected: params.expectedFixture,
      path: ["fixture"],
    });
  }

  return issues;
}

export function describeNotificationAggregationMetadataContractIssues(params: {
  payload: NotificationAggregationMetadataPayload | null | undefined;
  expected?: Partial<NotificationAggregationMetadata>;
}) {
  const issues = validateNotificationAggregationMetadataSchema(params);
  if (issues.some((issue) => issue.kind === "missing")) {
    return [`missing fields: ${issues.filter((issue) => issue.kind === "missing").map((issue) => issue.path).join(", ")}`];
  }
  return issues.map((issue) => issue.message);
}

export function describeNotificationReadApiResponseSchemaIssues(params: {
  api: NotificationReadApiName;
  scenario: string;
  payload: NotificationAggregationMetadataPayload | null | undefined;
  expectedMetadata?: Partial<NotificationAggregationMetadata>;
  expectedFixture?: NotificationReadApiRegressionFixture;
}) {
  return validateNotificationReadApiResponseSchema(params).map((issue) => `${issue.kind}: ${issue.message}`);
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
