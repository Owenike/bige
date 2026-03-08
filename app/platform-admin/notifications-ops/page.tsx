"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";

type OpsSummary = {
  jobRuns: number;
  deliveryRows: number;
  failed: number;
  retrying: number;
  sent: number;
  skipped: number;
  pending: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  external?: {
    total: number;
    sent: number;
    failed: number;
    retrying: number;
    skipped: number;
    pending: number;
    channelNotConfigured: number;
    byStatus: Record<string, number>;
    byChannel: Record<string, number>;
    providerErrors: Record<string, number>;
  };
};

type OpsRun = {
  id: string;
  tenant_id: string | null;
  job_type: string;
  trigger_mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  affected_count: number;
  error_count: number;
  error_summary: string | null;
};

type DeliveryRow = {
  id: string;
  tenant_id: string | null;
  channel: string;
  status: string;
  attempts: number;
  max_attempts?: number;
  last_attempt_at?: string | null;
  next_retry_at?: string | null;
  error_code: string | null;
  error_message: string | null;
  source_ref_type: string | null;
  source_ref_id: string | null;
  recipient_user_id: string | null;
  created_at: string;
};

type OpsPayload = {
  tenantId: string | null;
  summary: OpsSummary;
  runs: OpsRun[];
  failedDeliveries: DeliveryRow[];
  retryingDeliveries: DeliveryRow[];
};

type JobsResult = {
  results?: Array<{
    jobType: string;
    status: string;
    affectedCount: number;
    errorCount: number;
  }>;
};

function getError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: { message?: string } | string; message?: string };
  if (typeof value.error === "string" && value.error) return value.error;
  if (value.error && typeof value.error === "object" && typeof value.error.message === "string") return value.error.message;
  if (typeof value.message === "string" && value.message) return value.message;
  return fallback;
}

export default function PlatformNotificationsOpsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tenantScope, setTenantScope] = useState("");
  const [ops, setOps] = useState<OpsPayload | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const query = tenantScope.trim() ? `?tenantId=${encodeURIComponent(tenantScope.trim())}&limit=120` : "?limit=120";
    const res = await fetch(`/api/platform/notifications/ops${query}`);
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setError(getError(payload, zh ? "載入通知運維資料失敗" : "Failed to load notification ops data"));
      setLoading(false);
      return;
    }
    const data = (payload?.data || payload) as OpsPayload;
    setOps(data);
    setLoading(false);
  }

  async function runJobs() {
    setRunning(true);
    setError(null);
    setMessage(null);
    const body: Record<string, unknown> = {
      jobs: ["notification_sweep", "opportunity_sweep", "delivery_dispatch"],
    };
    if (tenantScope.trim()) body.tenantId = tenantScope.trim();
    const res = await fetch("/api/jobs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setError(getError(payload, zh ? "執行排程工作失敗" : "Failed to run jobs"));
      setRunning(false);
      return;
    }
    const data = (payload?.data || payload) as JobsResult;
    const resultText = (data.results || []).map((item) => `${item.jobType}:${item.status}`).join(" | ");
    setMessage(resultText || (zh ? "排程工作完成" : "Jobs completed"));
    await load();
    setRunning(false);
  }

  async function retryFailed() {
    setRunning(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/platform/notifications/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenantScope.trim() || null,
        includeFailed: true,
        limit: 500,
      }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setError(getError(payload, zh ? "重試派送失敗" : "Failed to retry dispatch"));
      setRunning(false);
      return;
    }
    const summary = payload?.data?.summary || payload?.summary || {};
    setMessage(
      zh
        ? `重試完成：處理 ${summary.processed || 0}，失敗 ${summary.failed || 0}`
        : `Retry completed: processed ${summary.processed || 0}, failed ${summary.failed || 0}`,
    );
    await load();
    setRunning(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "平台通知運維" : "PLATFORM NOTIFICATION OPS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              {zh ? "排程執行與派送追蹤" : "Scheduled Runs and Delivery Tracking"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "追蹤 sweep/job run、failed delivery，並執行手動重跑與重試。"
                : "Trace sweep/job runs, failed deliveries, and execute manual rerun/retry."}
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/platform-admin">
                {zh ? "返回平台首頁" : "Back to Platform Admin"}
              </Link>
            </div>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">{zh ? "操作" : "Operations"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <input
              className="input"
              value={tenantScope}
              onChange={(event) => setTenantScope(event.target.value)}
              placeholder={zh ? "tenantId（可留白看全域）" : "tenantId (optional)"}
            />
            <button type="button" className="fdPillBtn" disabled={loading} onClick={() => void load()}>
              {zh ? "載入摘要" : "Load Summary"}
            </button>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={running} onClick={() => void runJobs()}>
              {running ? (zh ? "執行中..." : "Running...") : zh ? "手動重跑 Jobs" : "Run Jobs"}
            </button>
            <button type="button" className="fdPillBtn" disabled={running} onClick={() => void retryFailed()}>
              {zh ? "重試失敗派送" : "Retry Failed"}
            </button>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">{zh ? "總覽" : "Summary"}</h2>
          {ops ? (
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "Scope" : "Scope"}: {ops.tenantId || (zh ? "全域" : "Global")}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "Job runs / Delivery rows" : "Job runs / Delivery rows"}: {ops.summary.jobRuns} / {ops.summary.deliveryRows}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "Sent / Failed / Retrying / Pending / Skipped" : "Sent / Failed / Retrying / Pending / Skipped"}:{" "}
                {ops.summary.sent} / {ops.summary.failed} / {ops.summary.retrying} / {ops.summary.pending} / {ops.summary.skipped}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "By Channel" : "By Channel"}:{" "}
                {Object.entries(ops.summary.byChannel || {}).map(([k, v]) => `${k}:${v}`).join(" | ") || "-"}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "External Sent / Failed / Retrying / Pending / Skipped" : "External Sent / Failed / Retrying / Pending / Skipped"}:{" "}
                {ops.summary.external?.sent || 0} / {ops.summary.external?.failed || 0} / {ops.summary.external?.retrying || 0} /{" "}
                {ops.summary.external?.pending || 0} / {ops.summary.external?.skipped || 0}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "Channel Not Configured / Provider Errors" : "Channel Not Configured / Provider Errors"}:{" "}
                {ops.summary.external?.channelNotConfigured || 0} /{" "}
                {Object.entries(ops.summary.external?.providerErrors || {})
                  .map(([k, v]) => `${k}:${v}`)
                  .join(" | ") || "-"}
              </p>
            </div>
          ) : (
            <p className="fdGlassText">{loading ? (zh ? "載入中..." : "Loading...") : "-"}</p>
          )}
        </section>

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "最近 Job Runs" : "Recent Job Runs"}</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {(ops?.runs || []).slice(0, 30).map((run) => (
                <p key={run.id} className="sub" style={{ marginTop: 0 }}>
                  {run.job_type} | {run.status} | {run.trigger_mode} | tenant:{run.tenant_id || "-"}
                </p>
              ))}
              {(ops?.runs || []).length === 0 ? <p className="fdGlassText">{zh ? "尚無資料。" : "No data."}</p> : null}
            </div>
          </section>
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "失敗 / 重試中派送" : "Failed / Retrying Deliveries"}</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {[...(ops?.failedDeliveries || []), ...(ops?.retryingDeliveries || [])].slice(0, 30).map((item) => (
                <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                  tenant:{item.tenant_id || "-"} | {item.channel} | {item.status} | attempts:{item.attempts}
                  {typeof item.max_attempts === "number" ? `/${item.max_attempts}` : ""} | {item.error_code || "-"} |{" "}
                  {(item.error_message || "-").slice(0, 120)}
                </p>
              ))}
              {(ops?.failedDeliveries || []).length + (ops?.retryingDeliveries || []).length === 0 ? (
                <p className="fdGlassText">{zh ? "目前沒有失敗或重試中派送。" : "No failed or retrying deliveries."}</p>
              ) : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
