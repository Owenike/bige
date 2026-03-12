"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import NotificationGovernanceNav from "./notification-governance-nav";

type DeliveryChannel = "in_app" | "email" | "line" | "sms" | "webhook" | "other";

type DailyItem = {
  day: string;
  sent: number;
  failed: number;
  deadLetter: number;
  opened: number;
  clicked: number;
  conversion: number;
  total: number;
  successRate: number;
  failRate: number;
};

type ChannelItem = {
  channel: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  retrying: number;
  deadLetter: number;
  opened: number;
  clicked: number;
  conversion: number;
  successRate: number;
  failRate: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
};

type TenantItem = {
  tenantId: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  retrying: number;
  deadLetter: number;
  opened: number;
  clicked: number;
  conversion: number;
  successRate: number;
  failRate: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
};

type OverviewSnapshot = {
  from: string;
  to: string;
  tenantId: string | null;
  channel: DeliveryChannel | null;
  dataSource: "raw" | "rollup";
  totalRows: number;
  sent: number;
  failed: number;
  pending: number;
  retrying: number;
  deadLetter: number;
  opened: number;
  clicked: number;
  conversion: number;
  successRate: number;
  failRate: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
  daily: DailyItem[];
  byChannel: ChannelItem[];
  byTenant: TenantItem[];
};

type AnomalyReasonItem = {
  key: string;
  label: string;
  sample: string | null;
  count: number;
  deadLetter: number;
  failed: number;
  retrying: number;
  tenantCount: number;
  channelCount: number;
};

type TenantPriorityItem = {
  tenantId: string;
  priority: "P1" | "P2" | "P3" | "P4";
  severity: "critical" | "high" | "medium" | "low";
  score: number;
  deadLetter: number;
  failedRate: number;
  retrying: number;
  anomalyTotal: number;
  recentAnomalies: number;
  previousAnomalies: number;
  surgeRatio: number;
  summary: string;
};

type AnomalyInsightsSnapshot = {
  from: string;
  to: string;
  tenantId: string | null;
  channel: DeliveryChannel | null;
  totalAnomalies: number;
  reasonClusters: AnomalyReasonItem[];
  tenantPriorities: TenantPriorityItem[];
  priorityRule: {
    scoreFormula: string;
    weights: {
      deadLetter: number;
      failed: number;
      retrying: number;
      failedRateBands: Array<{ threshold: number; bonus: number }>;
      surgeBands: Array<{ condition: string; bonus: number }>;
    };
    severityBands: Array<{ severity: "critical" | "high" | "medium" | "low"; minScore: number }>;
  };
};

type TrendDirection = "up" | "flat" | "down";

type TrendItem = {
  currentCount: number;
  previousCount: number;
  countDelta: number;
  currentRate: number;
  previousRate: number;
  rateDelta: number;
  direction: TrendDirection;
};

type TrendTenantItem = TrendItem & {
  tenantId: string;
};

type TrendChannelItem = TrendItem & {
  channel: string;
};

type TrendAnomalyTypeItem = TrendItem & {
  key: string;
  label: string;
  sample: string | null;
};

type TrendComparisonSnapshot = {
  tenantId: string | null;
  channel: DeliveryChannel | null;
  currentWindow: {
    from: string;
    to: string;
    durationMinutes: number;
    totalDeliveries: number;
    anomalyCount: number;
    anomalyRate: number;
  };
  previousWindow: {
    from: string;
    to: string;
    durationMinutes: number;
    totalDeliveries: number;
    anomalyCount: number;
    anomalyRate: number;
  };
  overall: TrendItem;
  topWorseningTenants: TrendTenantItem[];
  topWorseningAnomalyTypes: TrendAnomalyTypeItem[];
  topWorseningChannels: TrendChannelItem[];
  rateDefinitions: {
    anomalyRateDenominator: "total_deliveries_in_window";
  };
};

type FilterState = {
  tenantId: string;
  channel: "" | DeliveryChannel;
  from: string;
  to: string;
  limit: number;
};

function toLocalDateTimeInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const tzOffset = date.getTimezoneOffset();
  return new Date(date.getTime() - tzOffset * 60_000).toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(input: string) {
  const value = String(input || "").trim();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function defaultFilters(): FilterState {
  const now = new Date();
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    tenantId: "",
    channel: "",
    from: toLocalDateTimeInput(last7d.toISOString()),
    to: toLocalDateTimeInput(now.toISOString()),
    limit: 2000,
  };
}

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

function buildTenantDrilldownHref(snapshot: OverviewSnapshot, tenantId: string) {
  const params = new URLSearchParams();
  params.set("from", snapshot.from);
  params.set("to", snapshot.to);
  if (snapshot.channel) params.set("channel", snapshot.channel);
  params.set("limit", "2000");
  params.set("anomalyLimit", "40");
  return `/platform-admin/notifications-overview/${encodeURIComponent(tenantId)}?${params.toString()}`;
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
  const [filters, setFilters] = useState<FilterState>(() => defaultFilters());
  const [draft, setDraft] = useState<FilterState>(() => defaultFilters());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [insights, setInsights] = useState<AnomalyInsightsSnapshot | null>(null);
  const [trend, setTrend] = useState<TrendComparisonSnapshot | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (filters.tenantId.trim()) params.set("tenantId", filters.tenantId.trim());
    if (filters.channel) params.set("channel", filters.channel);
    const fromIso = fromLocalDateTimeInput(filters.from);
    const toIso = fromLocalDateTimeInput(filters.to);
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);
    params.set("limit", String(filters.limit));

    setLoading(true);
    setError(null);
    const overviewPath = `/api/platform/notifications/overview?${params.toString()}&aggregationMode=auto`;
    const anomaliesPath = `/api/platform/notifications/anomalies?${params.toString()}`;
    const trendsPath = `/api/platform/notifications/trends?${params.toString()}&topLimit=8`;
    void Promise.all([
      fetch(overviewPath, { cache: "no-store" }).then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload?.error?.message || payload?.message || "Load overview failed";
          throw new Error(String(message));
        }
        return payload?.snapshot || payload?.data?.snapshot || null;
      }),
      fetch(anomaliesPath, { cache: "no-store" }).then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload?.error?.message || payload?.message || "Load anomalies failed";
          throw new Error(String(message));
        }
        return payload?.snapshot || payload?.data?.snapshot || null;
      }),
      fetch(trendsPath, { cache: "no-store" }).then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload?.error?.message || payload?.message || "Load trend comparison failed";
          throw new Error(String(message));
        }
        return payload?.snapshot || payload?.data?.snapshot || null;
      }),
    ])
      .then(([overviewData, anomaliesData, trendsData]) => {
        if (!active) return;
        if (!overviewData) {
          setError("Overview payload is empty.");
          setLoading(false);
          return;
        }
        if (!anomaliesData) {
          setError("Anomaly insights payload is empty.");
          setLoading(false);
          return;
        }
        if (!trendsData) {
          setError("Trend comparison payload is empty.");
          setLoading(false);
          return;
        }
        setSnapshot(overviewData as OverviewSnapshot);
        setInsights(anomaliesData as AnomalyInsightsSnapshot);
        setTrend(trendsData as TrendComparisonSnapshot);
        setLoading(false);
      })
      .catch((fetchError) => {
        if (!active) return;
        setError(fetchError instanceof Error ? fetchError.message : "Load overview failed");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, refreshKey]);

  const hasData = useMemo(() => Boolean(snapshot && snapshot.totalRows > 0), [snapshot]);

  function applyFilters() {
    setFilters({
      tenantId: draft.tenantId.trim(),
      channel: draft.channel,
      from: draft.from,
      to: draft.to,
      limit: Math.max(200, Math.min(50000, Number(draft.limit || 2000))),
    });
  }

  function resetFilters() {
    const defaults = defaultFilters();
    setDraft(defaults);
    setFilters(defaults);
  }

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
                Refresh
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
              onChange={(event) => setDraft((prev) => ({ ...prev, channel: event.target.value as FilterState["channel"] }))}
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
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={applyFilters}>
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
            <div className="error">{error}</div>
          </section>
        ) : null}

        {loading && !snapshot ? (
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
                Rate definition: success/fail denominator = sent + failed; open/click/conversion denominator = sent.
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Aggregation source: {snapshot.dataSource === "rollup" ? "daily rollup" : "raw query fallback"}.
              </p>
            </section>

            {insights ? (
              <>
                <section className="fdTwoCol" style={{ marginBottom: 14 }}>
                  <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                    <h2 className="sectionTitle">Tenant Alert Priority</h2>
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
                            <Link className="fdPillBtn" href={buildTenantDrilldownHref(snapshot, item.tenantId)}>
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
                  </section>

                  <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                    <h2 className="sectionTitle">Top Anomaly Reasons</h2>
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
                  </section>
                </section>
              </>
            ) : null}

            {trend ? (
              <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
                <h2 className="sectionTitle">Alert Trend Comparison (Current vs Previous Window)</h2>
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
                            <Link className="fdPillBtn" href={buildTenantDrilldownHref(snapshot, item.tenantId)}>
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
              </section>
            ) : null}

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
                        <Link className="fdPillBtn" href={buildTenantDrilldownHref(snapshot, row.tenantId)}>
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
