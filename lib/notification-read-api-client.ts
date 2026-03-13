import { z } from "zod";
import {
  describeNotificationReadApiResponseSchemaIssues,
  getNotificationAggregationMetadata,
  notificationAggregationDataSourceSchema,
  notificationAggregationMetadataSchema,
  notificationReadApiResponseSchemaByApi,
  pickNotificationReadApiSnapshot,
  type NotificationAggregationMetadata,
  type NotificationReadApiName,
} from "./notification-aggregation-contract";

const deliveryChannelSchema = z.enum(["in_app", "email", "line", "sms", "webhook", "other"]);

const dailyItemSchema = z.object({
  day: z.string(),
  sent: z.number(),
  failed: z.number(),
  deadLetter: z.number(),
  opened: z.number(),
  clicked: z.number(),
  conversion: z.number(),
  total: z.number(),
  successRate: z.number(),
  failRate: z.number(),
});

const channelItemSchema = z.object({
  channel: z.string(),
  total: z.number(),
  sent: z.number(),
  failed: z.number(),
  pending: z.number(),
  retrying: z.number(),
  deadLetter: z.number(),
  opened: z.number(),
  clicked: z.number(),
  conversion: z.number(),
  successRate: z.number(),
  failRate: z.number(),
  openRate: z.number(),
  clickRate: z.number(),
  conversionRate: z.number(),
});

const tenantItemSchema = z.object({
  tenantId: z.string(),
  total: z.number(),
  sent: z.number(),
  failed: z.number(),
  pending: z.number(),
  retrying: z.number(),
  deadLetter: z.number(),
  opened: z.number(),
  clicked: z.number(),
  conversion: z.number(),
  successRate: z.number(),
  failRate: z.number(),
  openRate: z.number(),
  clickRate: z.number(),
  conversionRate: z.number(),
});

const rateDefinitionsSchema = z.object({
  successFailDenominator: z.literal("sent_plus_failed"),
  engagementDenominator: z.literal("sent"),
});

const overviewSnapshotSchema = z.object({
  from: z.string(),
  to: z.string(),
  tenantId: z.string().nullable(),
  channel: deliveryChannelSchema.nullable(),
  dataSource: notificationAggregationDataSourceSchema,
  totalRows: z.number(),
  sent: z.number(),
  failed: z.number(),
  pending: z.number(),
  retrying: z.number(),
  deadLetter: z.number(),
  opened: z.number(),
  clicked: z.number(),
  conversion: z.number(),
  successRate: z.number(),
  failRate: z.number(),
  openRate: z.number(),
  clickRate: z.number(),
  conversionRate: z.number(),
  rateDefinitions: rateDefinitionsSchema,
  daily: z.array(dailyItemSchema),
  byChannel: z.array(channelItemSchema),
  byTenant: z.array(tenantItemSchema),
});

const analyticsSnapshotSchema = overviewSnapshotSchema;

const trendComparisonItemSchema = z.object({
  currentCount: z.number(),
  previousCount: z.number(),
  countDelta: z.number(),
  currentRate: z.number(),
  previousRate: z.number(),
  rateDelta: z.number(),
  direction: z.enum(["up", "flat", "down"]),
});

const trendTenantItemSchema = trendComparisonItemSchema.extend({
  tenantId: z.string(),
});

const trendChannelItemSchema = trendComparisonItemSchema.extend({
  channel: z.string(),
});

const trendAnomalyTypeItemSchema = trendComparisonItemSchema.extend({
  key: z.string(),
  label: z.string(),
  sample: z.string().nullable(),
});

const trendWindowSchema = z.object({
  from: z.string(),
  to: z.string(),
  durationMinutes: z.number(),
  totalDeliveries: z.number(),
  anomalyCount: z.number(),
  anomalyRate: z.number(),
});

const trendsSnapshotSchema = z.object({
  tenantId: z.string().nullable(),
  channel: deliveryChannelSchema.nullable(),
  dataSource: notificationAggregationDataSourceSchema,
  currentWindow: trendWindowSchema,
  previousWindow: trendWindowSchema,
  overall: trendComparisonItemSchema,
  byTenant: z.array(trendTenantItemSchema),
  byAnomalyType: z.array(trendAnomalyTypeItemSchema),
  byChannel: z.array(trendChannelItemSchema),
  topWorseningTenants: z.array(trendTenantItemSchema),
  topWorseningAnomalyTypes: z.array(trendAnomalyTypeItemSchema),
  topWorseningChannels: z.array(trendChannelItemSchema),
  rateDefinitions: z.object({
    anomalyRateDenominator: z.literal("total_deliveries_in_window"),
  }),
});

const anomalyItemSchema = z.object({
  id: z.string(),
  channel: z.string(),
  status: z.string(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  lastError: z.string().nullable(),
  attempts: z.number(),
  retryCount: z.number(),
  maxAttempts: z.number(),
  nextRetryAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
  deadLetterAt: z.string().nullable().optional(),
  occurredAt: z.string(),
});

const tenantDrilldownSnapshotSchema = z.object({
  from: z.string(),
  to: z.string(),
  tenantId: z.string(),
  channel: deliveryChannelSchema.nullable(),
  dataSource: notificationAggregationDataSourceSchema,
  totalRows: z.number(),
  sent: z.number(),
  failed: z.number(),
  pending: z.number(),
  retrying: z.number(),
  deadLetter: z.number(),
  opened: z.number(),
  clicked: z.number(),
  conversion: z.number(),
  successRate: z.number(),
  failRate: z.number(),
  openRate: z.number(),
  clickRate: z.number(),
  conversionRate: z.number(),
  rateDefinitions: rateDefinitionsSchema,
  daily: z.array(dailyItemSchema),
  byChannel: z.array(channelItemSchema),
  recentAnomalies: z.array(anomalyItemSchema),
  anomalySummary: z.object({
    total: z.number(),
    failed: z.number(),
    deadLetter: z.number(),
    retrying: z.number(),
  }),
});

const typedResponseSchemas = {
  overview: notificationReadApiResponseSchemaByApi.overview.extend({
    snapshot: overviewSnapshotSchema,
  }),
  analytics: notificationReadApiResponseSchemaByApi.analytics.extend({
    snapshot: analyticsSnapshotSchema,
  }),
  trends: notificationReadApiResponseSchemaByApi.trends.extend({
    snapshot: trendsSnapshotSchema,
  }),
  tenant_drilldown: notificationReadApiResponseSchemaByApi.tenant_drilldown.extend({
    snapshot: tenantDrilldownSnapshotSchema,
  }),
} as const;

const tenantDrilldownRecentAnomaliesReason =
  "Recent anomalies are always read from raw deliveries for latest error context.";

export type NotificationOverviewReadModel = {
  api: "overview";
  snapshot: z.infer<typeof overviewSnapshotSchema>;
  aggregation: NotificationAggregationMetadata;
};

export type NotificationAnalyticsReadModel = {
  api: "analytics";
  snapshot: z.infer<typeof analyticsSnapshotSchema>;
  aggregation: NotificationAggregationMetadata;
};

export type NotificationTrendsReadModel = {
  api: "trends";
  snapshot: z.infer<typeof trendsSnapshotSchema>;
  aggregation: NotificationAggregationMetadata;
};

export type NotificationTenantDrilldownReadModel = {
  api: "tenant_drilldown";
  snapshot: z.infer<typeof tenantDrilldownSnapshotSchema>;
  aggregation: NotificationAggregationMetadata;
  recentAnomaliesRawBacked: true;
  recentAnomaliesDataSource: "raw";
  recentAnomaliesReason: string;
};

export type NotificationReadApiReadModelByApi = {
  overview: NotificationOverviewReadModel;
  analytics: NotificationAnalyticsReadModel;
  trends: NotificationTrendsReadModel;
  tenant_drilldown: NotificationTenantDrilldownReadModel;
};

export class NotificationReadApiConsumerError extends Error {
  api: NotificationReadApiName;
  issues: string[];
  status: number | null;

  constructor(params: { api: NotificationReadApiName; message: string; issues?: string[]; status?: number | null }) {
    super(params.message);
    this.name = "NotificationReadApiConsumerError";
    this.api = params.api;
    this.issues = params.issues || [];
    this.status = typeof params.status === "number" ? params.status : null;
  }
}

function getErrorMessage(payload: unknown, fallback: string) {
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

export function parseNotificationReadApiPayload<TApi extends NotificationReadApiName>(
  api: TApi,
  payload: unknown,
): NotificationReadApiReadModelByApi[TApi] {
  const issues = describeNotificationReadApiResponseSchemaIssues({
    api,
    scenario: `${api} consumer adapter`,
    payload: payload as Record<string, unknown>,
  });
  if (issues.length > 0) {
    throw new NotificationReadApiConsumerError({
      api,
      message: `${api} response contract drift: ${issues.join("; ")}`,
      issues,
    });
  }

  const aggregation = getNotificationAggregationMetadata(payload as Record<string, unknown>);
  const snapshot = pickNotificationReadApiSnapshot(payload as Record<string, unknown>);
  if (!aggregation || !snapshot || typeof snapshot !== "object") {
    throw new NotificationReadApiConsumerError({
      api,
      message: `${api} response contract drift: metadata or snapshot unreadable`,
      issues: ["metadata or snapshot unreadable"],
    });
  }

  const parsed = typedResponseSchemas[api]
    .merge(notificationAggregationMetadataSchema)
    .parse({ snapshot, ...aggregation });

  if (api === "tenant_drilldown") {
    return {
      api,
      snapshot: parsed.snapshot,
      aggregation,
      recentAnomaliesRawBacked: true,
      recentAnomaliesDataSource: "raw",
      recentAnomaliesReason: tenantDrilldownRecentAnomaliesReason,
    } as NotificationReadApiReadModelByApi[TApi];
  }

  return {
    api,
    snapshot: parsed.snapshot,
    aggregation,
  } as NotificationReadApiReadModelByApi[TApi];
}

export async function fetchNotificationReadApi<TApi extends NotificationReadApiName>(
  api: TApi,
  input: string,
  init?: RequestInit,
): Promise<NotificationReadApiReadModelByApi[TApi]> {
  const response = await fetch(input, init);
  const payload = await jsonSafe(response);
  if (!response.ok) {
    const message = getErrorMessage(payload, `Load ${api} failed`);
    throw new NotificationReadApiConsumerError({
      api,
      status: response.status,
      message: `${api} request failed (${response.status}): ${message}`,
      issues: [message],
    });
  }
  return parseNotificationReadApiPayload(api, payload);
}

export function fetchNotificationOverviewReadApi(input: string, init?: RequestInit) {
  return fetchNotificationReadApi("overview", input, init);
}

export function fetchNotificationAnalyticsReadApi(input: string, init?: RequestInit) {
  return fetchNotificationReadApi("analytics", input, init);
}

export function fetchNotificationTrendsReadApi(input: string, init?: RequestInit) {
  return fetchNotificationReadApi("trends", input, init);
}

export function fetchNotificationTenantDrilldownReadApi(input: string, init?: RequestInit) {
  return fetchNotificationReadApi("tenant_drilldown", input, init);
}

export function getTenantDrilldownRecentAnomaliesSupportNote() {
  return tenantDrilldownRecentAnomaliesReason;
}
