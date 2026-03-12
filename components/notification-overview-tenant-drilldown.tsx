"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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

type AnomalyItem = {
  id: string;
  channel: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  lastError: string | null;
  attempts: number;
  retryCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  occurredAt: string;
};

type DrilldownSnapshot = {
  from: string;
  to: string;
  tenantId: string;
  channel: DeliveryChannel | null;
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
  rateDefinitions: {
    successFailDenominator: "sent_plus_failed";
    engagementDenominator: "sent";
  };
  daily: DailyItem[];
  byChannel: ChannelItem[];
  recentAnomalies: AnomalyItem[];
  anomalySummary: {
    total: number;
    failed: number;
    deadLetter: number;
    retrying: number;
  };
};

type FilterState = {
  channel: "" | DeliveryChannel;
  from: string;
  to: string;
  limit: number;
  anomalyLimit: number;
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

function parseIsoInput(raw: string | null) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return toLocalDateTimeInput(parsed.toISOString());
}

function toCount(value: number | null | undefined) {
  return Number(value || 0).toLocaleString();
}

function toPercent(value: number | null | undefined) {
  return `${Number(value || 0).toFixed(2)}%`;
}

export default function NotificationOverviewTenantDrilldown(props: { tenantId: string }) {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<FilterState>(() => {
    const now = new Date();
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {
      channel: (searchParams.get("channel") as FilterState["channel"]) || "",
      from: parseIsoInput(searchParams.get("from")) || toLocalDateTimeInput(last7d.toISOString()),
      to: parseIsoInput(searchParams.get("to")) || toLocalDateTimeInput(now.toISOString()),
      limit: Math.max(200, Math.min(50000, Number(searchParams.get("limit") || 2000))),
      anomalyLimit: Math.max(10, Math.min(120, Number(searchParams.get("anomalyLimit") || 40))),
    };
  });
  const [draft, setDraft] = useState<FilterState>(filters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DrilldownSnapshot | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (filters.channel) params.set("channel", filters.channel);
    const fromIso = fromLocalDateTimeInput(filters.from);
    const toIso = fromLocalDateTimeInput(filters.to);
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);
    params.set("limit", String(filters.limit));
    params.set("anomalyLimit", String(filters.anomalyLimit));

    setLoading(true);
    setError(null);
    void fetch(`/api/platform/notifications/overview/tenants/${encodeURIComponent(props.tenantId)}?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload?.error?.message || payload?.message || "Load tenant drilldown failed";
          throw new Error(String(message));
        }
        return payload?.snapshot || payload?.data?.snapshot || null;
      })
      .then((data) => {
        if (!active) return;
        if (!data) {
          setError("Tenant drilldown payload is empty.");
          setLoading(false);
          return;
        }
        setSnapshot(data as DrilldownSnapshot);
        setLoading(false);
      })
      .catch((fetchError) => {
        if (!active) return;
        setError(fetchError instanceof Error ? fetchError.message : "Load tenant drilldown failed");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, props.tenantId, refreshKey]);

  const backHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("tenantId", props.tenantId);
    const fromIso = fromLocalDateTimeInput(filters.from);
    const toIso = fromLocalDateTimeInput(filters.to);
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);
    if (filters.channel) params.set("channel", filters.channel);
    params.set("limit", String(filters.limit));
    return `/platform-admin/notifications-overview?${params.toString()}`;
  }, [filters, props.tenantId]);

  function applyFilters() {
    setFilters({
      channel: draft.channel,
      from: draft.from,
      to: draft.to,
      limit: Math.max(200, Math.min(50000, Number(draft.limit || 2000))),
      anomalyLimit: Math.max(10, Math.min(120, Number(draft.anomalyLimit || 40))),
    });
  }

  function resetFilters() {
    const now = new Date();
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const next = {
      channel: "" as FilterState["channel"],
      from: toLocalDateTimeInput(last7d.toISOString()),
      to: toLocalDateTimeInput(now.toISOString()),
      limit: 2000,
      anomalyLimit: 40,
    };
    setDraft(next);
    setFilters(next);
  }

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
                Rate definition: success/fail denominator = sent + failed; open/click/conversion denominator = sent.
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
