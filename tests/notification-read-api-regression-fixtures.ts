import {
  buildNotificationAggregationMetadata,
  type NotificationAggregationMetadataPayload,
  type NotificationReadApiRegressionFixture,
} from "../lib/notification-aggregation-contract";

function buildPayload(params: {
  snapshot: Record<string, unknown>;
  metadata: ReturnType<typeof buildNotificationAggregationMetadata>;
}): NotificationAggregationMetadataPayload {
  return {
    ok: true,
    data: {
      snapshot: params.snapshot,
      ...params.metadata,
    },
    snapshot: params.snapshot,
    ...params.metadata,
  };
}

const overviewAutoNonDayMetadata = buildNotificationAggregationMetadata({
  aggregationModeRequested: "auto",
  dataSource: "raw",
  isWholeUtcDayWindow: false,
  rollupEligible: false,
});

const overviewAutoWholeDayMetadata = buildNotificationAggregationMetadata({
  aggregationModeRequested: "auto",
  dataSource: "rollup",
  isWholeUtcDayWindow: true,
  rollupEligible: true,
});

const analyticsAutoWholeDayMetadata = buildNotificationAggregationMetadata({
  aggregationModeRequested: "auto",
  dataSource: "rollup",
  isWholeUtcDayWindow: true,
  rollupEligible: true,
});

const trendsAutoNonDayMetadata = buildNotificationAggregationMetadata({
  aggregationModeRequested: "auto",
  dataSource: "raw",
  isWholeUtcDayWindow: false,
  rollupEligible: false,
  reasonScope: "trends",
});

const tenantAutoNonDayMetadata = buildNotificationAggregationMetadata({
  aggregationModeRequested: "auto",
  dataSource: "raw",
  isWholeUtcDayWindow: false,
  rollupEligible: false,
});

const tenantAutoWholeDayMetadata = buildNotificationAggregationMetadata({
  aggregationModeRequested: "auto",
  dataSource: "rollup",
  isWholeUtcDayWindow: true,
  rollupEligible: true,
});

export const NOTIFICATION_READ_API_REGRESSION_CASES: Array<{
  api: NotificationReadApiRegressionFixture["api"];
  scenario: string;
  payload: NotificationAggregationMetadataPayload;
  expectedMetadata: ReturnType<typeof buildNotificationAggregationMetadata>;
  expectedFixture: NotificationReadApiRegressionFixture;
}> = [
  {
    api: "overview",
    scenario: "overview_auto_non_day",
    payload: buildPayload({
      snapshot: {
        dataSource: "raw",
        totalRows: 0,
        daily: [],
        byChannel: [],
        byTenant: [],
      },
      metadata: overviewAutoNonDayMetadata,
    }),
    expectedMetadata: overviewAutoNonDayMetadata,
    expectedFixture: {
      api: "overview",
      scenario: "overview_auto_non_day",
      metadata: overviewAutoNonDayMetadata,
      snapshot: {
        dataSource: "raw",
        hasDaily: true,
        hasByChannel: true,
        hasByTenant: true,
        hasCurrentWindow: false,
        hasPreviousWindow: false,
        hasByAnomalyType: false,
        hasRecentAnomalies: false,
        hasAnomalySummary: false,
      },
    },
  },
  {
    api: "overview",
    scenario: "overview_auto_whole_day",
    payload: buildPayload({
      snapshot: {
        dataSource: "rollup",
        totalRows: 0,
        daily: [],
        byChannel: [],
        byTenant: [],
      },
      metadata: overviewAutoWholeDayMetadata,
    }),
    expectedMetadata: overviewAutoWholeDayMetadata,
    expectedFixture: {
      api: "overview",
      scenario: "overview_auto_whole_day",
      metadata: overviewAutoWholeDayMetadata,
      snapshot: {
        dataSource: "rollup",
        hasDaily: true,
        hasByChannel: true,
        hasByTenant: true,
        hasCurrentWindow: false,
        hasPreviousWindow: false,
        hasByAnomalyType: false,
        hasRecentAnomalies: false,
        hasAnomalySummary: false,
      },
    },
  },
  {
    api: "analytics",
    scenario: "analytics_auto_whole_day",
    payload: buildPayload({
      snapshot: {
        dataSource: "rollup",
        totalRows: 0,
        daily: [],
        byChannel: [],
        byTenant: [],
      },
      metadata: analyticsAutoWholeDayMetadata,
    }),
    expectedMetadata: analyticsAutoWholeDayMetadata,
    expectedFixture: {
      api: "analytics",
      scenario: "analytics_auto_whole_day",
      metadata: analyticsAutoWholeDayMetadata,
      snapshot: {
        dataSource: "rollup",
        hasDaily: true,
        hasByChannel: true,
        hasByTenant: true,
        hasCurrentWindow: false,
        hasPreviousWindow: false,
        hasByAnomalyType: false,
        hasRecentAnomalies: false,
        hasAnomalySummary: false,
      },
    },
  },
  {
    api: "trends",
    scenario: "trends_auto_non_day",
    payload: buildPayload({
      snapshot: {
        dataSource: "raw",
        currentWindow: {
          from: "2026-03-10T08:00:00.000Z",
          to: "2026-03-10T20:00:00.000Z",
          durationMinutes: 720,
        },
        previousWindow: {
          from: "2026-03-09T08:00:00.000Z",
          to: "2026-03-09T20:00:00.000Z",
          durationMinutes: 720,
        },
        byTenant: [],
        byAnomalyType: [],
        byChannel: [],
      },
      metadata: trendsAutoNonDayMetadata,
    }),
    expectedMetadata: trendsAutoNonDayMetadata,
    expectedFixture: {
      api: "trends",
      scenario: "trends_auto_non_day",
      metadata: trendsAutoNonDayMetadata,
      snapshot: {
        dataSource: "raw",
        hasDaily: false,
        hasByChannel: true,
        hasByTenant: true,
        hasCurrentWindow: true,
        hasPreviousWindow: true,
        hasByAnomalyType: true,
        hasRecentAnomalies: false,
        hasAnomalySummary: false,
      },
    },
  },
  {
    api: "tenant_drilldown",
    scenario: "tenant_drilldown_auto_non_day",
    payload: buildPayload({
      snapshot: {
        dataSource: "raw",
        totalRows: 0,
        daily: [],
        byChannel: [],
        recentAnomalies: [],
        anomalySummary: {
          total: 0,
          failed: 0,
          deadLetter: 0,
          retrying: 0,
        },
      },
      metadata: tenantAutoNonDayMetadata,
    }),
    expectedMetadata: tenantAutoNonDayMetadata,
    expectedFixture: {
      api: "tenant_drilldown",
      scenario: "tenant_drilldown_auto_non_day",
      metadata: tenantAutoNonDayMetadata,
      snapshot: {
        dataSource: "raw",
        hasDaily: true,
        hasByChannel: true,
        hasByTenant: false,
        hasCurrentWindow: false,
        hasPreviousWindow: false,
        hasByAnomalyType: false,
        hasRecentAnomalies: true,
        hasAnomalySummary: true,
      },
    },
  },
  {
    api: "tenant_drilldown",
    scenario: "tenant_drilldown_auto_whole_day",
    payload: buildPayload({
      snapshot: {
        dataSource: "rollup",
        totalRows: 0,
        daily: [],
        byChannel: [],
        recentAnomalies: [],
        anomalySummary: {
          total: 0,
          failed: 0,
          deadLetter: 0,
          retrying: 0,
        },
      },
      metadata: tenantAutoWholeDayMetadata,
    }),
    expectedMetadata: tenantAutoWholeDayMetadata,
    expectedFixture: {
      api: "tenant_drilldown",
      scenario: "tenant_drilldown_auto_whole_day",
      metadata: tenantAutoWholeDayMetadata,
      snapshot: {
        dataSource: "rollup",
        hasDaily: true,
        hasByChannel: true,
        hasByTenant: false,
        hasCurrentWindow: false,
        hasPreviousWindow: false,
        hasByAnomalyType: false,
        hasRecentAnomalies: true,
        hasAnomalySummary: true,
      },
    },
  },
];
