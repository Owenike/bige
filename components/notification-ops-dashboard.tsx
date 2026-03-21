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
import { fetchApiJson } from "../lib/notification-productization-ui";
import NotificationGovernanceNav from "./notification-governance-nav";

type NotificationOpsDashboardProps = {
  mode: OpsDashboardMode;
};

type OpsRoutePayload = {
  tenantId: string | null;
  summary: {
    jobRuns: number;
    deliveryRows: number;
    failed: number;
    deadLetter: number;
    retrying: number;
    sent: number;
    skipped: number;
    pending?: number;
    byStatus: Record<string, number>;
    byChannel: Record<string, number>;
    external: {
      total: number;
      sent: number;
      failed: number;
      deadLetter: number;
      retrying: number;
      skipped: number;
      pending: number;
      channelNotConfigured: number;
      byStatus: Record<string, number>;
      byChannel: Record<string, number>;
      providerErrors: Record<string, number>;
    };
  };
  runs: Array<{
    id: string;
    job_type?: string;
    trigger_mode?: string;
    status: string;
    started_at?: string | null;
    finished_at?: string | null;
    affected_count?: number | null;
    error_count?: number | null;
    error_summary?: string | null;
    created_at?: string | null;
  }>;
  failedDeliveries: Array<{
    id: string;
    channel: string | null;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
  }>;
  retryingDeliveries: Array<{
    id: string;
    channel: string | null;
    next_retry_at: string | null;
    created_at: string;
  }>;
};

type OpsActionResult =
  | {
      action: "run_sweep";
      notificationGenerated?: number;
      opportunityInserted?: number;
    }
  | {
      action: "retry_deliveries";
      summary?: {
        processed: number;
        sent: number;
        failed: number;
        skipped: number;
        retrying: number;
        deadLetter: number;
      };
    };

type ManagerOpsAction = "run_sweep" | "retry_deliveries";

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

function toSortedEntries(record: Record<string, number>, take = 8) {
  return Object.entries(record || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, take);
}

function getOpsRouteBase(mode: OpsDashboardMode) {
  return mode === "platform" ? "/api/platform/notifications/ops" : "/api/manager/notifications/ops";
}

export default function NotificationOpsDashboard(props: NotificationOpsDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => parseOpsDashboardQuery(searchParams, props.mode), [searchParams, props.mode]);
  const [bundle, setBundle] = useState<OpsDashboardBundle | null>(null);
  const [opsRoute, setOpsRoute] = useState<OpsRoutePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<ManagerOpsAction | null>(null);
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
    void Promise.all([
      fetchOpsDashboardBundle({
        mode: props.mode,
        query: {
          tenantId: query.tenantId,
          limit: query.limit,
          staleAfterMinutes: query.staleAfterMinutes,
          status: query.status,
        },
      }),
      fetchApiJson<OpsRoutePayload>(
        `${getOpsRouteBase(props.mode)}?${new URLSearchParams(
          props.mode === "platform" && query.tenantId
            ? { tenantId: query.tenantId, limit: String(Math.min(query.limit, 200)) }
            : { limit: String(Math.min(query.limit, props.mode === "platform" ? 200 : 80)) },
        ).toString()}`,
        { cache: "no-store" },
      ),
    ]).then(([bundleResult, opsResult]) => {
      if (!active) return;
      if (!bundleResult.ok) {
        setError(bundleResult.message);
        setLoading(false);
        return;
      }
      if (!opsResult.ok) {
        setError(opsResult.message);
        setLoading(false);
        return;
      }
      setBundle(bundleResult.bundle);
      setOpsRoute(opsResult.data);
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

  async function runManagerAction(action: ManagerOpsAction) {
    if (props.mode !== "manager") return;
    setBusyAction(action);
    setError(null);
    setMessage(null);
    const result = await fetchApiJson<OpsActionResult>("/api/manager/notifications/ops", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        action === "retry_deliveries"
          ? {
              action,
              limit: 120,
            }
          : { action },
      ),
    });
    if (!result.ok) {
      setError(result.message);
      setBusyAction(null);
      return;
    }
    if (action === "run_sweep") {
      const payload = result.data as Extract<OpsActionResult, { action: "run_sweep" }>;
      setMessage(
        `Sweep completed: notifications ${payload.notificationGenerated || 0}, opportunities ${payload.opportunityInserted || 0}.`,
      );
    } else {
      const payload = result.data as Extract<OpsActionResult, { action: "retry_deliveries" }>;
      setMessage(
        `Retry batch completed: processed ${payload.summary?.processed || 0}, sent ${payload.summary?.sent || 0}, failed ${payload.summary?.failed || 0}.`,
      );
    }
    setRefreshKey((current) => current + 1);
    setBusyAction(null);
  }

  return (
    <main className="fdGlassScene" data-notifications-ops-page>
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{props.mode === "platform" ? "PLATFORM OPS" : "TENANT OPS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Notification Ops / Scheduled Health
            </h1>
            <p className="fdGlassText">
              This page owns recent runs, scheduled health, external delivery summary, and manager-level batch ops.
              It does not own row-level retry, notification history, readiness diagnostics, or template/preference
              maintenance.
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href={props.mode === "platform" ? "/platform-admin" : "/manager"}>
                Back
              </Link>
              <button
                type="button"
                className="fdPillBtn"
                onClick={() => setRefreshKey((current) => current + 1)}
                disabled={loading}
                data-notifications-ops-refresh
              >
                Refresh
              </button>
            </div>
          </div>
        </section>
        <NotificationGovernanceNav mode={props.mode} />

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-notifications-ops-filters>
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
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-notifications-ops-error>
            <div className="error">{error}</div>
          </section>
        ) : null}

        {message ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-notifications-ops-message>
            <div className="sub" style={{ marginTop: 0, color: "#0f5132" }}>{message}</div>
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

        {viewModel && bundle && opsRoute ? (
          <>
            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-notifications-ops-differences>
              <h2 className="sectionTitle">Responsibility split</h2>
              <div className="fdThreeCol" style={{ gap: 12, marginTop: 8 }}>
                <section className="fdGlassSubPanel" style={{ padding: 12 }}>
                  <div className="kvLabel">/manager/notifications</div>
                  <p className="sub" style={{ marginTop: 8 }}>
                    Owns overview + notification workbench landing. It summarizes delivery health, readiness, coverage,
                    and top-level workbench entry points.
                  </p>
                  <p className="sub" style={{ marginTop: 8 }}>
                    It does not own scheduled health detail, recent run analysis, or manager-level batch sweep history.
                  </p>
                </section>
                <section className="fdGlassSubPanel" style={{ padding: 12 }}>
                  <div className="kvLabel">/manager/notification-retry</div>
                  <p className="sub" style={{ marginTop: 8 }}>
                    Owns failed / retrying deliveries, single retry, and remediation queue decisions.
                  </p>
                  <p className="sub" style={{ marginTop: 8 }}>
                    It does not own scheduled health summary or external delivery run reporting. Batch retry here stays
                    subordinate to row-level remediation.
                  </p>
                </section>
                <section className="fdGlassSubPanel" style={{ padding: 12 }}>
                  <div className="kvLabel">/manager/notifications-ops</div>
                  <p className="sub" style={{ marginTop: 8 }}>
                    Owns recent runs, scheduled health, external delivery summary, and manager-level batch ops such as
                    sweep and retry batch execution.
                  </p>
                  <p className="sub" style={{ marginTop: 8 }}>
                    It does not own row-level retry, remediation queue, or the integrations catalog.
                  </p>
                </section>
              </div>
            </section>

            <section className="fdInventorySummary" style={{ marginBottom: 14 }} data-notifications-ops-summary>
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

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-notifications-ops-scheduled-health>
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
                <h2 className="sectionTitle">Manager-level ops actions</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  Batch actions here are ops-layer only. Row-level retry stays in `/manager/notification-retry`.
                </p>
                {props.mode === "manager" ? (
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="fdPillBtn fdPillBtnPrimary"
                      onClick={() => void runManagerAction("run_sweep")}
                      disabled={busyAction !== null}
                      data-notifications-ops-run-sweep
                    >
                      {busyAction === "run_sweep" ? "Running..." : "Run sweep"}
                    </button>
                    <button
                      type="button"
                      className="fdPillBtn"
                      onClick={() => void runManagerAction("retry_deliveries")}
                      disabled={busyAction !== null}
                      data-notifications-ops-retry-batch
                    >
                      {busyAction === "retry_deliveries" ? "Retrying..." : "Retry failed batch"}
                    </button>
                  </div>
                ) : (
                  <p className="fdGlassText" style={{ marginTop: 8 }}>
                    Platform view remains read-only. Manager-level batch actions are not exposed here.
                  </p>
                )}
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-ops-external-summary>
                <h2 className="sectionTitle">External Delivery Summary</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  External total: {opsRoute.summary.external.total} | sent: {opsRoute.summary.external.sent} | failed:{" "}
                  {opsRoute.summary.external.failed}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Retrying: {opsRoute.summary.external.retrying} | pending: {opsRoute.summary.external.pending} | channel not configured:{" "}
                  {opsRoute.summary.external.channelNotConfigured}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {toSortedEntries(opsRoute.summary.external.byChannel).map(([channel, count]) => (
                    <p key={channel} className="sub" style={{ marginTop: 0 }}>
                      {channel}: {count}
                    </p>
                  ))}
                  {toSortedEntries(opsRoute.summary.external.byChannel).length === 0 ? (
                    <p className="fdGlassText">No external delivery samples.</p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-ops-recent-runs>
                <h2 className="sectionTitle">Recent Runs / Sweep History</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {opsRoute.runs.slice(0, 8).map((run) => (
                    <p key={run.id} className="sub" style={{ marginTop: 0 }}>
                      {(run.job_type || "job").replaceAll("_", " ")} / {formatStatusLabel(run.status)} / started{" "}
                      {toDateTime(run.started_at || run.created_at || null)} / affected {run.affected_count || 0} / errors{" "}
                      {run.error_count || 0}
                    </p>
                  ))}
                  {opsRoute.runs.length === 0 ? <p className="fdGlassText">No recent runs found.</p> : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">External Failure Signals</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  Failed rows: {opsRoute.failedDeliveries.length} | retrying rows: {opsRoute.retryingDeliveries.length}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {opsRoute.failedDeliveries.slice(0, 4).map((item) => (
                    <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                      failed / {item.channel || "unknown"} / {item.error_code || "runtime_error"} / {toDateTime(item.created_at)}
                    </p>
                  ))}
                  {opsRoute.retryingDeliveries.slice(0, 4).map((item) => (
                    <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                      retrying / {item.channel || "unknown"} / next retry {toDateTime(item.next_retry_at)} 
                    </p>
                  ))}
                  {opsRoute.failedDeliveries.length === 0 && opsRoute.retryingDeliveries.length === 0 ? (
                    <p className="fdGlassText">No failed or retrying samples in this snapshot.</p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="fdTwoCol">
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Scheduled / Batch Status Mix</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  Job runs: {opsRoute.summary.jobRuns} | delivery rows: {opsRoute.summary.deliveryRows}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {toSortedEntries(opsRoute.summary.byStatus, 8).map(([status, count]) => (
                    <p key={status} className="sub" style={{ marginTop: 0 }}>
                      {status}: {count}
                    </p>
                  ))}
                  {toSortedEntries(opsRoute.summary.byStatus, 8).length === 0 ? (
                    <p className="fdGlassText">No status distribution available.</p>
                  ) : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Provider / Blocking Signals</h2>
                <p className="sub" style={{ marginTop: 0 }}>Provider error codes:</p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {toSortedEntries(opsRoute.summary.external.providerErrors).map(([code, count]) => (
                    <p key={code} className="sub" style={{ marginTop: 0 }}>
                      {code}: {count}
                    </p>
                  ))}
                  {toSortedEntries(opsRoute.summary.external.providerErrors).length === 0 ? (
                    <p className="fdGlassText">No provider error samples.</p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-notifications-ops-boundaries>
              <h2 className="sectionTitle">Responsibility boundaries</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  This page owns scheduled health, recent runs, external delivery summary, and manager-level batch ops.
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Notifications overview remains the landing page for cross-domain summary and workbench entry.
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Notification retry remains responsible for row-level retry and remediation queue work.
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Integrations keeps the integration catalog and external boundary overview, not recent ops run analysis.
                </p>
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-notifications-ops-out-of-scope>
              <h2 className="sectionTitle">Out of scope for this page</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  Auth, activation, provider credentials, OAuth, webhook setup, and queue / worker control center.
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Row-level retry decisions, remediation queue orchestration, and notification history / audit detail.
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Template, preference, readiness, preflight, or runtime-readiness maintenance pages.
                </p>
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
