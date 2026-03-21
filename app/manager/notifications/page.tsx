"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./notifications.module.css";
import ManagerNotificationsDomainNav from "../../../components/manager-notifications-domain-nav";
import type {
  ManagerNotificationDetail,
  ManagerNotificationListItem,
  ManagerNotificationReadinessCheck,
  ManagerNotificationRunItem,
  ManagerNotificationSummary,
} from "../../../types/manager-notifications";
import type {
  NotificationCoverageSummary,
  NotificationRemediationItem,
  NotificationRemediationSummary,
} from "../../../types/notification-coverage";

type NotificationsListPayload = {
  summary: ManagerNotificationSummary;
  recentRuns: ManagerNotificationRunItem[];
  items: ManagerNotificationListItem[];
};

type ReadinessPayload = {
  readiness: ManagerNotificationReadinessCheck;
};

type CoveragePayload = {
  summary: NotificationCoverageSummary;
};

type OpsPayload = {
  summary: {
    external: {
      total: number;
      sent: number;
      failed: number;
      deadLetter: number;
      retrying: number;
      skipped: number;
      pending: number;
      channelNotConfigured: number;
      byChannel: Record<string, number>;
      providerErrors: Record<string, number>;
    };
  };
  runs: ManagerNotificationRunItem[];
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

type RemediationPayload = {
  summary: NotificationRemediationSummary;
  items: NotificationRemediationItem[];
};

type DetailPayload = {
  detail: ManagerNotificationDetail;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string } | string;
  message?: string;
  summary?: unknown;
};

type RetryOpsResult = {
  summary?: {
    processed?: number;
    sent?: number;
    failed?: number;
    retrying?: number;
    deadLetter?: number;
  };
};

type SweepResult = {
  notificationGenerated?: number;
  opportunityInserted?: number;
};

type DeliveryActionResult = {
  summary?: {
    requested?: number;
    succeeded?: number;
    failed?: number;
    skipped?: number;
    blocked?: number;
  };
};

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as ApiEnvelope<unknown>;
  if (typeof body.error === "string" && body.error) return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") return body.error.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

async function requestJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | T | null;
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, "Request failed"));
  }
  if (payload && typeof payload === "object" && "data" in payload && payload.data) {
    return payload.data as T;
  }
  return payload as T;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function badgeClass(status: string) {
  if (status === "sent") return `${styles.badge} ${styles.statusSent}`;
  if (status === "failed" || status === "dead_letter") return `${styles.badge} ${styles.statusFailed}`;
  if (status === "retrying") return `${styles.badge} ${styles.statusRetrying}`;
  if (status === "cancelled") return `${styles.badge} ${styles.statusCancelled}`;
  if (status === "skipped") return `${styles.badge} ${styles.statusSkipped}`;
  return `${styles.badge} ${styles.statusPending}`;
}

function canRetry(status: string) {
  return status === "failed" || status === "dead_letter" || status === "retrying";
}

function canResend(status: string) {
  return status === "failed" || status === "dead_letter" || status === "cancelled" || status === "skipped";
}

function canCancel(status: string) {
  return status === "pending" || status === "retrying";
}

function canReconcile(channel: string, status: string) {
  return channel === "email" && (status === "sent" || status === "failed" || status === "retrying");
}

export default function ManagerNotificationsPage() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState({
    status: searchParams.get("status") || "",
    channel: searchParams.get("channel") || "",
    eventType: searchParams.get("event_type") || "",
    search: searchParams.get("search") || "",
  });
  const [readinessChannel, setReadinessChannel] = useState<"email" | "line" | "sms" | "webhook">("email");
  const [reconcileStatus, setReconcileStatus] = useState("delivered");

  const [listPayload, setListPayload] = useState<NotificationsListPayload | null>(null);
  const [coveragePayload, setCoveragePayload] = useState<CoveragePayload["summary"] | null>(null);
  const [opsPayload, setOpsPayload] = useState<OpsPayload | null>(null);
  const [remediationPayload, setRemediationPayload] = useState<{
    summary: NotificationRemediationSummary;
    items: NotificationRemediationItem[];
  } | null>(null);
  const [readinessPayload, setReadinessPayload] = useState<ManagerNotificationReadinessCheck | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailPayload, setDetailPayload] = useState<ManagerNotificationDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.channel) params.set("channel", filters.channel);
    if (filters.eventType) params.set("event_type", filters.eventType);
    if (filters.search) params.set("search", filters.search);
    params.set("limit", "120");
    return params.toString();
  }, [filters]);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listResult, coverageResult, opsResult, readinessResult, remediationResult] = await Promise.all([
        requestJson<NotificationsListPayload>(`/api/manager/notifications${queryString ? `?${queryString}` : ""}`),
        requestJson<CoveragePayload>("/api/manager/notifications/coverage"),
        requestJson<OpsPayload>("/api/manager/notifications/ops?limit=60"),
        requestJson<ReadinessPayload>(`/api/manager/notifications/readiness?channel=${encodeURIComponent(readinessChannel)}`),
        requestJson<RemediationPayload>("/api/manager/notifications/remediation?limit=40"),
      ]);

      setListPayload(listResult);
      setCoveragePayload(coverageResult.summary);
      setOpsPayload(opsResult);
      setReadinessPayload(readinessResult.readiness);
      setRemediationPayload({
        summary: remediationResult.summary,
        items: remediationResult.items,
      });

      if (!selectedId && listResult.items[0]?.id) {
        setSelectedId(listResult.items[0].id);
      } else if (selectedId && !listResult.items.some((item) => item.id === selectedId)) {
        setSelectedId(listResult.items[0]?.id || null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load notification workbench.");
    } finally {
      setLoading(false);
    }
  }, [queryString, readinessChannel, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const payload = await requestJson<DetailPayload>(`/api/manager/notifications/${id}`);
      setDetailPayload(payload.detail);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load delivery detail.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!selectedId) {
      setDetailPayload(null);
      return;
    }
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  async function runOpsAction(action: "run_sweep" | "retry_deliveries") {
    setBusyAction(action);
    setError(null);
    setMessage(null);
    try {
      if (action === "run_sweep") {
        const payload = await requestJson<SweepResult>("/api/manager/notifications/ops", {
          method: "POST",
          body: JSON.stringify({ action }),
        });
        setMessage(
          `Notification sweep completed: generated ${payload.notificationGenerated || 0}, opportunities ${payload.opportunityInserted || 0}.`,
        );
      } else {
        const payload = await requestJson<RetryOpsResult>("/api/manager/notifications/ops", {
          method: "POST",
          body: JSON.stringify({ action, limit: 120 }),
        });
        setMessage(
          `Retry failed deliveries completed: processed ${payload.summary?.processed || 0}, sent ${payload.summary?.sent || 0}, failed ${payload.summary?.failed || 0}.`,
        );
      }
      await loadWorkspace();
      if (selectedId) await loadDetail(selectedId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Notification operations action failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runDeliveryAction(action: "retry" | "resend" | "cancel" | "reconcile") {
    if (!selectedId || !detailPayload) return;
    setBusyAction(action);
    setError(null);
    setMessage(null);
    try {
      const input =
        action === "reconcile"
          ? { method: "POST", body: JSON.stringify({ providerStatus: reconcileStatus }) }
          : { method: "POST" };
      const payload = await requestJson<DeliveryActionResult>(`/api/manager/notifications/${selectedId}/${action}`, input);
      const summary = payload.summary;
      setMessage(
        action === "retry"
          ? `Retry requested: succeeded ${summary?.succeeded ?? summary?.requested ?? 0}, failed ${summary?.failed ?? 0}.`
          : action === "resend"
            ? `Resend requested: succeeded ${summary?.succeeded ?? summary?.requested ?? 0}, failed ${summary?.failed ?? 0}.`
            : action === "cancel"
              ? `Cancel requested: succeeded ${summary?.succeeded ?? summary?.requested ?? 0}, blocked ${summary?.blocked ?? 0}.`
              : `Reconcile requested: succeeded ${summary?.succeeded ?? summary?.requested ?? 0}, failed ${summary?.failed ?? 0}.`
      );
      await loadWorkspace();
      await loadDetail(selectedId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Notification delivery action failed.");
    } finally {
      setBusyAction(null);
    }
  }

  const items = listPayload?.items || [];
  const summary = listPayload?.summary || {
    total: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    retrying: 0,
  };
  const selectedItem = items.find((item) => item.id === selectedId) || detailPayload?.delivery || null;
  const readinessIssues = readinessPayload?.issues || [];
  const externalSummary = opsPayload?.summary.external || null;
  const remediationItems = remediationPayload?.items || [];

  return (
    <main className={styles.page} data-notifications-page>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Notification operations</div>
          <h1 className={styles.title}>Manager Notifications</h1>
          <p className={styles.subtitle}>
            This page is the notification operations workbench. It combines delivery status, readiness, coverage,
            remediation signals, and manual retry boundaries. It does not manage provider credentials, auth, queues,
            cron workers, or general business configuration.
          </p>
          <div className={styles.runRow}>
            <Link className={styles.pill} href="/manager">
              Back to manager
            </Link>
            <Link className={styles.pill} href="/manager/integrations">
              Integrations boundary
            </Link>
            <Link className={styles.pill} href="/manager/settings/operations">
              Operations policy
            </Link>
            <button
              className={styles.pill}
              type="button"
              onClick={() => void loadWorkspace()}
              disabled={loading}
              data-notifications-refresh
            >
              {loading ? "Refreshing..." : "Refresh workspace"}
            </button>
          </div>
        </section>

        <ManagerNotificationsDomainNav showIndex />

        {error ? <div className={styles.error} data-notifications-error>{error}</div> : null}
        {message ? <div className={styles.success} data-notifications-message>{message}</div> : null}

        <section className={styles.cardGrid}>
          <article className={styles.card}><div className={styles.cardLabel}>Queued</div><div className={styles.cardValue} data-notifications-summary-queued>{summary.queued}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Sent</div><div className={styles.cardValue} data-notifications-summary-sent>{summary.sent}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Failed</div><div className={styles.cardValue} data-notifications-summary-failed>{summary.failed}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Retrying</div><div className={styles.cardValue} data-notifications-summary-retrying>{summary.retrying}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Skipped</div><div className={styles.cardValue}>{summary.skipped}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Cancelled</div><div className={styles.cardValue}>{summary.cancelled}</div></article>
        </section>

        <section className={styles.readinessGrid}>
          <article className={styles.panel} data-notifications-readiness>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Channel readiness</h2>
              <div className={styles.inlineActions}>
                <select
                  className={styles.select}
                  value={readinessChannel}
                  onChange={(event) => setReadinessChannel(event.target.value as "email" | "line" | "sms" | "webhook")}
                  data-notifications-readiness-channel
                >
                  <option value="email">Email</option>
                  <option value="line">LINE</option>
                  <option value="sms">SMS</option>
                  <option value="webhook">Webhook</option>
                </select>
              </div>
            </div>
            <div className={styles.metaRow}>
              <span className={readinessPayload?.ready ? `${styles.badge} ${styles.statusSent}` : `${styles.badge} ${styles.statusFailed}`} data-notifications-readiness-status>
                {readinessPayload?.ready ? "Ready" : "Not ready"}
              </span>
              <span className={styles.pill}>provider: {readinessPayload?.runtime.provider || "-"}</span>
              <span className={styles.pill}>mode: {readinessPayload?.runtime.effectiveMode || "-"}</span>
            </div>
            <div className={styles.detailGrid}>
              <div><div className={styles.detailLabel}>Channel enabled</div><div>{String(readinessPayload?.runtime.channelEnabled ?? false)}</div></div>
              <div><div className={styles.detailLabel}>Configured</div><div>{String(readinessPayload?.runtime.configured ?? false)}</div></div>
              <div><div className={styles.detailLabel}>Endpoint configured</div><div>{String(readinessPayload?.runtime.endpointConfigured ?? false)}</div></div>
              <div><div className={styles.detailLabel}>Token configured</div><div>{String(readinessPayload?.runtime.tokenConfigured ?? false)}</div></div>
            </div>
            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>Issues</div>
              <div className={styles.historyList} data-notifications-readiness-issues>
                {readinessIssues.length > 0 ? readinessIssues.map((issue) => (
                  <div className={styles.historyItem} key={issue}><div className={styles.primaryText}>{issue}</div></div>
                )) : <div className={styles.historyItem}><div className={styles.primaryText}>No blocking readiness issues.</div></div>}
              </div>
            </div>
          </article>

          <article className={styles.panel} data-notifications-ops>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Delivery ops snapshot</h2>
              <div className={styles.inlineActions}>
                <button className={styles.action} type="button" onClick={() => void runOpsAction("run_sweep")} disabled={busyAction !== null} data-notifications-run-sweep>
                  {busyAction === "run_sweep" ? "Running..." : "Run sweep"}
                </button>
                <button className={styles.ghost} type="button" onClick={() => void runOpsAction("retry_deliveries")} disabled={busyAction !== null} data-notifications-retry-failed>
                  {busyAction === "retry_deliveries" ? "Retrying..." : "Retry failed deliveries"}
                </button>
              </div>
            </div>
            <div className={styles.cardGrid}>
              <article className={styles.card}><div className={styles.cardLabel}>External total</div><div className={styles.cardValue}>{externalSummary?.total ?? 0}</div></article>
              <article className={styles.card}><div className={styles.cardLabel}>External sent</div><div className={styles.cardValue}>{externalSummary?.sent ?? 0}</div></article>
              <article className={styles.card}><div className={styles.cardLabel}>External failed</div><div className={styles.cardValue}>{externalSummary?.failed ?? 0}</div></article>
              <article className={styles.card}><div className={styles.cardLabel}>Retrying / pending</div><div className={styles.cardValue}>{(externalSummary?.retrying ?? 0) + (externalSummary?.pending ?? 0)}</div></article>
            </div>
            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>Latest failed delivery</div>
              <div className={styles.historyList}>
                {opsPayload?.failedDeliveries?.length ? (
                  <div className={styles.historyItem}>
                    <div className={styles.primaryText}>{opsPayload.failedDeliveries[0].channel || "unknown"} / {opsPayload.failedDeliveries[0].error_code || "runtime_error"}</div>
                    <div className={styles.secondaryText}>{formatDateTime(opsPayload.failedDeliveries[0].created_at)}</div>
                  </div>
                ) : <div className={styles.historyItem}><div className={styles.primaryText}>No failed external deliveries in the current snapshot.</div></div>}
              </div>
            </div>
          </article>

          <article className={styles.panel} data-notifications-coverage>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Coverage & remediation</h2>
              <Link className={styles.ghost} href="/manager/integrations">Integration boundary</Link>
            </div>
            <div className={styles.cardGrid}>
              <article className={styles.card}><div className={styles.cardLabel}>Email reachable</div><div className={styles.cardValue}>{coveragePayload?.emailReachableCount ?? 0}</div></article>
              <article className={styles.card}><div className={styles.cardLabel}>LINE reachable</div><div className={styles.cardValue}>{coveragePayload?.lineReachableCount ?? 0}</div></article>
              <article className={styles.card}><div className={styles.cardLabel}>Simulated only</div><div className={styles.cardValue}>{coveragePayload?.simulatedOnlyCount ?? 0}</div></article>
              <article className={styles.card}><div className={styles.cardLabel}>Remediable now</div><div className={styles.cardValue} data-notifications-remediable>{remediationPayload?.summary.remediableNow ?? 0}</div></article>
            </div>
            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>Top remediation queue</div>
              <div className={styles.historyList} data-notifications-remediation-list>
                {remediationItems.length > 0 ? remediationItems.slice(0, 4).map((item) => (
                  <div className={styles.historyItem} key={item.deliveryId}>
                    <div className={styles.primaryText}>{item.memberName || item.bookingReference || item.deliveryId}</div>
                    <div className={styles.secondaryText}>{item.channel} / {item.bucket} / {item.hintLabel}</div>
                  </div>
                )) : <div className={styles.historyItem}><div className={styles.primaryText}>No remediation candidates right now.</div></div>}
              </div>
            </div>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.listMeta}>
            <h2 className={styles.sectionTitle}>Filters</h2>
            <button className={styles.ghost} type="button" onClick={() => setFilters({ status: "", channel: "", eventType: "", search: "" })}>Reset</button>
          </div>
          <div className={styles.toolbar}>
            <div className={styles.field}>
              <label>Status</label>
              <select className={styles.select} value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))} data-notifications-filter-status>
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="retrying">Retrying</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="dead_letter">Dead letter</option>
                <option value="cancelled">Cancelled</option>
                <option value="skipped">Skipped</option>
              </select>
            </div>
            <div className={styles.field}>
              <label>Channel</label>
              <select className={styles.select} value={filters.channel} onChange={(event) => setFilters((prev) => ({ ...prev, channel: event.target.value }))}>
                <option value="">All</option>
                <option value="email">Email</option>
                <option value="line">LINE</option>
                <option value="sms">SMS</option>
                <option value="webhook">Webhook</option>
                <option value="in_app">In-app</option>
              </select>
            </div>
            <div className={styles.field}>
              <label>Event</label>
              <input className={styles.input} value={filters.eventType} onChange={(event) => setFilters((prev) => ({ ...prev, eventType: event.target.value }))} placeholder="booking_created" />
            </div>
            <div className={styles.field}>
              <label>Search</label>
              <input className={styles.input} value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="booking ref / recipient / provider" data-notifications-filter-search />
            </div>
          </div>
        </section>

        <section className={styles.layout}>
          <section className={styles.panel}>
            <div className={styles.listMeta}>
              <div>
                <h2 className={styles.sectionTitle}>Delivery list</h2>
                <span className={styles.muted} data-notifications-list-count>{loading ? "Loading..." : `${items.length} items`}</span>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Schedule</th><th>Event</th><th>Recipient</th><th>Booking</th><th>Status</th><th>Provider</th><th>Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} data-notifications-row={item.id}>
                      <td><button className={styles.rowButton} type="button" onClick={() => setSelectedId(item.id)}><div className={styles.primaryText}>{formatDateTime(item.scheduledFor)}</div><div className={styles.secondaryText}>{item.channel}</div></button></td>
                      <td><div className={styles.primaryText}>{item.eventType || "-"}</div><div className={styles.secondaryText}>{item.templateKey || "-"}</div></td>
                      <td><div className={styles.primaryText}>{item.recipientName || "-"}</div><div className={styles.secondaryText}>{item.recipientEmail || item.recipientPhone || item.recipientLineUserId || "-"}</div></td>
                      <td><div className={styles.primaryText}>{item.bookingReference || "-"}</div><div className={styles.secondaryText}>{formatDateTime(item.bookingStartsAt)}</div></td>
                      <td><span className={badgeClass(item.status)}>{item.status}</span></td>
                      <td><div className={styles.primaryText}>{item.provider || item.deliveryMode}</div><div className={styles.secondaryText}>{item.deliveryMode}</div></td>
                      <td><div className={styles.primaryText}>{formatDateTime(item.sentAt || item.lastAttemptAt)}</div><div className={styles.secondaryText}>{item.failureReason || item.skippedReason || "-"}</div></td>
                    </tr>
                  ))}
                  {!loading && items.length === 0 ? <tr><td colSpan={7} className={styles.empty}>No deliveries match the current filters.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <aside className={styles.detail} data-notifications-detail>
            {detailLoading ? <div className={styles.muted}>Loading delivery detail...</div> : null}
            {!detailLoading && !detailPayload ? <div className={styles.empty}>Select a delivery to inspect its runtime state.</div> : null}
            {detailPayload ? (
              <>
                <div>
                  <div className={styles.eyebrow}>Delivery detail</div>
                  <h2 className={styles.detailTitle}>{detailPayload.delivery.eventType || "notification_delivery"}</h2>
                  <div className={styles.metaRow}>
                    <span className={badgeClass(detailPayload.delivery.status)} data-notifications-detail-status>{detailPayload.delivery.status}</span>
                    <span className={styles.pill}>{detailPayload.delivery.channel}</span>
                    <span className={styles.pill}>{detailPayload.delivery.provider || detailPayload.delivery.deliveryMode}</span>
                  </div>
                </div>

                <div className={styles.detailActions}>
                  {selectedItem && canRetry(selectedItem.status) ? <button className={styles.action} type="button" onClick={() => void runDeliveryAction("retry")} disabled={busyAction !== null} data-notifications-detail-retry>Retry</button> : null}
                  {selectedItem && canResend(selectedItem.status) ? <button className={styles.ghost} type="button" onClick={() => void runDeliveryAction("resend")} disabled={busyAction !== null}>Resend</button> : null}
                  {selectedItem && canCancel(selectedItem.status) ? <button className={styles.ghost} type="button" onClick={() => void runDeliveryAction("cancel")} disabled={busyAction !== null}>Cancel</button> : null}
                </div>

                {selectedItem && canReconcile(selectedItem.channel, selectedItem.status) ? (
                  <section className={styles.detailGroup}>
                    <div className={styles.listMeta}>
                      <div className={styles.detailLabel}>Manual reconcile</div>
                      <div className={styles.inlineActions}>
                        <select className={styles.select} value={reconcileStatus} onChange={(event) => setReconcileStatus(event.target.value)}>
                          <option value="delivered">delivered</option>
                          <option value="opened">opened</option>
                          <option value="clicked">clicked</option>
                          <option value="failed">failed</option>
                          <option value="bounced">bounced</option>
                          <option value="cancelled">cancelled</option>
                          <option value="suppressed">suppressed</option>
                        </select>
                        <button className={styles.ghost} type="button" onClick={() => void runDeliveryAction("reconcile")} disabled={busyAction !== null}>Reconcile</button>
                      </div>
                    </div>
                  </section>
                ) : null}

                <section className={styles.detailGroup}>
                  <div className={styles.detailGrid}>
                    <div><div className={styles.detailLabel}>Booking</div><div>{detailPayload.delivery.bookingReference || "-"}</div></div>
                    <div><div className={styles.detailLabel}>Recipient</div><div>{detailPayload.delivery.recipientName || "-"}</div></div>
                    <div><div className={styles.detailLabel}>Failure / skipped reason</div><div className={styles.detailText}>{detailPayload.delivery.failureReason || detailPayload.delivery.skippedReason || "-"}</div></div>
                    <div><div className={styles.detailLabel}>Latest attempt</div><div>{formatDateTime(detailPayload.delivery.sentAt || detailPayload.delivery.lastAttemptAt)}</div></div>
                  </div>
                </section>

                <section className={styles.detailGroup}>
                  <div className={styles.detailLabel}>Provider response</div>
                  <pre className={styles.timelineItem}>{JSON.stringify(detailPayload.providerResponse || {}, null, 2)}</pre>
                </section>

                <section className={styles.detailGroup}>
                  <div className={styles.detailLabel}>Delivery timeline</div>
                  <div className={styles.timeline}>
                    {detailPayload.events.length > 0 ? detailPayload.events.map((event) => (
                      <div className={styles.timelineItem} key={event.id}>
                        <div className={styles.primaryText}>{event.eventType}</div>
                        <div className={styles.secondaryText}>{formatDateTime(event.eventAt)}</div>
                        <div className={styles.secondaryText}>{event.provider || "-"} / {event.statusBefore || "-"} {"->"} {event.statusAfter || "-"}</div>
                      </div>
                    )) : <div className={styles.empty}>No delivery events recorded for this item.</div>}
                  </div>
                </section>
              </>
            ) : null}
          </aside>
        </section>

        <section className={styles.panel} data-notifications-boundaries>
          <div className={styles.listMeta}><h2 className={styles.sectionTitle}>Responsibility boundaries</h2></div>
          <div className={styles.historyList}>
            <div className={styles.historyItem}><div className={styles.primaryText}>This page owns delivery operations, readiness visibility, and remediation entry points.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Integrations stays responsible for integration catalog and external boundary overview.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Operations & Permissions keeps global booking policy and notification toggles.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Frontdesk booking consumes notification outcomes; it does not maintain delivery operations.</div></div>
          </div>
        </section>

        <section className={styles.panel} data-notifications-out-of-scope>
          <div className={styles.listMeta}><h2 className={styles.sectionTitle}>Out of scope for this page</h2></div>
          <div className={styles.historyList}>
            <div className={styles.historyItem}><div className={styles.primaryText}>Provider credential editing, OAuth, webhook setup, and auth / activation.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Queue, cron, worker, and large automation control center responsibilities.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Coach, service, plan, package, waitlist, or frontdesk booking business maintenance.</div></div>
          </div>
        </section>
      </div>
    </main>
  );
}
