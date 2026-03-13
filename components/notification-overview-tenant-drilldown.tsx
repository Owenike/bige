"use client";

import Link from "next/link";
import { useState } from "react";
import { formatNotificationAggregationDataSourceLabel } from "../lib/notification-aggregation-contract";
import {
  getDefaultTenantDrilldownSupportNote,
  useNotificationTenantDrilldownPageData,
} from "../lib/notification-read-api-hooks";
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
  const { data, loading, error, isInitialLoading } = useNotificationTenantDrilldownPageData(props.tenantId, filters, refreshKey);
  const snapshot = data?.drilldown.snapshot ?? null;
  const recentAnomaliesSupportNote = data?.recentAnomaliesSupportNote ?? getDefaultTenantDrilldownSupportNote();

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
              <Link className="fdPillBtn" href={backHref}>
                Back To Overview
              </Link>
              <button type="button" className="fdPillBtn" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}>
                Refresh
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

        {error ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <div className="error">{error.message}</div>
          </section>
        ) : null}

        {isInitialLoading ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading tenant drilldown...</p>
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
                <div className="kvLabel">Sent / Failed / Dead Letter</div>
                <strong className="fdInventorySummaryValue">
                  {toCount(snapshot.sent)} / {toCount(snapshot.failed)} / {toCount(snapshot.deadLetter)}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Opened / Clicked / Conversion</div>
                <strong className="fdInventorySummaryValue">
                  {toCount(snapshot.opened)} / {toCount(snapshot.clicked)} / {toCount(snapshot.conversion)}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Success / Fail Rate</div>
                <strong className="fdInventorySummaryValue">
                  {toPercent(snapshot.successRate)} / {toPercent(snapshot.failRate)}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Open / Click / Conversion Rate</div>
                <strong className="fdInventorySummaryValue">
                  {toPercent(snapshot.openRate)} / {toPercent(snapshot.clickRate)} / {toPercent(snapshot.conversionRate)}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Anomalies (failed / dead_letter / retrying)</div>
                <strong className="fdInventorySummaryValue">
                  {toCount(snapshot.anomalySummary.total)} ({toCount(snapshot.anomalySummary.failed)} /{" "}
                  {toCount(snapshot.anomalySummary.deadLetter)} / {toCount(snapshot.anomalySummary.retrying)})
                </strong>
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                {formatNotificationAggregationDataSourceLabel(snapshot.dataSource)}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Rate definition: success/fail denominator = sent + failed; open/click/conversion denominator = sent.
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {recentAnomaliesSupportNote}
              </p>
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Channel Breakdown</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {snapshot.byChannel.map((row) => (
                    <p key={row.channel} className="sub" style={{ marginTop: 0 }}>
                      {row.channel}: sent {row.sent}, failed {row.failed} (dead_letter {row.deadLetter}), opened {row.opened},
                      clicked {row.clicked}, conversion {row.conversion}
                    </p>
                  ))}
                  {snapshot.byChannel.length === 0 ? <p className="fdGlassText">No channel data.</p> : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Daily Trend</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {snapshot.daily.map((row) => (
                    <p key={row.day} className="sub" style={{ marginTop: 0 }}>
                      {row.day}: sent {row.sent}, failed {row.failed}, dead_letter {row.deadLetter}, opened {row.opened}, clicked{" "}
                      {row.clicked}, conversion {row.conversion}
                    </p>
                  ))}
                  {snapshot.daily.length === 0 ? <p className="fdGlassText">No daily trend data.</p> : null}
                </div>
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">Recent Anomalies</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {snapshot.recentAnomalies.map((row) => (
                  <p key={row.id} className="sub" style={{ marginTop: 0 }}>
                    [{row.status}] {row.channel} - {row.errorCode || "NO_CODE"} - {row.lastError || row.errorMessage || "-"} (retry{" "}
                    {row.retryCount}/{row.maxAttempts}, occurred {new Date(row.occurredAt).toLocaleString()})
                  </p>
                ))}
                {snapshot.recentAnomalies.length === 0 ? <p className="fdGlassText">No anomalies in current scope.</p> : null}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
