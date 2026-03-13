"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type FocusEvent, type MouseEvent, type PointerEvent } from "react";
import {
  prefetchNotificationTenantDrilldownFromOverviewState,
  useNotificationOverviewPageData,
  type NotificationOverviewPageData,
} from "../lib/notification-read-api-hooks";
import {
  buildNotificationOverviewDashboardViewModel,
} from "../lib/notification-read-api-view-model";
import {
  buildNotificationOverviewMetricCardDescriptors,
  buildNotificationOverviewPanelDescriptors,
  type NotificationReadApiLinkActionDescriptor,
} from "../lib/notification-read-api-selectors";
import { useNotificationOverviewUrlSync } from "../lib/notification-read-api-url-state";
import type { NotificationDeliveryChannel } from "../lib/notification-read-api-query-state";
import NotificationGovernanceNav from "./notification-governance-nav";

type OverviewSnapshot = NotificationOverviewPageData["overview"]["snapshot"];

type TrendDirection = "up" | "flat" | "down";

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
  const { data } = overviewRequest;
  const snapshot = data?.overview.snapshot ?? null;
  const viewModel = useMemo(
    () =>
      buildNotificationOverviewDashboardViewModel({
        request: overviewRequest,
        backHref: "/platform-admin",
        opsHref: "/platform-admin/notifications-ops",
        alertWorkflowHref: snapshot ? buildAlertWorkflowHref(snapshot) : "/platform-admin/notifications-alerts",
      }),
    [overviewRequest, snapshot],
  );
  const metricCards = useMemo(
    () =>
      buildNotificationOverviewMetricCardDescriptors(snapshot, {
        toCount,
        toPercent,
      }),
    [snapshot],
  );
  const panelDescriptors = useMemo(
    () =>
      buildNotificationOverviewPanelDescriptors({
        viewModel,
        data,
        buildAlertWorkflowHref: (tenantId?: string) =>
          snapshot ? buildAlertWorkflowHref(snapshot, tenantId) : "/platform-admin/notifications-alerts",
        buildTenantDrilldownHref,
        formatters: {
          toCount,
          toPercent,
          trendDirectionLabel,
        },
      }),
    [buildTenantDrilldownHref, data, snapshot, viewModel],
  );
  const [insightsPriorityPanel, insightsReasonsPanel, trendsPanel] = panelDescriptors.nonBlockingPanels;
  const [byChannelPanel, byTenantPanel, dailyPanel] = panelDescriptors.supportingPanels;
  const handleRefresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);
  const warmTenantDrilldown = useCallback((tenantId: string) => {
    void prefetchNotificationTenantDrilldownFromOverviewState(tenantId, filters);
  }, [filters]);
  const warmTenantDrilldownFromTarget = useCallback((currentTarget: EventTarget | null) => {
    if (!(currentTarget instanceof HTMLElement)) return;
    const tenantId = currentTarget.dataset.tenantId;
    if (!tenantId) return;
    warmTenantDrilldown(tenantId);
  }, [warmTenantDrilldown]);
  const warmNavigationHandlers = useMemo(
    () => ({
      onMouseEnter: (event: MouseEvent<HTMLAnchorElement>) => warmTenantDrilldownFromTarget(event.currentTarget),
      onFocus: (event: FocusEvent<HTMLAnchorElement>) => warmTenantDrilldownFromTarget(event.currentTarget),
      onPointerDown: (event: PointerEvent<HTMLAnchorElement>) => warmTenantDrilldownFromTarget(event.currentTarget),
    }),
    [warmTenantDrilldownFromTarget],
  );
  const buildWarmLinkProps = (action: NotificationReadApiLinkActionDescriptor) => ({
    href: action.href,
    "data-tenant-id": action.prefetchKey ?? undefined,
    ...warmNavigationHandlers,
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
              <Link className="fdPillBtn" href={viewModel.actions.backToPlatform.href ?? "/platform-admin"}>
                {viewModel.actions.backToPlatform.label}
              </Link>
              <Link className="fdPillBtn" href={viewModel.actions.openOps.href ?? "/platform-admin/notifications-ops"}>
                {viewModel.actions.openOps.label}
              </Link>
              <Link
                className="fdPillBtn"
                href={viewModel.actions.openAlertWorkflow.href ?? "/platform-admin/notifications-alerts"}
              >
                {viewModel.actions.openAlertWorkflow.label}
              </Link>
              <button
                type="button"
                className="fdPillBtn"
                onClick={handleRefresh}
                disabled={!viewModel.actions.refresh.enabled}
              >
                {viewModel.actions.refresh.label}
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

        {viewModel.page.showStatusNotice || viewModel.page.errorSummary.length > 0 ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className={viewModel.page.tone === "danger" ? "error" : "sub"} style={{ marginTop: 0 }}>
              {viewModel.page.assistiveMessage}
            </p>
            {viewModel.page.errorSummary.map((summary: string) => (
              <p key={summary} className="sub" style={{ marginTop: 8 }}>
                {summary}
              </p>
            ))}
          </section>
        ) : null}

        {viewModel.page.status === "initial_loading" ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading notification performance overview...</p>
          </section>
        ) : null}

        {snapshot ? (
          <>
            <section className="fdInventorySummary" style={{ marginBottom: 14 }}>
              {metricCards.map((card) => (
                <div key={card.key} className="fdGlassSubPanel fdInventorySummaryItem">
                  <div className="kvLabel">{card.label}</div>
                  <strong className="fdInventorySummaryValue">{card.value}</strong>
                </div>
              ))}
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                {panelDescriptors.overviewPanel.assistiveMessage}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Rate definition: success/fail denominator = sent + failed; open/click/conversion denominator = sent.
              </p>
              {panelDescriptors.overviewPanel.payload.aggregationSourceLabel ? (
                <p className="sub" style={{ marginTop: 0 }}>
                  {panelDescriptors.overviewPanel.payload.aggregationSourceLabel}
                </p>
              ) : null}
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">{insightsPriorityPanel.title}</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  {insightsPriorityPanel.assistiveMessage}
                </p>
                {insightsPriorityPanel.payload.kind === "insights_priority" && insightsPriorityPanel.payload.rule ? (
                  <>
                    <p className="sub" style={{ marginTop: 0 }}>
                      Rule: {insightsPriorityPanel.payload.rule}
                    </p>
                    <div className="fdDataGrid" style={{ marginTop: 8 }}>
                      {insightsPriorityPanel.payload.items.map((item) => (
                        <div key={item.key} className="fdGlassSubPanel" style={{ padding: 10 }}>
                          <p className="sub" style={{ marginTop: 0 }}>
                            [{item.priority}/{item.severity}] score {item.score} - {item.tenantId}
                          </p>
                          <p className="sub" style={{ marginTop: 0 }}>
                            {item.summary}
                          </p>
                          <div className="actions" style={{ marginTop: 6 }}>
                            {item.actions.map((action) => (
                              <Link
                                key={`${item.key}-${action.kind}`}
                                className="fdPillBtn"
                                {...(action.kind === "open_drilldown" ? buildWarmLinkProps(action) : { href: action.href })}
                              >
                                {action.label}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                      {insightsPriorityPanel.payload.items.length === 0 ? (
                        <p className="fdGlassText">{insightsPriorityPanel.emptyMessage}</p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="fdGlassText">Analytics panel is temporarily unavailable.</p>
                )}
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">{insightsReasonsPanel.title}</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  {insightsReasonsPanel.assistiveMessage}
                </p>
                {insightsReasonsPanel.payload.kind === "insights_reasons" ? (
                  <div className="fdDataGrid" style={{ marginTop: 8 }}>
                    {insightsReasonsPanel.payload.items.map((item) => (
                      <p key={item.key} className="sub" style={{ marginTop: 0 }}>
                        {item.text}
                      </p>
                    ))}
                    {insightsReasonsPanel.payload.items.length === 0 ? (
                      <p className="fdGlassText">{insightsReasonsPanel.emptyMessage}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="fdGlassText">Anomaly insights are temporarily unavailable.</p>
                )}
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
                <h2 className="sectionTitle">{trendsPanel.title}</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  {trendsPanel.assistiveMessage}
                </p>
                {trendsPanel.payload.kind === "trend_comparison" && trendsPanel.payload.windowSummary ? (
                  <>
                    <p className="sub" style={{ marginTop: 0 }}>
                      {trendsPanel.payload.windowSummary}
                    </p>
                    <p className="sub" style={{ marginTop: 0 }}>
                      {trendsPanel.payload.overallSummary}
                    </p>
                    <p className="sub" style={{ marginTop: 0 }}>
                      Rate definition: anomaly rate denominator = total deliveries in each window.
                    </p>

                    <section className="fdTwoCol" style={{ marginTop: 10 }}>
                      <section className="fdGlassSubPanel" style={{ padding: 12 }}>
                        <h3 className="sectionTitle">Top Worsening Tenants</h3>
                        <div className="fdDataGrid" style={{ marginTop: 8 }}>
                          {trendsPanel.payload.worseningTenants.map((item) => (
                            <div key={item.key} className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <p className="sub" style={{ marginTop: 0 }}>
                                {item.summary}
                              </p>
                              <div className="actions" style={{ marginTop: 6 }}>
                                {item.actions.map((action) => (
                                  <Link
                                    key={`${item.key}-${action.kind}`}
                                    className="fdPillBtn"
                                    {...(action.kind === "open_drilldown" ? buildWarmLinkProps(action) : { href: action.href })}
                                  >
                                    {action.label}
                                  </Link>
                                ))}
                              </div>
                            </div>
                          ))}
                          {trendsPanel.payload.worseningTenants.length === 0 ? (
                            <p className="fdGlassText">No worsening tenants in current window.</p>
                          ) : null}
                        </div>
                      </section>

                      <section className="fdGlassSubPanel" style={{ padding: 12 }}>
                        <h3 className="sectionTitle">Top Worsening Anomaly Types</h3>
                        <div className="fdDataGrid" style={{ marginTop: 8 }}>
                          {trendsPanel.payload.worseningAnomalyTypes.map((item) => (
                            <p key={item.key} className="sub" style={{ marginTop: 0 }}>
                              {item.text}
                            </p>
                          ))}
                          {trendsPanel.payload.worseningAnomalyTypes.length === 0 ? (
                            <p className="fdGlassText">No worsening anomaly types.</p>
                          ) : null}
                        </div>
                        <h3 className="sectionTitle" style={{ marginTop: 12 }}>
                          Worsening Channels
                        </h3>
                        <div className="fdDataGrid" style={{ marginTop: 8 }}>
                          {trendsPanel.payload.worseningChannels.map((item) => (
                            <p key={item.key} className="sub" style={{ marginTop: 0 }}>
                              {item.text}
                            </p>
                          ))}
                          {trendsPanel.payload.worseningChannels.length === 0 ? (
                            <p className="fdGlassText">No worsening channels.</p>
                          ) : null}
                        </div>
                      </section>
                    </section>
                  </>
                ) : (
                  <p className="fdGlassText">Trend comparison is temporarily unavailable.</p>
                )}
              </section>

            {viewModel.page.emptyMessage ? (
              <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
                <p className="fdGlassText">{viewModel.page.emptyMessage}</p>
              </section>
            ) : null}

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">{byChannelPanel.title}</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {byChannelPanel.payload.kind === "by_channel"
                    ? byChannelPanel.payload.rows.map((row) => (
                    <p key={row.key} className="sub" style={{ marginTop: 0 }}>
                      {row.text}
                    </p>
                      ))
                    : null}
                  {byChannelPanel.payload.kind === "by_channel" && byChannelPanel.payload.rows.length === 0 ? (
                    <p className="fdGlassText">{byChannelPanel.emptyMessage}</p>
                  ) : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">{byTenantPanel.title}</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {byTenantPanel.payload.kind === "by_tenant"
                    ? byTenantPanel.payload.rows.map((row) => (
                    <div key={row.key} className="fdGlassSubPanel" style={{ padding: 10 }}>
                      <p className="sub" style={{ marginTop: 0 }}>
                        {row.text}
                      </p>
                      <div className="actions" style={{ marginTop: 6 }}>
                        {row.actions.map((action) => (
                          <Link key={`${row.key}-${action.kind}`} className="fdPillBtn" {...buildWarmLinkProps(action)}>
                            {action.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                      ))
                    : null}
                  {byTenantPanel.payload.kind === "by_tenant" && byTenantPanel.payload.rows.length === 0 ? (
                    <p className="fdGlassText">{byTenantPanel.emptyMessage}</p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">{dailyPanel.title}</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {dailyPanel.payload.kind === "daily"
                  ? dailyPanel.payload.rows.map((row) => (
                  <p key={row.key} className="sub" style={{ marginTop: 0 }}>
                    {row.text}
                  </p>
                    ))
                  : null}
                {dailyPanel.payload.kind === "daily" && dailyPanel.payload.rows.length === 0 ? (
                  <p className="fdGlassText">{dailyPanel.emptyMessage}</p>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
