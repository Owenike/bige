"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  getDefaultTenantDrilldownSupportNote,
  useNotificationTenantDrilldownPageData,
} from "../lib/notification-read-api-hooks";
import { buildNotificationTenantDrilldownViewModel } from "../lib/notification-read-api-view-model";
import {
  buildNotificationTenantDrilldownMetricCardDescriptors,
  buildNotificationTenantDrilldownSectionDescriptors,
} from "../lib/notification-read-api-selectors";
import { useNotificationTenantDrilldownUrlSync } from "../lib/notification-read-api-url-state";
import type { NotificationDeliveryChannel, NotificationTenantDrilldownQueryState } from "../lib/notification-read-api-query-state";

type FilterState = NotificationTenantDrilldownQueryState;

function toCount(value: number | null | undefined) {
  return Number(value || 0).toLocaleString();
}

function toPercent(value: number | null | undefined) {
  return `${Number(value || 0).toFixed(2)}%`;
}

export default function NotificationOverviewTenantDrilldown(props: { tenantId: string }) {
  const { filters, draft, setDraft, applyDraft, resetFilters, backHref } = useNotificationTenantDrilldownUrlSync(props.tenantId);
  const [refreshKey, setRefreshKey] = useState(0);
  const drilldownRequest = useNotificationTenantDrilldownPageData(props.tenantId, filters, refreshKey);
  const { data } = drilldownRequest;
  const snapshot = data?.drilldown.snapshot ?? null;
  const recentAnomaliesSupportNote = data?.recentAnomaliesSupportNote ?? getDefaultTenantDrilldownSupportNote();
  const viewModel = useMemo(
    () =>
      buildNotificationTenantDrilldownViewModel({
        request: drilldownRequest,
        backHref,
      }),
    [backHref, drilldownRequest],
  );
  const metricCards = useMemo(
    () =>
      buildNotificationTenantDrilldownMetricCardDescriptors(snapshot, {
        toCount,
        toPercent,
      }),
    [snapshot],
  );
  const sectionDescriptors = useMemo(
    () =>
      buildNotificationTenantDrilldownSectionDescriptors({
        viewModel,
        data,
        recentAnomaliesSupportNote,
      }),
    [data, recentAnomaliesSupportNote, viewModel],
  );
  const [channelSection, dailySection, anomalySection] = sectionDescriptors.sections;
  const handleRefresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">TENANT DRILLDOWN</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Tenant Notification Performance
            </h1>
            <p className="fdGlassText">Tenant: {props.tenantId}</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href={viewModel.actions.backToOverview.href ?? backHref}>
                {viewModel.actions.backToOverview.label}
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

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Filters</h2>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
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
              value={draft.aggregationMode}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, aggregationMode: event.target.value as FilterState["aggregationMode"] }))
              }
            >
              <option value="auto">aggregation auto</option>
              <option value="raw">aggregation raw</option>
              <option value="rollup">aggregation rollup</option>
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
            <select
              className="input"
              value={String(draft.anomalyLimit)}
              onChange={(event) => setDraft((prev) => ({ ...prev, anomalyLimit: Number(event.target.value || 40) }))}
            >
              <option value="20">anomaly 20</option>
              <option value="40">anomaly 40</option>
              <option value="80">anomaly 80</option>
              <option value="120">anomaly 120</option>
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
            {viewModel.page.errorSummary.map((summary) => (
              <p key={summary} className="sub" style={{ marginTop: 8 }}>
                {summary}
              </p>
            ))}
          </section>
        ) : null}

        {viewModel.page.status === "initial_loading" ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading tenant drilldown...</p>
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
                {sectionDescriptors.summarySection.assistiveMessage}
              </p>
              {sectionDescriptors.summarySection.payload.kind === "tenant_summary" &&
              sectionDescriptors.summarySection.payload.aggregationSourceLabel ? (
                <p className="sub" style={{ marginTop: 0 }}>
                  {sectionDescriptors.summarySection.payload.aggregationSourceLabel}
                </p>
              ) : null}
              <p className="sub" style={{ marginTop: 0 }}>
                Rate definition: success/fail denominator = sent + failed; open/click/conversion denominator = sent.
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {sectionDescriptors.summarySection.payload.kind === "tenant_summary"
                  ? sectionDescriptors.summarySection.payload.supportNote
                  : recentAnomaliesSupportNote}
              </p>
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">{channelSection.title}</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {channelSection.payload.kind === "tenant_by_channel"
                    ? channelSection.payload.rows.map((row) => (
                    <p key={row.key} className="sub" style={{ marginTop: 0 }}>
                      {row.text}
                    </p>
                      ))
                    : null}
                  {channelSection.payload.kind === "tenant_by_channel" && channelSection.payload.rows.length === 0 ? (
                    <p className="fdGlassText">{channelSection.emptyMessage}</p>
                  ) : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">{dailySection.title}</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {dailySection.payload.kind === "tenant_daily"
                    ? dailySection.payload.rows.map((row) => (
                    <p key={row.key} className="sub" style={{ marginTop: 0 }}>
                      {row.text}
                    </p>
                      ))
                    : null}
                  {dailySection.payload.kind === "tenant_daily" && dailySection.payload.rows.length === 0 ? (
                    <p className="fdGlassText">{dailySection.emptyMessage}</p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">{anomalySection.title}</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {anomalySection.payload.kind === "tenant_recent_anomalies"
                  ? anomalySection.payload.rows.map((row) => (
                  <p key={row.key} className="sub" style={{ marginTop: 0 }}>
                    {row.text}
                  </p>
                    ))
                  : null}
                {anomalySection.payload.kind === "tenant_recent_anomalies" && anomalySection.payload.rows.length === 0 ? (
                  <p className="fdGlassText">{anomalySection.emptyMessage}</p>
                ) : null}
              </div>
            </section>

            {viewModel.page.emptyMessage ? (
              <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
                <p className="fdGlassText">{viewModel.page.emptyMessage}</p>
              </section>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
