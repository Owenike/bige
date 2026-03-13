import type {
  NotificationOverviewPageData,
  NotificationTenantDrilldownPageData,
} from "./notification-read-api-hooks";
import { formatNotificationAggregationDataSourceLabel } from "./notification-aggregation-contract";
import {
  buildNotificationOpenTenantDrilldownAction,
  type NotificationOverviewDashboardViewModel,
  type NotificationReadApiActionContract,
  type NotificationReadApiPanelViewModel,
  type NotificationTenantDrilldownViewModel,
} from "./notification-read-api-view-model";

type NotificationReadApiDescriptorBase<TPayload> = NotificationReadApiPanelViewModel & {
  payload: TPayload;
  actions: NotificationReadApiActionContract[];
  visible: boolean;
  stale: boolean;
  hasError: boolean;
};

export type NotificationReadApiMetricCardDescriptor = {
  key: string;
  label: string;
  value: string;
};

export type NotificationReadApiLinkActionDescriptor = NotificationReadApiActionContract & {
  href: string;
};

export type NotificationOverviewTenantPriorityDescriptor = {
  key: string;
  tenantId: string;
  summary: string;
  priority: string;
  severity: string;
  score: number;
  actions: NotificationReadApiLinkActionDescriptor[];
};

export type NotificationOverviewTrendTenantDescriptor = {
  key: string;
  tenantId: string;
  summary: string;
  actions: NotificationReadApiLinkActionDescriptor[];
};

export type NotificationReadApiTextItemDescriptor = {
  key: string;
  text: string;
};

export type NotificationOverviewPanelDescriptor =
  | NotificationReadApiDescriptorBase<{
      kind: "overview_summary";
      aggregationSourceLabel: string | null;
    }>
  | NotificationReadApiDescriptorBase<{
      kind: "insights_priority";
      rule: string | null;
      items: NotificationOverviewTenantPriorityDescriptor[];
    }>
  | NotificationReadApiDescriptorBase<{
      kind: "insights_reasons";
      items: NotificationReadApiTextItemDescriptor[];
    }>
  | NotificationReadApiDescriptorBase<{
      kind: "trend_comparison";
      windowSummary: string | null;
      overallSummary: string | null;
      worseningTenants: NotificationOverviewTrendTenantDescriptor[];
      worseningAnomalyTypes: NotificationReadApiTextItemDescriptor[];
      worseningChannels: NotificationReadApiTextItemDescriptor[];
    }>
  | NotificationReadApiDescriptorBase<{
      kind: "by_channel";
      rows: NotificationReadApiTextItemDescriptor[];
    }>
  | NotificationReadApiDescriptorBase<{
      kind: "by_tenant";
      rows: Array<{
        key: string;
        text: string;
        actions: NotificationReadApiLinkActionDescriptor[];
      }>;
    }>
  | NotificationReadApiDescriptorBase<{
      kind: "daily";
      rows: NotificationReadApiTextItemDescriptor[];
    }>;

export type NotificationOverviewSummaryPanelDescriptor = Extract<
  NotificationOverviewPanelDescriptor,
  { payload: { kind: "overview_summary" } }
>;

export type NotificationOverviewInsightsPriorityPanelDescriptor = Extract<
  NotificationOverviewPanelDescriptor,
  { payload: { kind: "insights_priority" } }
>;

export type NotificationOverviewInsightsReasonsPanelDescriptor = Extract<
  NotificationOverviewPanelDescriptor,
  { payload: { kind: "insights_reasons" } }
>;

export type NotificationOverviewTrendsPanelDescriptor = Extract<
  NotificationOverviewPanelDescriptor,
  { payload: { kind: "trend_comparison" } }
>;

export type NotificationOverviewByChannelPanelDescriptor = Extract<
  NotificationOverviewPanelDescriptor,
  { payload: { kind: "by_channel" } }
>;

export type NotificationOverviewByTenantPanelDescriptor = Extract<
  NotificationOverviewPanelDescriptor,
  { payload: { kind: "by_tenant" } }
>;

export type NotificationOverviewDailyPanelDescriptor = Extract<
  NotificationOverviewPanelDescriptor,
  { payload: { kind: "daily" } }
>;

export type NotificationTenantDrilldownSectionDescriptor =
  | NotificationReadApiDescriptorBase<{
      kind: "tenant_summary";
      aggregationSourceLabel: string | null;
      supportNote: string;
    }>
  | NotificationReadApiDescriptorBase<{
      kind: "tenant_by_channel";
      rows: NotificationReadApiTextItemDescriptor[];
    }>
  | NotificationReadApiDescriptorBase<{
      kind: "tenant_daily";
      rows: NotificationReadApiTextItemDescriptor[];
    }>
  | NotificationReadApiDescriptorBase<{
      kind: "tenant_recent_anomalies";
      rows: NotificationReadApiTextItemDescriptor[];
      supportNote: string;
    }>;

export type NotificationTenantSummarySectionDescriptor = Extract<
  NotificationTenantDrilldownSectionDescriptor,
  { payload: { kind: "tenant_summary" } }
>;

export type NotificationTenantByChannelSectionDescriptor = Extract<
  NotificationTenantDrilldownSectionDescriptor,
  { payload: { kind: "tenant_by_channel" } }
>;

export type NotificationTenantDailySectionDescriptor = Extract<
  NotificationTenantDrilldownSectionDescriptor,
  { payload: { kind: "tenant_daily" } }
>;

export type NotificationTenantRecentAnomaliesSectionDescriptor = Extract<
  NotificationTenantDrilldownSectionDescriptor,
  { payload: { kind: "tenant_recent_anomalies" } }
>;

function asLinkAction(action: NotificationReadApiActionContract): NotificationReadApiLinkActionDescriptor | null {
  if (!action.href) return null;
  return {
    ...action,
    href: action.href,
  };
}

function buildPanelDescriptor<TPayload>(
  panel: NotificationReadApiPanelViewModel,
  payload: TPayload,
  actions: NotificationReadApiActionContract[] = [],
): NotificationReadApiDescriptorBase<TPayload> {
  return {
    ...panel,
    payload,
    actions,
    visible: true,
    stale: panel.status === "ready_stale",
    hasError:
      panel.status === "partial_failure" ||
      panel.status === "soft_failure_with_data" ||
      panel.status === "hard_failure_no_data",
  };
}

export function buildNotificationOverviewMetricCardDescriptors(
  snapshot: NotificationOverviewPageData["overview"]["snapshot"] | null,
  formatters: {
    toCount: (value: number | null | undefined) => string;
    toPercent: (value: number | null | undefined) => string;
  },
) {
  if (!snapshot) return [] satisfies NotificationReadApiMetricCardDescriptor[];

  return [
    { key: "rows", label: "Rows", value: formatters.toCount(snapshot.totalRows) },
    { key: "sent", label: "Sent", value: formatters.toCount(snapshot.sent) },
    { key: "failed", label: "Failed", value: formatters.toCount(snapshot.failed) },
    { key: "dead_letter", label: "Dead Letter", value: formatters.toCount(snapshot.deadLetter) },
    { key: "success_rate", label: "Success Rate", value: formatters.toPercent(snapshot.successRate) },
    { key: "fail_rate", label: "Fail Rate", value: formatters.toPercent(snapshot.failRate) },
    { key: "opened", label: "Opened", value: formatters.toCount(snapshot.opened) },
    {
      key: "clicked_conversion",
      label: "Clicked / Conversion",
      value: `${formatters.toCount(snapshot.clicked)} / ${formatters.toCount(snapshot.conversion)}`,
    },
    {
      key: "open_click_conversion_rate",
      label: "Open / Click / Conversion Rate",
      value: `${formatters.toPercent(snapshot.openRate)} / ${formatters.toPercent(snapshot.clickRate)} / ${formatters.toPercent(snapshot.conversionRate)}`,
    },
  ] satisfies NotificationReadApiMetricCardDescriptor[];
}

export function buildNotificationOverviewPanelDescriptors(params: {
  viewModel: NotificationOverviewDashboardViewModel;
  data: NotificationOverviewPageData | null;
  buildAlertWorkflowHref: (tenantId?: string) => string;
  buildTenantDrilldownHref: (tenantId: string) => string;
  formatters: {
    toCount: (value: number | null | undefined) => string;
    toPercent: (value: number | null | undefined) => string;
    trendDirectionLabel: (value: "up" | "flat" | "down") => string;
  };
}) {
  const snapshot = params.data?.overview.snapshot ?? null;
  const insights = params.data?.insights ?? null;
  const trend = params.data?.trends?.snapshot ?? null;

  const overviewPanel = buildPanelDescriptor(params.viewModel.overviewPanel, {
    kind: "overview_summary" as const,
    aggregationSourceLabel: snapshot ? formatNotificationAggregationDataSourceLabel(snapshot.dataSource) : null,
  });

  const insightsPriorityPanel = buildPanelDescriptor(params.viewModel.insightsPriorityPanel, {
    kind: "insights_priority" as const,
    rule: insights?.priorityRule.scoreFormula ?? null,
    items:
      insights?.tenantPriorities.map((item) => {
        const drilldownAction = asLinkAction(
          buildNotificationOpenTenantDrilldownAction({
            tenantId: item.tenantId,
            href: params.buildTenantDrilldownHref(item.tenantId),
          }),
        );
        const alertWorkflowAction = asLinkAction({
          kind: "open_alert_workflow",
          enabled: true,
          busy: false,
          label: "Open Alert Workflow",
          href: params.buildAlertWorkflowHref(item.tenantId),
          prefetchKey: null,
        });

        return {
          key: item.tenantId,
          tenantId: item.tenantId,
          summary: item.summary,
          priority: item.priority,
          severity: item.severity,
          score: item.score,
          actions: [drilldownAction, alertWorkflowAction].filter(
            (action): action is NotificationReadApiLinkActionDescriptor => action !== null,
          ),
        };
      }) ?? [],
  });

  const insightsReasonsPanel = buildPanelDescriptor(params.viewModel.insightsReasonsPanel, {
    kind: "insights_reasons" as const,
    items:
      insights?.reasonClusters.map((item) => ({
        key: item.key,
        text: `${item.label}: ${item.count} (dead_letter ${item.deadLetter}, failed ${item.failed}, retrying ${item.retrying}) | tenants ${item.tenantCount} | channels ${item.channelCount}${item.sample ? ` | sample: ${item.sample}` : ""}`,
      })) ?? [],
  });

  const trendsPanel = buildPanelDescriptor(params.viewModel.trendsPanel, {
    kind: "trend_comparison" as const,
    windowSummary: trend
      ? `Current ${new Date(trend.currentWindow.from).toLocaleString()} ~ ${new Date(trend.currentWindow.to).toLocaleString()} vs Previous ${new Date(trend.previousWindow.from).toLocaleString()} ~ ${new Date(trend.previousWindow.to).toLocaleString()}`
      : null,
    overallSummary: trend
      ? `Overall anomalies: current ${params.formatters.toCount(trend.currentWindow.anomalyCount)} / previous ${params.formatters.toCount(trend.previousWindow.anomalyCount)} | delta ${trend.overall.countDelta >= 0 ? "+" : ""}${params.formatters.toCount(trend.overall.countDelta)} | rate delta ${trend.overall.rateDelta >= 0 ? "+" : ""}${params.formatters.toPercent(trend.overall.rateDelta)} (${params.formatters.trendDirectionLabel(trend.overall.direction)})`
      : null,
    worseningTenants:
      trend?.topWorseningTenants.map((item) => {
        const drilldownAction = asLinkAction(
          buildNotificationOpenTenantDrilldownAction({
            tenantId: item.tenantId,
            href: params.buildTenantDrilldownHref(item.tenantId),
          }),
        );
        const alertWorkflowAction = asLinkAction({
          kind: "open_alert_workflow",
          enabled: true,
          busy: false,
          label: "Open Alert Workflow",
          href: params.buildAlertWorkflowHref(item.tenantId),
          prefetchKey: null,
        });

        return {
          key: `trend-tenant-${item.tenantId}`,
          tenantId: item.tenantId,
          summary: `${item.tenantId}: ${params.formatters.toCount(item.previousCount)} -> ${params.formatters.toCount(item.currentCount)} (delta ${item.countDelta >= 0 ? "+" : ""}${params.formatters.toCount(item.countDelta)}, rate delta ${item.rateDelta >= 0 ? "+" : ""}${params.formatters.toPercent(item.rateDelta)})`,
          actions: [drilldownAction, alertWorkflowAction].filter(
            (action): action is NotificationReadApiLinkActionDescriptor => action !== null,
          ),
        };
      }) ?? [],
    worseningAnomalyTypes:
      trend?.topWorseningAnomalyTypes.map((item) => ({
        key: `trend-type-${item.key}`,
        text: `${item.label}: ${params.formatters.toCount(item.previousCount)} -> ${params.formatters.toCount(item.currentCount)} (delta ${item.countDelta >= 0 ? "+" : ""}${params.formatters.toCount(item.countDelta)}, rate delta ${item.rateDelta >= 0 ? "+" : ""}${params.formatters.toPercent(item.rateDelta)})${item.sample ? ` | sample: ${item.sample}` : ""}`,
      })) ?? [],
    worseningChannels:
      trend?.topWorseningChannels.map((item) => ({
        key: `trend-channel-${item.channel}`,
        text: `${item.channel}: ${params.formatters.toCount(item.previousCount)} -> ${params.formatters.toCount(item.currentCount)} (delta ${item.countDelta >= 0 ? "+" : ""}${params.formatters.toCount(item.countDelta)}, rate delta ${item.rateDelta >= 0 ? "+" : ""}${params.formatters.toPercent(item.rateDelta)})`,
      })) ?? [],
  });

  const byChannelPanel = buildPanelDescriptor(
    {
      ...params.viewModel.overviewPanel,
      key: "by_channel",
      title: "By Channel",
      subtitle: "Channel-scoped delivery outcomes.",
      hint: "Channel-scoped delivery outcomes.",
      emptyMessage: "No channel stats.",
    },
    {
      kind: "by_channel" as const,
      rows:
        snapshot?.byChannel.map((row) => ({
          key: row.channel,
          text: `${row.channel}: sent ${row.sent}, failed ${row.failed} (dead_letter ${row.deadLetter}), opened ${row.opened}, clicked ${row.clicked}, conversion ${row.conversion}`,
        })) ?? [],
    },
  );

  const byTenantPanel = buildPanelDescriptor(
    {
      ...params.viewModel.overviewPanel,
      key: "by_tenant",
      title: "By Tenant",
      subtitle: "Tenant-scoped delivery outcomes.",
      hint: "Tenant-scoped delivery outcomes.",
      emptyMessage: "No tenant stats.",
    },
    {
      kind: "by_tenant" as const,
      rows:
        snapshot?.byTenant.map((row) => {
          const drilldownAction = asLinkAction(
            buildNotificationOpenTenantDrilldownAction({
              tenantId: row.tenantId,
              href: params.buildTenantDrilldownHref(row.tenantId),
              label: "Drilldown",
            }),
          );
          return {
            key: row.tenantId,
            text: `${row.tenantId}: sent ${row.sent}, failed ${row.failed} (dead_letter ${row.deadLetter}), opened ${row.opened}, clicked ${row.clicked}, conversion ${row.conversion}`,
            actions: drilldownAction ? [drilldownAction] : [],
          };
        }) ?? [],
    },
  );

  const dailyPanel = buildPanelDescriptor(
    {
      ...params.viewModel.overviewPanel,
      key: "daily",
      title: "Daily Trend",
      subtitle: "Daily breakdown for the current filter scope.",
      hint: "Daily breakdown for the current filter scope.",
      emptyMessage: "No daily stats.",
    },
    {
      kind: "daily" as const,
      rows:
        snapshot?.daily.map((row) => ({
          key: row.day,
          text: `${row.day}: sent ${row.sent}, failed ${row.failed}, dead_letter ${row.deadLetter}, opened ${row.opened}, clicked ${row.clicked}, conversion ${row.conversion}, success ${params.formatters.toPercent(row.successRate)}`,
        })) ?? [],
    },
  );

  return {
    overviewPanel,
    nonBlockingPanels: [insightsPriorityPanel, insightsReasonsPanel, trendsPanel],
    supportingPanels: [byChannelPanel, byTenantPanel, dailyPanel],
  } satisfies {
    overviewPanel: NotificationOverviewSummaryPanelDescriptor;
    nonBlockingPanels: readonly [
      NotificationOverviewInsightsPriorityPanelDescriptor,
      NotificationOverviewInsightsReasonsPanelDescriptor,
      NotificationOverviewTrendsPanelDescriptor,
    ];
    supportingPanels: readonly [
      NotificationOverviewByChannelPanelDescriptor,
      NotificationOverviewByTenantPanelDescriptor,
      NotificationOverviewDailyPanelDescriptor,
    ];
  };
}

export function buildNotificationTenantDrilldownMetricCardDescriptors(
  snapshot: NotificationTenantDrilldownPageData["drilldown"]["snapshot"] | null,
  formatters: {
    toCount: (value: number | null | undefined) => string;
    toPercent: (value: number | null | undefined) => string;
  },
) {
  if (!snapshot) return [] satisfies NotificationReadApiMetricCardDescriptor[];

  return [
    { key: "rows", label: "Rows", value: formatters.toCount(snapshot.totalRows) },
    {
      key: "sent_failed_dead_letter",
      label: "Sent / Failed / Dead Letter",
      value: `${formatters.toCount(snapshot.sent)} / ${formatters.toCount(snapshot.failed)} / ${formatters.toCount(snapshot.deadLetter)}`,
    },
    {
      key: "opened_clicked_conversion",
      label: "Opened / Clicked / Conversion",
      value: `${formatters.toCount(snapshot.opened)} / ${formatters.toCount(snapshot.clicked)} / ${formatters.toCount(snapshot.conversion)}`,
    },
    {
      key: "success_fail_rate",
      label: "Success / Fail Rate",
      value: `${formatters.toPercent(snapshot.successRate)} / ${formatters.toPercent(snapshot.failRate)}`,
    },
    {
      key: "open_click_conversion_rate",
      label: "Open / Click / Conversion Rate",
      value: `${formatters.toPercent(snapshot.openRate)} / ${formatters.toPercent(snapshot.clickRate)} / ${formatters.toPercent(snapshot.conversionRate)}`,
    },
    {
      key: "anomaly_summary",
      label: "Anomalies (failed / dead_letter / retrying)",
      value: `${formatters.toCount(snapshot.anomalySummary.total)} (${formatters.toCount(snapshot.anomalySummary.failed)} / ${formatters.toCount(snapshot.anomalySummary.deadLetter)} / ${formatters.toCount(snapshot.anomalySummary.retrying)})`,
    },
  ] satisfies NotificationReadApiMetricCardDescriptor[];
}

export function buildNotificationTenantDrilldownSectionDescriptors(params: {
  viewModel: NotificationTenantDrilldownViewModel;
  data: NotificationTenantDrilldownPageData | null;
  recentAnomaliesSupportNote: string;
}) {
  const snapshot = params.data?.drilldown.snapshot ?? null;

  return {
    summarySection: buildPanelDescriptor(params.viewModel.summaryPanel, {
      kind: "tenant_summary" as const,
      aggregationSourceLabel: snapshot ? formatNotificationAggregationDataSourceLabel(snapshot.dataSource) : null,
      supportNote: params.recentAnomaliesSupportNote,
    }),
    sections: [
      buildPanelDescriptor(
        {
          ...params.viewModel.summaryPanel,
          key: "tenant_by_channel",
          title: "Channel Breakdown",
          subtitle: "Tenant-scoped channel delivery outcomes.",
          hint: "Tenant-scoped channel delivery outcomes.",
          emptyMessage: "No channel data.",
        },
        {
          kind: "tenant_by_channel" as const,
          rows:
            snapshot?.byChannel.map((row) => ({
              key: row.channel,
              text: `${row.channel}: sent ${row.sent}, failed ${row.failed} (dead_letter ${row.deadLetter}), opened ${row.opened}, clicked ${row.clicked}, conversion ${row.conversion}`,
            })) ?? [],
        },
      ),
      buildPanelDescriptor(
        {
          ...params.viewModel.summaryPanel,
          key: "tenant_daily",
          title: "Daily Trend",
          subtitle: "Tenant-scoped daily delivery outcomes.",
          hint: "Tenant-scoped daily delivery outcomes.",
          emptyMessage: "No daily trend data.",
        },
        {
          kind: "tenant_daily" as const,
          rows:
            snapshot?.daily.map((row) => ({
              key: row.day,
              text: `${row.day}: sent ${row.sent}, failed ${row.failed}, dead_letter ${row.deadLetter}, opened ${row.opened}, clicked ${row.clicked}, conversion ${row.conversion}`,
            })) ?? [],
        },
      ),
      buildPanelDescriptor(
        {
          ...params.viewModel.summaryPanel,
          key: "tenant_recent_anomalies",
          title: "Recent Anomalies",
          subtitle: "Raw-backed anomaly list for latest retry and error context.",
          hint: "Raw-backed anomaly list for latest retry and error context.",
          emptyMessage: "No anomalies in current scope.",
        },
        {
          kind: "tenant_recent_anomalies" as const,
          rows:
            snapshot?.recentAnomalies.map((row) => ({
              key: row.id,
              text: `[${row.status}] ${row.channel} - ${row.errorCode || "NO_CODE"} - ${row.lastError || row.errorMessage || "-"} (retry ${row.retryCount}/${row.maxAttempts}, occurred ${new Date(row.occurredAt).toLocaleString()})`,
            })) ?? [],
          supportNote: params.recentAnomaliesSupportNote,
        },
      ),
    ],
  } satisfies {
    summarySection: NotificationTenantSummarySectionDescriptor;
    sections: readonly [
      NotificationTenantByChannelSectionDescriptor,
      NotificationTenantDailySectionDescriptor,
      NotificationTenantRecentAnomaliesSectionDescriptor,
    ];
  };
}
