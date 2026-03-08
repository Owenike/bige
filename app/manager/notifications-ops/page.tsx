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
  job_type: string;
  trigger_mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  affected_count: number;
  error_count: number;
  error_summary: string | null;
};

type FailedDelivery = {
  id: string;
  channel: string;
  status: string;
  attempts: number;
  max_attempts?: number;
  last_attempt_at?: string | null;
  next_retry_at?: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  recipient_user_id: string | null;
  source_ref_type: string | null;
  source_ref_id: string | null;
};

type OpsPayload = {
  summary: OpsSummary;
  runs: OpsRun[];
  failedDeliveries: FailedDelivery[];
  retryingDeliveries: FailedDelivery[];
};

type ActionResultPayload = {
  summary?: {
    processed: number;
    sent: number;
    skipped: number;
    failed: number;
    retrying: number;
  };
  notificationGenerated?: number;
  opportunityInserted?: number;
};

function getError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: { message?: string } | string; message?: string };
  if (typeof value.error === "string" && value.error) return value.error;
  if (value.error && typeof value.error === "object" && typeof value.error.message === "string") return value.error.message;
  if (typeof value.message === "string" && value.message) return value.message;
  return fallback;
}

export default function ManagerNotificationsOpsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ops, setOps] = useState<OpsPayload | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/manager/notifications/ops?limit=80");
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setError(getError(payload, zh ? "載入通知運維摘要失敗" : "Failed to load notification ops"));
      setLoading(false);
      return;
    }
    const data = (payload?.data || payload) as OpsPayload;
    setOps(data);
    setLoading(false);
  }

  async function runAction(action: "run_sweep" | "retry_deliveries") {
    setRunning(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/manager/notifications/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setError(getError(payload, zh ? "執行通知運維操作失敗" : "Failed to execute notification ops action"));
      setRunning(false);
      return;
    }
    const data = (payload?.data || payload) as ActionResultPayload;
    if (action === "run_sweep") {
      setMessage(
        zh
          ? `掃描完成：通知 ${data.notificationGenerated || 0}，機會 ${data.opportunityInserted || 0}`
          : `Sweep completed: notifications ${data.notificationGenerated || 0}, opportunities ${data.opportunityInserted || 0}`,
      );
    } else {
      setMessage(
        zh
          ? `重試完成：處理 ${data.summary?.processed || 0}，失敗 ${data.summary?.failed || 0}`
          : `Retry completed: processed ${data.summary?.processed || 0}, failed ${data.summary?.failed || 0}`,
      );
    }
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
            <div className="fdEyebrow">{zh ? "通知運維" : "NOTIFICATION OPS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              {zh ? "通知排程與派送追蹤" : "Notification Jobs and Delivery Tracking"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "查看最近通知 job run、失敗派送，並執行租戶範圍掃描與重試。"
                : "Review recent notification job runs, failed deliveries, and execute tenant-scoped sweep/retry."}
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/manager">
                {zh ? "返回管理首頁" : "Back to Manager"}
              </Link>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={running} onClick={() => void runAction("run_sweep")}>
                {running ? (zh ? "執行中..." : "Running...") : zh ? "執行掃描" : "Run Sweep"}
              </button>
              <button type="button" className="fdPillBtn" disabled={running} onClick={() => void runAction("retry_deliveries")}>
                {zh ? "重試失敗派送" : "Retry Failed Deliveries"}
              </button>
              <button type="button" className="fdPillBtn" disabled={loading} onClick={() => void load()}>
                {zh ? "重新整理" : "Refresh"}
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">{zh ? "總覽" : "Summary"}</h2>
          {ops ? (
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "Job runs / Delivery rows" : "Job runs / Delivery rows"}: {ops.summary.jobRuns} / {ops.summary.deliveryRows}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "Sent / Failed / Retrying / Pending" : "Sent / Failed / Retrying / Pending"}:{" "}
                {ops.summary.sent} / {ops.summary.failed} / {ops.summary.retrying} / {ops.summary.byStatus.pending || 0}
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
              {(ops?.runs || []).slice(0, 20).map((run) => (
                <p key={run.id} className="sub" style={{ marginTop: 0 }}>
                  {run.job_type} | {run.trigger_mode} | {run.status} | {run.affected_count}/{run.error_count}
                </p>
              ))}
              {(ops?.runs || []).length === 0 ? <p className="fdGlassText">{zh ? "尚無資料。" : "No data."}</p> : null}
            </div>
          </section>
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "失敗 / 重試中派送" : "Failed / Retrying Deliveries"}</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {[...(ops?.failedDeliveries || []), ...(ops?.retryingDeliveries || [])].slice(0, 20).map((item) => (
                <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                  {item.channel} | {item.status} | attempts:{item.attempts}
                  {typeof item.max_attempts === "number" ? `/${item.max_attempts}` : ""} | {item.error_code || "-"} |{" "}
                  {(item.error_message || "-").slice(0, 120)} | {item.source_ref_type}:{item.source_ref_id || "-"}
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
