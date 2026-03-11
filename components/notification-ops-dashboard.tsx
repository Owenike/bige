"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  buildOpsDashboardSearchParams,
  buildOpsDashboardViewModel,
  fetchOpsDashboardBundle,
  parseOpsDashboardQuery,
  type OpsDashboardMode,
  type OpsDashboardQuery,
  type OpsDashboardBundle,
  type OpsStatusFilter,
} from "../lib/notification-ops-dashboard-ui";
import {
  formatStatusLabel,
  getNotificationGovernanceToneStyle,
  resolveNotificationGovernanceTone,
} from "../lib/notification-governance-view-model";
import NotificationGovernanceNav from "./notification-governance-nav";

type NotificationOpsDashboardProps = {
  mode: OpsDashboardMode;
};

function toDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function toMinutesLabel(value: number | null) {
  if (value === null) return "-";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours < 24) return `${hours}h ${minutes}m`;
  const days = Math.floor(hours / 24);
  const hoursRemainder = hours % 24;
  return `${days}d ${hoursRemainder}h`;
}

function safeNumberInput(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export default function NotificationOpsDashboard(props: NotificationOpsDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => parseOpsDashboardQuery(searchParams, props.mode), [searchParams, props.mode]);
  const [bundle, setBundle] = useState<OpsDashboardBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [tenantIdInput, setTenantIdInput] = useState(query.tenantId || "");
  const [limitInput, setLimitInput] = useState(String(query.limit));
  const [staleInput, setStaleInput] = useState(String(query.staleAfterMinutes));

  useEffect(() => {
    setTenantIdInput(query.tenantId || "");
    setLimitInput(String(query.limit));
    setStaleInput(String(query.staleAfterMinutes));
  }, [query.limit, query.staleAfterMinutes, query.tenantId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void fetchOpsDashboardBundle({
      mode: props.mode,
      query: {
        tenantId: query.tenantId,
        limit: query.limit,
        staleAfterMinutes: query.staleAfterMinutes,
        status: query.status,
      },
    }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.message);
        setLoading(false);
        return;
      }
      setBundle(result.bundle);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [props.mode, query.tenantId, query.limit, query.staleAfterMinutes, query.status, refreshKey]);

  const viewModel = useMemo(
    () => (bundle ? buildOpsDashboardViewModel({ bundle, query }) : null),
    [bundle, query],
  );

  function pushQuery(next: OpsDashboardQuery) {
    const params = buildOpsDashboardSearchParams(next, props.mode);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname);
  }

  function applyFilters() {
    pushQuery({
      ...query,
      tenantId: props.mode === "platform" ? tenantIdInput.trim() || null : null,
      limit: safeNumberInput(limitInput, query.limit, 50, 3000),
      staleAfterMinutes: safeNumberInput(staleInput, query.staleAfterMinutes, 1, 10080),
    });
  }

  function setStatus(status: OpsStatusFilter) {
    pushQuery({
      ...query,
      status,
    });
  }

  function resetFilters() {
    pushQuery({
      tenantId: null,
      limit: 500,
      staleAfterMinutes: 1440,
      status: "all",
    });
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{props.mode === "platform" ? "PLATFORM OPS" : "TENANT OPS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Notification Reliability Dashboard
            </h1>
            <p className="fdGlassText">
              Read-only dashboard from notifications ops summary/health/coverage APIs.
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href={props.mode === "platform" ? "/platform-admin" : "/manager"}>
                Back
              </Link>
              <button type="button" className="fdPillBtn" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}>
                Refresh
              </button>
            </div>
          </div>
        </section>
        <NotificationGovernanceNav mode={props.mode} />

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Filters</h2>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            {props.mode === "platform" ? (
              <input
                className="input"
                value={tenantIdInput}
                onChange={(event) => setTenantIdInput(event.target.value)}
                placeholder="tenantId (blank = global)"
              />
            ) : (
              <input className="input" value="Tenant scope enforced by API guard" readOnly />
            )}
            <select className="input" value={staleInput} onChange={(event) => setStaleInput(event.target.value)}>
              <option value="60">stale after 60m</option>
              <option value="240">stale after 240m</option>
              <option value="720">stale after 12h</option>
              <option value="1440">stale after 24h</option>
              <option value="2880">stale after 48h</option>
            </select>
            <select className="input" value={limitInput} onChange={(event) => setLimitInput(event.target.value)}>
              <option value="200">sample 200</option>
              <option value="500">sample 500</option>
              <option value="1000">sample 1000</option>
              <option value="2000">sample 2000</option>
            </select>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={applyFilters}>
              Apply
            </button>
            <button type="button" className="fdPillBtn" onClick={resetFilters}>
              Reset
            </button>
            <select className="input" value={query.status} onChange={(event) => setStatus(event.target.value as OpsStatusFilter)}>
              <option value="all">status: all</option>
              <option value="failed">status: failed</option>
              <option value="retrying">status: retrying</option>
              <option value="skipped">status: skipped</option>
            </select>
          </div>
        </section>

        {error ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <div className="error">{error}</div>
          </section>
        ) : null}

        {loading && !bundle ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading dashboard data...</p>
          </section>
        ) : null}

        {viewModel && !viewModel.hasData ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">No data in the current scope and sample window.</p>
          </section>
        ) : null}

        {viewModel && bundle ? (
          <>
            <section className="fdInventorySummary" style={{ marginBottom: 14 }}>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Scope</div>
                <strong className="fdInventorySummaryValue">{viewModel.scopeLabel}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Sent</div>
                <strong className="fdInventorySummaryValue">{viewModel.cards.sent}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Failed</div>
                <strong className="fdInventorySummaryValue">{viewModel.cards.failed}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Retrying</div>
                <strong className="fdInventorySummaryValue">{viewModel.cards.retrying}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Skipped</div>
                <strong className="fdInventorySummaryValue">{viewModel.cards.skipped}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Channel Not Configured</div>
                <strong className="fdInventorySummaryValue">{viewModel.cards.channelNotConfigured}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Scheduled Status</div>
                <strong className="fdInventorySummaryValue">
                  <span
                    className="fdPillBtn"
                    style={getNotificationGovernanceToneStyle(resolveNotificationGovernanceTone(viewModel.cards.scheduledState))}
                  >
                    {formatStatusLabel(viewModel.cards.scheduledStatus)}
                  </span>
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Warnings</div>
                <strong className="fdInventorySummaryValue">{viewModel.warnings.length}</strong>
              </div>
            </section>

            {viewModel.warnings.length > 0 ? (
              <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
                <h2 className="sectionTitle">Warnings</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {viewModel.warnings.map((warning) => (
                    <p className="sub" key={warning} style={{ marginTop: 0 }}>
                      {warning}
                    </p>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">Scheduled Health</h2>
              <div className="actions" style={{ marginTop: 8 }}>
                <span
                  className="fdPillBtn"
                  style={getNotificationGovernanceToneStyle(resolveNotificationGovernanceTone(viewModel.scheduled.healthStatus))}
                >
                  {formatStatusLabel(viewModel.scheduled.healthStatus)}
                </span>
                <span className="fdPillBtn">Last scheduled: {toDateTime(viewModel.scheduled.lastScheduledAt)}</span>
                <span className="fdPillBtn">
                  Minutes since last run: {toMinutesLabel(viewModel.scheduled.minutesSinceLastScheduled)}
                </span>
              </div>
              {viewModel.scheduled.healthStatus === "stale" ? (
                <p className="sub" style={{ marginTop: 8, color: "#8b2020" }}>
                  Stale state detected. Scheduled samples are older than the configured stale threshold.
                </p>
              ) : null}
              {viewModel.scheduled.healthStatus === "no_runs" ? (
                <p className="sub" style={{ marginTop: 8 }}>
                  No scheduled samples found in current scope/window.
                </p>
              ) : null}
              <div className="fdDataGrid" style={{ marginTop: 10 }}>
                {Object.entries(viewModel.scheduled.byJobTypeLatest).map(([jobType, latest]) => (
                  <p key={jobType} className="sub" style={{ marginTop: 0 }}>
                    {jobType}: {formatStatusLabel(latest.status)} at {toDateTime(latest.createdAt)} (errors: {latest.errorCount})
                  </p>
                ))}
                {Object.keys(viewModel.scheduled.byJobTypeLatest).length === 0 ? (
                  <p className="fdGlassText">No scheduled job runs found.</p>
                ) : null}
              </div>
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Template Coverage</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  Coverage: {viewModel.coverage.templatePercent}% ({bundle.coverage.templateCoverage.coveredCombinations}/
                  {bundle.coverage.templateCoverage.expectedCombinations})
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Missing combinations: {bundle.coverage.templateCoverage.missingCombinations}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {viewModel.coverage.missingTemplates.map((item) => (
                    <p key={`${item.eventType}:${item.channel}`} className="sub" style={{ marginTop: 0 }}>
                      {item.eventType} / {item.channel}
                    </p>
                  ))}
                  {viewModel.coverage.missingTemplates.length === 0 ? (
                    <p className="fdGlassText">No missing template combinations.</p>
                  ) : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Preference Coverage</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  Coverage: {viewModel.coverage.preferencePercent}% (
                  {bundle.coverage.preferenceCoverage.configuredRoleEventPairs}/
                  {bundle.coverage.preferenceCoverage.expectedRoleEventPairs})
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Missing role/event pairs: {bundle.coverage.preferenceCoverage.missingRoleEventPairs}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {viewModel.coverage.missingPreferences.map((item) => (
                    <p key={`${item.role}:${item.eventType}`} className="sub" style={{ marginTop: 0 }}>
                      {item.role} / {item.eventType}
                    </p>
                  ))}
                  {viewModel.coverage.missingPreferences.length === 0 ? (
                    <p className="fdGlassText">No missing preference pairs.</p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="fdTwoCol">
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Retry Operations</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  Execute runs: {viewModel.retry.executeRuns} | Dry-run actions: {bundle.coverage.retryOperations.dryRunActions} |
                  Execute actions: {bundle.coverage.retryOperations.executeActions}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Focused status `{query.status}` count: {viewModel.retry.focusedStatusCount}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {viewModel.retry.executeByStatus.map(([status, count]) => (
                    <p key={status} className="sub" style={{ marginTop: 0 }}>
                      execute status {status}: {count}
                    </p>
                  ))}
                  {viewModel.retry.executeByStatus.length === 0 ? (
                    <p className="fdGlassText">No retry execute status data.</p>
                  ) : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Failures Overview</h2>
                <p className="sub" style={{ marginTop: 0 }}>Blocked reasons:</p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {viewModel.retry.blockedReasons.map(([reason, count]) => (
                    <p key={reason} className="sub" style={{ marginTop: 0 }}>
                      {reason}: {count}
                    </p>
                  ))}
                  {viewModel.retry.blockedReasons.length === 0 ? (
                    <p className="fdGlassText">No blocked reason samples.</p>
                  ) : null}
                </div>
                <p className="sub" style={{ marginTop: 8 }}>Provider error codes:</p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {viewModel.retry.providerErrors.map(([code, count]) => (
                    <p key={code} className="sub" style={{ marginTop: 0 }}>
                      {code}: {count}
                    </p>
                  ))}
                  {viewModel.retry.providerErrors.length === 0 ? (
                    <p className="fdGlassText">No provider error samples.</p>
                  ) : null}
                </div>
              </section>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
