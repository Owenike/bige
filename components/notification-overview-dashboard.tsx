"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatNotificationAggregationDataSourceLabel } from "../lib/notification-aggregation-contract";
import {
  prefetchNotificationTenantDrilldownFromOverviewState,
  useNotificationOverviewPageData,
  type NotificationOverviewPageData,
} from "../lib/notification-read-api-hooks";
import {
  buildNotificationReadApiStatusSurface,
  resolveNotificationReadApiPageStatus,
  resolveNotificationReadApiPanelStatus,
} from "../lib/notification-read-api-status-model";
import { useNotificationOverviewUrlSync } from "../lib/notification-read-api-url-state";
import type { NotificationDeliveryChannel, NotificationOverviewQueryState } from "../lib/notification-read-api-query-state";
import NotificationGovernanceNav from "./notification-governance-nav";

type OverviewSnapshot = NotificationOverviewPageData["overview"]["snapshot"];

type TrendDirection = "up" | "flat" | "down";
type FilterState = NotificationOverviewQueryState;

function toCount(value: number | null | undefined) {
  return Number(value || 0).toLocaleString();
}

function toPercent(value: number | null | undefined) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function trendDirectionLabel(direction: TrendDirection) {
  if (direction === "up") return "up";
  if (direction === "down") return "down";
  return "flat";
}

function buildAlertWorkflowHref(snapshot: OverviewSnapshot, tenantId?: string) {
  const params = new URLSearchParams();
  params.set("from", snapshot.from);
  params.set("to", snapshot.to);
  params.set("statuses", "open,acknowledged,investigating");
  params.set("limit", "120");
  if (tenantId) params.set("tenantId", tenantId);
  return `/platform-admin/notifications-alerts?${params.toString()}`;
}

export default function NotificationOverviewDashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { filters, draft, setDraft, applyDraft, resetFilters, buildTenantDrilldownHref } = useNotificationOverviewUrlSync();
  const overviewRequest = useNotificationOverviewPageData(filters, refreshKey);
  const { data, loading } = overviewRequest;
  const snapshot = data?.overview.snapshot ?? null;
  const insights = data?.insights ?? null;
  const trend = data?.trends?.snapshot ?? null;
  const resourceErrors = data?.resourceErrors ?? [];
  const insightsIssue = resourceErrors.find((issue) => issue.source === "anomalies") ?? null;
  const trendsIssue = resourceErrors.find((issue) => issue.source === "trends") ?? null;
  const pageStatus = resolveNotificationReadApiPageStatus(overviewRequest, { resourceErrors });
  const pageSurface = buildNotificationReadApiStatusSurface(
    pageStatus,
    "overview_page",
    overviewRequest.error ?? resourceErrors[0] ?? null,
  );
  const overviewSurface = buildNotificationReadApiStatusSurface(
    resolveNotificationReadApiPanelStatus({
      pageStatus,
      hasData: snapshot !== null,
      issue: overviewRequest.error,
    }),
    "overview_primary",
    overviewRequest.error,
  );
  const insightsSurface = buildNotificationReadApiStatusSurface(
    resolveNotificationReadApiPanelStatus({
      pageStatus,
      hasData: insights !== null,
      issue: insightsIssue,
    }),
    "insights_panel",
    insightsIssue,
  );
  const trendsSurface = buildNotificationReadApiStatusSurface(
    resolveNotificationReadApiPanelStatus({
      pageStatus,
      hasData: trend !== null,
      issue: trendsIssue,
    }),
    "trends_panel",
    trendsIssue,
  );
  const showPageStatus = pageSurface.status !== "ready" && pageSurface.status !== "idle";

  const hasData = useMemo(() => Boolean(snapshot && snapshot.totalRows > 0), [snapshot]);
  const warmTenantDrilldown = (tenantId: string) => {
    void prefetchNotificationTenantDrilldownFromOverviewState(tenantId, filters);
  };
  const buildTenantDrilldownLinkProps = (tenantId: string) => ({
    href: buildTenantDrilldownHref(tenantId),
    onMouseEnter: () => warmTenantDrilldown(tenantId),
    onFocus: () => warmTenantDrilldown(tenantId),
    onPointerDown: () => warmTenantDrilldown(tenantId),
  });

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">PLATFORM OVERVIEW</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Notification Performance Overview
            </h1>
            <p className="fdGlassText">Daily delivery outcomes, engagement events, channel/tenant slices.</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/platform-admin">
                Back
              </Link>
              <Link className="fdPillBtn" href="/platform-admin/notifications-ops">
                Notification Ops
              </Link>
              <Link className="fdPillBtn" href={snapshot ? buildAlertWorkflowHref(snapshot) : "/platform-admin/notifications-alerts"}>
                Alert Workflow
              </Link>
              <button type="button" className="fdPillBtn" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}>
                {pageStatus === "hard_failure_no_data" ? "Retry" : loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </section>

        <NotificationGovernanceNav mode="platform" />

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Filters</h2>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input
              className="input"
              value={draft.tenantId}
              onChange={(event) => setDraft((prev) => ({ ...prev, tenantId: event.target.value }))}
              placeholder="tenantId (blank = all)"
            />
            <select
              className="input"
              value={draft.channel}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, channel: event.target.value as "" | NotificationDeliveryChannel }))
              }
            >
              <option value="">channel: all</option>
              <option value="in_app">in_app</option>
              <option value="email">email</option>
              <option value="line">line</option>
              <option value="sms">sms</option>
              <option value="webhook">webhook</option>
              <option value="other">other</option>
            </select>
            <select
              className="input"
              value={String(draft.limit)}
              onChange={(event) => setDraft((prev) => ({ ...prev, limit: Number(event.target.value || 2000) }))}
            >
              <option value="500">sample 500</option>
              <option value="1000">sample 1000</option>
              <option value="2000">sample 2000</option>
              <option value="5000">sample 5000</option>
              <option value="10000">sample 10000</option>
            </select>
          </div>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input
              className="input"
              type="datetime-local"
              value={draft.from}
              onChange={(event) => setDraft((prev) => ({ ...prev, from: event.target.value }))}
            />
            <input
              className="input"
              type="datetime-local"
              value={draft.to}
              onChange={(event) => setDraft((prev) => ({ ...prev, to: event.target.value }))}
            />
            <div className="actions">
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={applyDraft}>
                Apply
              </button>
              <button type="button" className="fdPillBtn" onClick={resetFilters}>
                Reset
              </button>
            </div>
          </div>
        </section>

        {showPageStatus || resourceErrors.length > 0 ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className={pageSurface.tone === "danger" ? "error" : "sub"} style={{ marginTop: 0 }}>
              {pageSurface.message}
            </p>
            {resourceErrors.map((issue) => (
              <p key={`${issue.source}:${issue.kind}:${issue.message}`} className="sub" style={{ marginTop: 8 }}>
                {issue.source} {issue.kind}: {issue.message}
              </p>
            ))}
          </section>
        ) : null}

        {overviewRequest.isInitialLoading ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading notification performance overview...</p>
          </section>
        ) : null}

        {snapshot ? (
          <>
            <section className="fdInventorySummary" style={{ marginBottom: 14 }}>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Rows</div>
                <strong className="fdInventorySummaryValue">{toCount(snapshot.totalRows)}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Sent</div>
                <strong className="fdInventorySummaryValue">{toCount(snapshot.sent)}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Failed</div>
                <strong className="fdInventorySummaryValue">{toCount(snapshot.failed)}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Dead Letter</div>
                <strong className="fdInventorySummaryValue">{toCount(snapshot.deadLetter)}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Success Rate</div>
                <strong className="fdInventorySummaryValue">{toPercent(snapshot.successRate)}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Fail Rate</div>
                <strong className="fdInventorySummaryValue">{toPercent(snapshot.failRate)}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Opened</div>
                <strong className="fdInventorySummaryValue">{toCount(snapshot.opened)}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Clicked / Conversion</div>
                <strong className="fdInventorySummaryValue">
                  {toCount(snapshot.clicked)} / {toCount(snapshot.conversion)}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Open / Click / Conversion Rate</div>
                <strong className="fdInventorySummaryValue">
                  {toPercent(snapshot.openRate)} / {toPercent(snapshot.clickRate)} / {toPercent(snapshot.conversionRate)}
                </strong>
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                {overviewSurface.message}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Rate definition: success/fail denominator = sent + failed; open/click/conversion denominator = sent.
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {formatNotificationAggregationDataSourceLabel(snapshot.dataSource)}
              </p>
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Tenant Alert Priority</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  {insightsSurface.message}
                </p>
                {insights ? (
                  <>
                    <p className="sub" style={{ marginTop: 0 }}>
                      Rule: {insights.priorityRule.scoreFormula}
                    </p>
                    <div className="fdDataGrid" style={{ marginTop: 8 }}>
                      {insights.tenantPriorities.map((item) => (
                        <div key={item.tenantId} className="fdGlassSubPanel" style={{ padding: 10 }}>
                          <p className="sub" style={{ marginTop: 0 }}>
                            [{item.priority}/{item.severity}] score {item.score} - {item.tenantId}
                          </p>
                          <p className="sub" style={{ marginTop: 0 }}>
                            {item.summary}
                          </p>
                          <div className="actions" style={{ marginTop: 6 }}>
                            <Link className="fdPillBtn" {...buildTenantDrilldownLinkProps(item.tenantId)}>
                              Open Tenant Drilldown
                            </Link>
                            <Link className="fdPillBtn" href={buildAlertWorkflowHref(snapshot, item.tenantId)}>
                              Open Alert Workflow
                            </Link>
                          </div>
                        </div>
                      ))}
                      {insights.tenantPriorities.length === 0 ? <p className="fdGlassText">No tenant alerts.</p> : null}
                    </div>
                  </>
                ) : (
                  <p className="fdGlassText">Analytics panel is temporarily unavailable.</p>
                )}
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Top Anomaly Reasons</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  {insightsSurface.message}
                </p>
                {insights ? (
                  <div className="fdDataGrid" style={{ marginTop: 8 }}>
                    {insights.reasonClusters.map((item) => (
                      <p key={item.key} className="sub" style={{ marginTop: 0 }}>
                        {item.label}: {item.count} (dead_letter {item.deadLetter}, failed {item.failed}, retrying {item.retrying}) |
                        tenants {item.tenantCount} | channels {item.channelCount}
                        {item.sample ? ` | sample: ${item.sample}` : ""}
                      </p>
                    ))}
                    {insights.reasonClusters.length === 0 ? <p className="fdGlassText">No anomaly reasons.</p> : null}
                  </div>
                ) : (
                  <p className="fdGlassText">Anomaly insights are temporarily unavailable.</p>
                )}
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
                <h2 className="sectionTitle">Alert Trend Comparison (Current vs Previous Window)</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  {trendsSurface.message}
                </p>
                {trend ? (
                  <>
                    <p className="sub" style={{ marginTop: 0 }}>
                      Current {new Date(trend.currentWindow.from).toLocaleString()} ~ {new Date(trend.currentWindow.to).toLocaleString()} vs Previous{" "}
                      {new Date(trend.previousWindow.from).toLocaleString()} ~ {new Date(trend.previousWindow.to).toLocaleString()}
                    </p>
                    <p className="sub" style={{ marginTop: 0 }}>
                      Overall anomalies: current {toCount(trend.currentWindow.anomalyCount)} / previous {toCount(trend.previousWindow.anomalyCount)} | delta{" "}
                      {trend.overall.countDelta >= 0 ? "+" : ""}
                      {toCount(trend.overall.countDelta)} | rate delta {trend.overall.rateDelta >= 0 ? "+" : ""}
                      {toPercent(trend.overall.rateDelta)} ({trendDirectionLabel(trend.overall.direction)})
                    </p>
                    <p className="sub" style={{ marginTop: 0 }}>
                      Rate definition: anomaly rate denominator = total deliveries in each window.
                    </p>

                    <section className="fdTwoCol" style={{ marginTop: 10 }}>
                      <section className="fdGlassSubPanel" style={{ padding: 12 }}>
                        <h3 className="sectionTitle">Top Worsening Tenants</h3>
                        <div className="fdDataGrid" style={{ marginTop: 8 }}>
                          {trend.topWorseningTenants.map((item) => (
                            <div key={`trend-tenant-${item.tenantId}`} className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <p className="sub" style={{ marginTop: 0 }}>
                                {item.tenantId}: {toCount(item.previousCount)} {"->"} {toCount(item.currentCount)} (delta{" "}
                                {item.countDelta >= 0 ? "+" : ""}
                                {toCount(item.countDelta)}, rate delta {item.rateDelta >= 0 ? "+" : ""}
                                {toPercent(item.rateDelta)})
                              </p>
                              <div className="actions" style={{ marginTop: 6 }}>
                                <Link className="fdPillBtn" {...buildTenantDrilldownLinkProps(item.tenantId)}>
                                  Open Tenant Drilldown
                                </Link>
                                <Link className="fdPillBtn" href={buildAlertWorkflowHref(snapshot, item.tenantId)}>
                                  Open Alert Workflow
                                </Link>
                              </div>
                            </div>
                          ))}
                          {trend.topWorseningTenants.length === 0 ? <p className="fdGlassText">No worsening tenants in current window.</p> : null}
                        </div>
                      </section>

                      <section className="fdGlassSubPanel" style={{ padding: 12 }}>
                        <h3 className="sectionTitle">Top Worsening Anomaly Types</h3>
                        <div className="fdDataGrid" style={{ marginTop: 8 }}>
                          {trend.topWorseningAnomalyTypes.map((item) => (
                            <p key={`trend-type-${item.key}`} className="sub" style={{ marginTop: 0 }}>
                              {item.label}: {toCount(item.previousCount)} {"->"} {toCount(item.currentCount)} (delta {item.countDelta >= 0 ? "+" : ""}
                              {toCount(item.countDelta)}, rate delta {item.rateDelta >= 0 ? "+" : ""}
                              {toPercent(item.rateDelta)}){item.sample ? ` | sample: ${item.sample}` : ""}
                            </p>
                          ))}
                          {trend.topWorseningAnomalyTypes.length === 0 ? <p className="fdGlassText">No worsening anomaly types.</p> : null}
                        </div>
                        <h3 className="sectionTitle" style={{ marginTop: 12 }}>
                          Worsening Channels
                        </h3>
                        <div className="fdDataGrid" style={{ marginTop: 8 }}>
                          {trend.topWorseningChannels.map((item) => (
                            <p key={`trend-channel-${item.channel}`} className="sub" style={{ marginTop: 0 }}>
                              {item.channel}: {toCount(item.previousCount)} {"->"} {toCount(item.currentCount)} (delta{" "}
                              {item.countDelta >= 0 ? "+" : ""}
                              {toCount(item.countDelta)}, rate delta {item.rateDelta >= 0 ? "+" : ""}
                              {toPercent(item.rateDelta)})
                            </p>
                          ))}
                          {trend.topWorseningChannels.length === 0 ? <p className="fdGlassText">No worsening channels.</p> : null}
                        </div>
                      </section>
                    </section>
                  </>
                ) : (
                  <p className="fdGlassText">Trend comparison is temporarily unavailable.</p>
                )}
              </section>

            {!hasData ? (
              <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
                <p className="fdGlassText">No delivery rows in current filter scope.</p>
              </section>
            ) : null}

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">By Channel</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {snapshot.byChannel.map((row) => (
                    <p key={row.channel} className="sub" style={{ marginTop: 0 }}>
                      {row.channel}: sent {row.sent}, failed {row.failed} (dead_letter {row.deadLetter}), opened {row.opened},
                      clicked {row.clicked}, conversion {row.conversion}
                    </p>
                  ))}
                  {snapshot.byChannel.length === 0 ? <p className="fdGlassText">No channel stats.</p> : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">By Tenant</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {snapshot.byTenant.map((row) => (
                    <div key={row.tenantId} className="fdGlassSubPanel" style={{ padding: 10 }}>
                      <p className="sub" style={{ marginTop: 0 }}>
                        {row.tenantId}: sent {row.sent}, failed {row.failed} (dead_letter {row.deadLetter}), opened {row.opened},
                        clicked {row.clicked}, conversion {row.conversion}
                      </p>
                      <div className="actions" style={{ marginTop: 6 }}>
                        <Link className="fdPillBtn" {...buildTenantDrilldownLinkProps(row.tenantId)}>
                          Drilldown
                        </Link>
                      </div>
                    </div>
                  ))}
                  {snapshot.byTenant.length === 0 ? <p className="fdGlassText">No tenant stats.</p> : null}
                </div>
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">Daily Trend</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {snapshot.daily.map((row) => (
                  <p key={row.day} className="sub" style={{ marginTop: 0 }}>
                    {row.day}: sent {row.sent}, failed {row.failed}, dead_letter {row.deadLetter}, opened {row.opened}, clicked{" "}
                    {row.clicked}, conversion {row.conversion}, success {toPercent(row.successRate)}
                  </p>
                ))}
                {snapshot.daily.length === 0 ? <p className="fdGlassText">No daily stats.</p> : null}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
