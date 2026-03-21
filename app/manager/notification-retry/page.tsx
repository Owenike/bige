"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "../notifications/notifications.module.css";
import ManagerNotificationsDomainNav from "../../../components/manager-notifications-domain-nav";
import {
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  clampRetryLimit,
  fetchApiJson,
  parseCsvInput,
  type NotificationChannelKey,
  type NotificationRetryExecuteResult,
  type NotificationRetryPlanResult,
} from "../../../lib/notification-productization-ui";
import type {
  NotificationRemediationActionSummary,
  NotificationRemediationItem,
  NotificationRemediationSummary,
} from "../../../types/notification-coverage";

const STATUS_OPTIONS = ["failed", "retrying"] as const;

type Feedback = { type: "success" | "error"; message: string };

type RemediationPayload = {
  summary: NotificationRemediationSummary;
  items: NotificationRemediationItem[];
};

type RemediationResendPayload = {
  summary: NotificationRemediationActionSummary;
  historyPersisted: boolean;
  historyError: string | null;
};

function buildStatuses(selected: string[]) {
  return selected.filter((item) => STATUS_OPTIONS.includes(item as (typeof STATUS_OPTIONS)[number]));
}

function statusBadge(status: string) {
  if (status === "failed" || status === "dead_letter") return `${styles.badge} ${styles.statusFailed}`;
  if (status === "retrying") return `${styles.badge} ${styles.statusRetrying}`;
  if (status === "sent") return `${styles.badge} ${styles.statusSent}`;
  if (status === "cancelled") return `${styles.badge} ${styles.statusCancelled}`;
  if (status === "skipped") return `${styles.badge} ${styles.statusSkipped}`;
  return `${styles.badge} ${styles.statusPending}`;
}

export default function ManagerNotificationRetryPage() {
  const [deliveryId, setDeliveryId] = useState("");
  const [eventType, setEventType] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>(["failed", "retrying"]);
  const [channelFilters, setChannelFilters] = useState<string[]>([]);
  const [limit, setLimit] = useState("200");

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [plan, setPlan] = useState<NotificationRetryPlanResult | null>(null);
  const [remediation, setRemediation] = useState<RemediationPayload | null>(null);
  const [dryRunResult, setDryRunResult] = useState<NotificationRetryExecuteResult | null>(null);
  const [executeResult, setExecuteResult] = useState<NotificationRetryExecuteResult | null>(null);
  const [resendResult, setResendResult] = useState<NotificationRemediationActionSummary | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextDeliveryId = params.get("deliveryId");
    const nextEventType = params.get("eventType");
    const nextLimit = params.get("limit");
    const nextStatuses = parseCsvInput(params.get("statuses"));
    const nextChannels = parseCsvInput(params.get("channels"));
    if (nextDeliveryId) setDeliveryId(nextDeliveryId);
    if (nextEventType) setEventType(nextEventType);
    if (nextLimit) setLimit(nextLimit);
    if (nextStatuses.length > 0) setStatusFilters(nextStatuses);
    if (nextChannels.length > 0) setChannelFilters(nextChannels);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (deliveryId.trim()) params.set("deliveryId", deliveryId.trim());
    else params.delete("deliveryId");
    if (eventType) params.set("eventType", eventType);
    else params.delete("eventType");
    params.set("limit", limit.trim() || "200");
    if (statusFilters.length > 0) params.set("statuses", statusFilters.join(","));
    else params.delete("statuses");
    if (channelFilters.length > 0) params.set("channels", channelFilters.join(","));
    else params.delete("channels");
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [deliveryId, eventType, statusFilters, channelFilters, limit]);

  const retryableIds = useMemo(
    () => (plan?.candidates || []).filter((item) => item.decision.eligible).map((item) => item.id),
    [plan],
  );

  const resendableIds = useMemo(
    () => (remediation?.items || []).filter((item) => item.canResendNow).map((item) => item.deliveryId),
    [remediation],
  );

  async function loadWorkbench() {
    setLoading(true);
    setFeedback(null);
    try {
      const query = new URLSearchParams();
      query.set("includeRows", "true");
      query.set("limit", String(clampRetryLimit(limit)));
      const trimmedDeliveryId = deliveryId.trim();
      if (trimmedDeliveryId) query.set("deliveryId", trimmedDeliveryId);
      if (eventType) query.set("eventType", eventType);
      const safeStatuses = buildStatuses(statusFilters);
      if (safeStatuses.length > 0) query.set("statuses", safeStatuses.join(","));
      if (channelFilters.length > 0) query.set("channels", channelFilters.join(","));

      const [planResult, remediationResult] = await Promise.all([
        fetchApiJson<NotificationRetryPlanResult>(`/api/manager/notifications/retry?${query.toString()}`),
        fetchApiJson<RemediationPayload>("/api/manager/notifications/remediation?limit=40"),
      ]);

      if (!planResult.ok) {
        setFeedback({ type: "error", message: planResult.message });
        setPlan(null);
      } else {
        setPlan(planResult.data);
      }

      if (!remediationResult.ok) {
        setFeedback({ type: "error", message: remediationResult.message });
        setRemediation(null);
      } else {
        setRemediation(remediationResult.data);
      }

      if (planResult.ok && remediationResult.ok) {
        setFeedback({ type: "success", message: "Retry workbench loaded." });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkbench();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetFilters() {
    setDeliveryId("");
    setEventType("");
    setStatusFilters(["failed", "retrying"]);
    setChannelFilters([]);
    setLimit("200");
  }

  function toggleArrayValue(value: string, current: string[], setValue: (next: string[]) => void) {
    if (current.includes(value)) setValue(current.filter((item) => item !== value));
    else setValue([...current, value]);
  }

  async function runRetry(action: "dry_run" | "execute") {
    setRunning(action);
    setFeedback(null);
    if (action === "dry_run") setDryRunResult(null);
    else setExecuteResult(null);

    const result = await fetchApiJson<NotificationRetryExecuteResult>("/api/manager/notifications/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        deliveryIds: retryableIds,
        statuses: buildStatuses(statusFilters),
        channels: channelFilters as NotificationChannelKey[],
        eventType: eventType || undefined,
        limit: clampRetryLimit(limit),
      }),
    });

    if (!result.ok) {
      setFeedback({ type: "error", message: result.message });
      setRunning(null);
      return;
    }

    if (action === "dry_run") {
      setDryRunResult(result.data);
      setFeedback({ type: "success", message: "Dry run completed." });
    } else {
      setExecuteResult(result.data);
      setConfirmText("");
      setFeedback({ type: "success", message: "Retry execute completed." });
    }

    await loadWorkbench();
    setRunning(null);
  }

  async function runSingleRetry(targetId: string) {
    setRunning(`single:${targetId}`);
    setFeedback(null);
    const result = await fetchApiJson<{ summary?: { processed?: number; sent?: number; failed?: number; retrying?: number } }>(
      `/api/manager/notifications/${targetId}/retry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!result.ok) {
      setFeedback({ type: "error", message: result.message });
      setRunning(null);
      return;
    }
    setFeedback({ type: "success", message: `Single retry requested: ${targetId}` });
    await loadWorkbench();
    setRunning(null);
  }

  async function runBulkResend() {
    setRunning("resend");
    setFeedback(null);
    setResendResult(null);
    const result = await fetchApiJson<RemediationResendPayload>("/api/manager/notifications/remediation/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliveryIds: resendableIds.slice(0, 20),
      }),
    });
    if (!result.ok) {
      setFeedback({ type: "error", message: result.message });
      setRunning(null);
      return;
    }
    setResendResult(result.data.summary);
    setFeedback({
      type: "success",
      message: `Bulk resend completed: requested ${result.data.summary.requested}, succeeded ${result.data.summary.succeeded}.`,
    });
    await loadWorkbench();
    setRunning(null);
  }

  return (
    <main className={styles.page} data-notification-retry-page>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Notification Retry / Remediation</div>
          <h1 className={styles.title}>Retry / Remediation Workbench</h1>
          <p className={styles.subtitle}>
            This page owns failed and retrying delivery remediation. It handles retry planning, single retry, and
            resendable remediation candidates. It does not manage provider credentials, auth, queues, or frontdesk flows.
          </p>
          <div className={styles.actions}>
            <Link className={styles.ghost} href="/manager/notifications">Back to notifications</Link>
            <Link className={styles.ghost} href="/manager/integrations">Integrations boundary</Link>
            <Link className={styles.ghost} href="/manager/settings/operations">Operations boundary</Link>
            <button className={styles.action} type="button" onClick={() => void loadWorkbench()} disabled={loading} data-notification-retry-refresh>
              {loading ? "Loading..." : "Refresh workbench"}
            </button>
          </div>
        </section>

        <ManagerNotificationsDomainNav />

        {feedback?.type === "error" ? <div className={styles.error} data-notification-retry-error>{feedback.message}</div> : null}
        {feedback?.type === "success" ? <div className={styles.success} data-notification-retry-message>{feedback.message}</div> : null}

        <section className={styles.cardGrid}>
          <article className={styles.card}><div className={styles.cardLabel}>Candidates</div><div className={styles.cardValue} data-notification-retry-total>{plan?.summary.totalCandidates ?? 0}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Retryable now</div><div className={styles.cardValue} data-notification-retry-retryable>{plan?.summary.retryable ?? 0}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Blocked</div><div className={styles.cardValue}>{plan?.summary.blocked ?? 0}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Remediable now</div><div className={styles.cardValue} data-notification-retry-remediable>{remediation?.summary.remediableNow ?? 0}</div></article>
        </section>

        <section className={styles.panel}>
          <div className={styles.listMeta}>
            <h2 className={styles.sectionTitle}>Retry query</h2>
            <span className={styles.muted}>Use dry-run before execute. Execute requires confirm text EXECUTE.</span>
          </div>
          <div className={styles.toolbar}>
            <div className={styles.field}>
              <label>delivery_id</label>
              <input className={styles.input} value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)} data-notification-retry-delivery-id />
            </div>
            <div className={styles.field}>
              <label>event_key</label>
              <select className={styles.select} value={eventType} onChange={(event) => setEventType(event.target.value)} data-notification-retry-event>
                <option value="">All</option>
                {NOTIFICATION_EVENT_KEYS.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>limit</label>
              <input className={styles.input} value={limit} onChange={(event) => setLimit(event.target.value)} data-notification-retry-limit />
            </div>
          </div>
          <div className={styles.readinessGrid}>
            <section className={styles.card}>
              <div className={styles.cardLabel}>Status filters</div>
              <div className={styles.actions}>
                {STATUS_OPTIONS.map((status) => (
                  <label key={status} className={styles.pill}>
                    <input
                      type="checkbox"
                      checked={statusFilters.includes(status)}
                      onChange={() => toggleArrayValue(status, statusFilters, setStatusFilters)}
                    />{" "}
                    {status}
                  </label>
                ))}
              </div>
            </section>
            <section className={styles.card}>
              <div className={styles.cardLabel}>Channel filters</div>
              <div className={styles.actions}>
                {NOTIFICATION_CHANNEL_KEYS.map((channel) => (
                  <label key={channel} className={styles.pill}>
                    <input
                      type="checkbox"
                      checked={channelFilters.includes(channel)}
                      onChange={() => toggleArrayValue(channel, channelFilters, setChannelFilters)}
                    />{" "}
                    {channel}
                  </label>
                ))}
              </div>
            </section>
          </div>
          <div className={styles.actions}>
            <button className={styles.action} type="button" onClick={() => void loadWorkbench()} disabled={loading} data-notification-retry-load-plan>
              {loading ? "Loading..." : "Load retry workbench"}
            </button>
            <button className={styles.ghost} type="button" onClick={resetFilters}>Reset filters</button>
            <button className={styles.ghost} type="button" onClick={() => void runRetry("dry_run")} disabled={running !== null} data-notification-retry-dry-run>
              {running === "dry_run" ? "Running..." : "Dry run"}
            </button>
            <input className={styles.input} value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="Type EXECUTE" data-notification-retry-confirm />
            <button
              className={styles.action}
              type="button"
              onClick={() => void runRetry("execute")}
              disabled={running !== null || confirmText !== "EXECUTE"}
              data-notification-retry-execute
            >
              {running === "execute" ? "Executing..." : "Execute retry"}
            </button>
            <button
              className={styles.ghost}
              type="button"
              onClick={() => void runBulkResend()}
              disabled={running !== null || resendableIds.length === 0}
              data-notification-retry-remediation
            >
              {running === "resend" ? "Resending..." : "Bulk resend remediable"}
            </button>
          </div>
        </section>

        <section className={styles.cardGrid}>
          <article className={styles.card} data-notification-retry-run-summary>
            <div className={styles.cardLabel}>Retry plan summary</div>
            <div className={styles.historyList}>
              <div className={styles.historyItem}><div className={styles.primaryText}>failed / retrying</div><div className={styles.secondaryText}>{plan?.summary.failed ?? 0} / {plan?.summary.retrying ?? 0}</div></div>
              <div className={styles.historyItem}><div className={styles.primaryText}>decision breakdown</div><div className={styles.secondaryText}>{Object.entries(plan?.summary.byDecisionCode || {}).map(([key, value]) => `${key}:${value}`).join(" | ") || "-"}</div></div>
              <div className={styles.historyItem}><div className={styles.primaryText}>error breakdown</div><div className={styles.secondaryText}>{Object.entries(plan?.summary.byErrorCode || {}).map(([key, value]) => `${key}:${value}`).join(" | ") || "-"}</div></div>
            </div>
          </article>
          <article className={styles.card}>
            <div className={styles.cardLabel}>Latest action result</div>
            <div className={styles.historyList}>
              {dryRunResult ? <div className={styles.historyItem}><div className={styles.primaryText}>Dry run</div><div className={styles.secondaryText}>retryable {dryRunResult.retryableCount || 0} / blocked {dryRunResult.blockedCount || 0}</div></div> : null}
              {executeResult ? <div className={styles.historyItem}><div className={styles.primaryText}>Execute</div><div className={styles.secondaryText}>retried {executeResult.retriedCount || 0} / sent {executeResult.summary?.sent || 0} / failed {executeResult.summary?.failed || 0}</div></div> : null}
              {resendResult ? <div className={styles.historyItem}><div className={styles.primaryText}>Remediation resend</div><div className={styles.secondaryText}>requested {resendResult.requested} / succeeded {resendResult.succeeded} / blocked {resendResult.blocked}</div></div> : null}
              {!dryRunResult && !executeResult && !resendResult ? <div className={styles.historyItem}><div className={styles.primaryText}>No action run yet.</div></div> : null}
            </div>
          </article>
        </section>

        <section className={styles.layout}>
          <section className={styles.panel} data-notification-retry-candidates>
            <div className={styles.listMeta}>
              <div>
                <h2 className={styles.sectionTitle}>Failed / retrying deliveries</h2>
                <span className={styles.muted} data-notification-retry-candidate-count>{plan?.candidates?.length ?? 0} items</span>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Delivery</th>
                    <th>Channel</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Error</th>
                    <th>Decision</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(plan?.candidates || []).map((item) => (
                    <tr key={item.id} data-notification-retry-row={item.id}>
                      <td><div className={styles.primaryText}>{item.id}</div></td>
                      <td>{item.channel}</td>
                      <td><span className={statusBadge(item.status)}>{item.status}</span></td>
                      <td>{item.attempts}/{item.max_attempts}</td>
                      <td><div className={styles.primaryText}>{item.error_code || "-"}</div><div className={styles.secondaryText}>{item.error_message || "-"}</div></td>
                      <td><div className={styles.primaryText}>{item.decision.code}</div><div className={styles.secondaryText}>{item.decision.reason}</div></td>
                      <td>
                        <button
                          className={styles.ghost}
                          type="button"
                          disabled={running !== null || !item.decision.eligible}
                          onClick={() => void runSingleRetry(item.id)}
                          data-notification-retry-single={item.id}
                        >
                          {running === `single:${item.id}` ? "Retrying..." : "Single retry"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(plan?.candidates || []).length === 0 ? (
                    <tr><td colSpan={7} className={styles.empty}>No failed or retrying deliveries match the current filters.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <aside className={styles.detail} data-notification-remediation-panel>
            <div>
              <div className={styles.eyebrow}>Remediation</div>
              <h2 className={styles.detailTitle}>Remediable queue</h2>
            </div>
            <div className={styles.detailGrid}>
              <div><div className={styles.detailLabel}>Total</div><div>{remediation?.summary.total ?? 0}</div></div>
              <div><div className={styles.detailLabel}>Remediable now</div><div>{remediation?.summary.remediableNow ?? 0}</div></div>
              <div><div className={styles.detailLabel}>Blocked by config</div><div>{remediation?.summary.blockedByConfig ?? 0}</div></div>
              <div><div className={styles.detailLabel}>Blocked by identity / preference</div><div>{(remediation?.summary.blockedByIdentity ?? 0) + (remediation?.summary.blockedByPreference ?? 0)}</div></div>
            </div>
            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>Candidates</div>
              <div className={styles.historyList} data-notification-remediation-list>
                {(remediation?.items || []).slice(0, 8).map((item) => (
                  <div className={styles.historyItem} key={item.deliveryId}>
                    <div className={styles.primaryText}>{item.memberName || item.bookingReference || item.deliveryId}</div>
                    <div className={styles.secondaryText}>{item.channel} / {item.deliveryStatus} / {item.bucket}</div>
                    <div className={styles.secondaryText}>{item.hintLabel}</div>
                  </div>
                ))}
                {(remediation?.items || []).length === 0 ? <div className={styles.historyItem}><div className={styles.primaryText}>No remediation candidates right now.</div></div> : null}
              </div>
            </div>
          </aside>
        </section>

        <section className={styles.panel} data-notification-retry-boundaries>
          <div className={styles.listMeta}><h2 className={styles.sectionTitle}>Responsibility boundaries</h2></div>
          <div className={styles.historyList}>
            <div className={styles.historyItem}><div className={styles.primaryText}>This page owns failed / retrying delivery remediation, single retry, and remediable resend entry points.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Notifications overview remains responsible for summary, readiness, coverage, and ops overview.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Integrations keeps provider boundary and channel readiness entry responsibilities.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Frontdesk booking consumes notification outcomes; it does not maintain notification remediation.</div></div>
          </div>
        </section>

        <section className={styles.panel} data-notification-retry-out-of-scope>
          <div className={styles.listMeta}><h2 className={styles.sectionTitle}>Out of scope for this page</h2></div>
          <div className={styles.historyList}>
            <div className={styles.historyItem}><div className={styles.primaryText}>Auth, activation, provider credentials, OAuth, and webhook setup.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Queue, cron, worker, and full retry-engine control center responsibilities.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Frontdesk booking, staffing, services, plans, packages, or global operations settings.</div></div>
          </div>
        </section>
      </div>
    </main>
  );
}
