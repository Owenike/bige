"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  fetchApiJson,
  type NotificationChannelKey,
  type NotificationRetryExecuteResult,
  type NotificationRetryPlanResult,
} from "../../../lib/notification-productization-ui";

const STATUS_OPTIONS = ["failed", "retrying"] as const;

function buildStatuses(selected: string[]) {
  return selected.filter((item) => STATUS_OPTIONS.includes(item as (typeof STATUS_OPTIONS)[number]));
}

export default function PlatformNotificationRetryPage() {
  const [tenantId, setTenantId] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [eventType, setEventType] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>(["failed", "retrying"]);
  const [channelFilters, setChannelFilters] = useState<string[]>([]);
  const [limit, setLimit] = useState("200");

  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [plan, setPlan] = useState<NotificationRetryPlanResult | null>(null);
  const [dryRunResult, setDryRunResult] = useState<NotificationRetryExecuteResult | null>(null);
  const [executeResult, setExecuteResult] = useState<NotificationRetryExecuteResult | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const retryableIds = useMemo(
    () => (plan?.candidates || []).filter((item) => item.decision.eligible).map((item) => item.id),
    [plan],
  );

  function resetFilters() {
    setTenantId("");
    setDeliveryId("");
    setEventType("");
    setStatusFilters(["failed", "retrying"]);
    setChannelFilters([]);
    setLimit("200");
  }

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  function toggleArrayValue(value: string, current: string[], setValue: (next: string[]) => void) {
    if (current.includes(value)) setValue(current.filter((item) => item !== value));
    else setValue([...current, value]);
  }

  async function loadPlan() {
    setLoading(true);
    resetFeedback();
    setDryRunResult(null);
    setExecuteResult(null);

    const query = new URLSearchParams();
    query.set("includeRows", "true");
    query.set("limit", limit.trim() || "200");
    const tenant = tenantId.trim();
    if (tenant) query.set("tenantId", tenant);
    const delivery = deliveryId.trim();
    if (delivery) query.set("deliveryId", delivery);
    if (eventType) query.set("eventType", eventType);
    const safeStatuses = buildStatuses(statusFilters);
    if (safeStatuses.length > 0) query.set("statuses", safeStatuses.join(","));
    if (channelFilters.length > 0) query.set("channels", channelFilters.join(","));

    const result = await fetchApiJson<NotificationRetryPlanResult>(`/api/platform/notifications/retry?${query.toString()}`);
    if (!result.ok) {
      setError(result.message);
      setLoading(false);
      return;
    }
    setPlan(result.data);
    setMessage("Retry plan loaded");
    setLoading(false);
  }

  async function run(action: "dry_run" | "execute") {
    setRunning(true);
    resetFeedback();
    if (action === "execute") setExecuteResult(null);
    if (action === "dry_run") setDryRunResult(null);

    const payload = {
      action,
      tenantId: tenantId.trim() || null,
      deliveryIds: retryableIds,
      statuses: buildStatuses(statusFilters),
      channels: channelFilters as NotificationChannelKey[],
      eventType: eventType || undefined,
      limit: Number(limit || "200"),
    };

    const result = await fetchApiJson<NotificationRetryExecuteResult>("/api/platform/notifications/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!result.ok) {
      setError(result.message);
      setRunning(false);
      return;
    }

    if (action === "dry_run") setDryRunResult(result.data);
    else setExecuteResult(result.data);
    setMessage(`${action} completed`);
    await loadPlan();
    setRunning(false);
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">NOTIFICATION PRODUCTIZATION</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 32 }}>Platform Notification Retry</h1>
            <p className="fdGlassText">查詢、dry-run、execute 的可操作版本。</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/platform-admin">Back</Link>
            </div>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Query Filters</h2>
          <p className="sub">Platform 可跨 tenant 查詢與重試；execute 前需確認字串。</p>
          <div className="fdDataGrid">
            <label className="sub">
              tenant_id (optional)
              <input className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)} />
            </label>
            <label className="sub">
              delivery_id (optional)
              <input className="input" value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)} />
            </label>
            <label className="sub">
              event_key (optional)
              <select className="input" value={eventType} onChange={(event) => setEventType(event.target.value)}>
                <option value="">(all)</option>
                {NOTIFICATION_EVENT_KEYS.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </label>
            <label className="sub">
              limit
              <input className="input" value={limit} onChange={(event) => setLimit(event.target.value)} />
            </label>
            <div className="sub">status</div>
            <div className="actions">
              {STATUS_OPTIONS.map((status) => (
                <label key={status} className="sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={statusFilters.includes(status)}
                    onChange={() => toggleArrayValue(status, statusFilters, setStatusFilters)}
                  />
                  {status}
                </label>
              ))}
            </div>
            <div className="sub">channel</div>
            <div className="actions">
              {NOTIFICATION_CHANNEL_KEYS.map((channel) => (
                <label key={channel} className="sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={channelFilters.includes(channel)}
                    onChange={() => toggleArrayValue(channel, channelFilters, setChannelFilters)}
                  />
                  {channel}
                </label>
              ))}
            </div>
            <div className="actions">
              <button type="button" className="fdPillBtn" disabled={loading} onClick={() => void loadPlan()}>
                {loading ? "Loading..." : "Load Retry Plan"}
              </button>
              <button type="button" className="fdPillBtn" onClick={resetFilters}>
                Reset Filters
              </button>
              <button type="button" className="fdPillBtn" disabled={running || !plan} onClick={() => void run("dry_run")}>
                Dry Run
              </button>
              <input className="input" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="Type EXECUTE" />
              <button
                type="button"
                className="fdPillBtn fdPillBtnPrimary"
                disabled={running || !plan || confirmText !== "EXECUTE"}
                onClick={() => void run("execute")}
              >
                {running ? "Running..." : "Execute"}
              </button>
            </div>
          </div>
        </section>

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Retry Plan</h2>
            {!plan ? <p className="sub">No plan loaded.</p> : (
              <div className="fdDataGrid">
                <p className="sub">total: {plan.summary.totalCandidates}</p>
                <p className="sub">retryable: {plan.summary.retryable}</p>
                <p className="sub">blocked: {plan.summary.blocked}</p>
                <p className="sub">failed/retrying: {plan.summary.failed}/{plan.summary.retrying}</p>
                <p className="sub">byDecision: {Object.entries(plan.summary.byDecisionCode || {}).map(([key, value]) => `${key}:${value}`).join(" | ") || "-"}</p>
                <p className="sub">byError: {Object.entries(plan.summary.byErrorCode || {}).map(([key, value]) => `${key}:${value}`).join(" | ") || "-"}</p>
              </div>
            )}
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Dry-run / Execute Result</h2>
            {!dryRunResult && !executeResult ? <p className="sub">No action result yet.</p> : null}
            {dryRunResult ? (
              <div className="fdDataGrid">
                <p className="sub"><b>dry_run</b> retryable: {dryRunResult.retryableCount || 0}</p>
                <p className="sub">blocked: {dryRunResult.blockedCount || 0}</p>
              </div>
            ) : null}
            {executeResult ? (
              <div className="fdDataGrid">
                <p className="sub"><b>execute</b> retried: {executeResult.retriedCount || 0}</p>
                <p className="sub">blocked: {executeResult.blockedCount || 0}</p>
                <p className="sub">summary: sent {executeResult.summary?.sent || 0}, failed {executeResult.summary?.failed || 0}, retrying {executeResult.summary?.retrying || 0}</p>
              </div>
            ) : null}
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">Candidates</h2>
          {!plan || !plan.candidates || plan.candidates.length === 0 ? <p className="sub">No candidates.</p> : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>id</th>
                    <th>channel</th>
                    <th>status</th>
                    <th>attempts</th>
                    <th>error</th>
                    <th>decision</th>
                    <th>reason</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.candidates.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id.slice(0, 10)}...</td>
                      <td>{item.channel}</td>
                      <td>{item.status}</td>
                      <td>{item.attempts}/{item.max_attempts}</td>
                      <td>{item.error_code || "-"}</td>
                      <td>{item.decision.code}</td>
                      <td>{item.decision.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
