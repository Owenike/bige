"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./notifications.module.css";
import type {
  ManagerNotificationBatchActionResult,
  ManagerNotificationDetail,
  ManagerNotificationListItem,
  ManagerNotificationReadinessCheck,
  ManagerNotificationRunItem,
  ManagerNotificationSummary,
} from "../../../types/manager-notifications";
import type { NotificationCoverageSummary } from "../../../types/notification-coverage";

type ListResponse = {
  summary: ManagerNotificationSummary;
  recentRuns: ManagerNotificationRunItem[];
  items: ManagerNotificationListItem[];
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
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
  return status === "skipped" || status === "cancelled" || status === "failed" || status === "dead_letter";
}

function canCancel(status: string) {
  return status === "pending" || status === "retrying";
}

export default function ManagerNotificationsPage() {
  const searchParams = useSearchParams();
  const [readinessChannel, setReadinessChannel] = useState<"email" | "line" | "sms" | "webhook">("email");
  const [filters, setFilters] = useState({
    dateFrom: searchParams.get("date_from") || "",
    dateTo: searchParams.get("date_to") || "",
    channel: searchParams.get("channel") || "",
    eventType: searchParams.get("event_type") || "",
    templateKey: searchParams.get("template_key") || "",
    status: searchParams.get("status") || "",
    search: searchParams.get("search") || "",
  });
  const [bundle, setBundle] = useState<ListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<ManagerNotificationDetail | null>(null);
  const [readiness, setReadiness] = useState<ManagerNotificationReadinessCheck | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [reconcileStatus, setReconcileStatus] = useState("delivered");
  const [batchReconcileStatus, setBatchReconcileStatus] = useState("delivered");
  const [coverage, setCoverage] = useState<NotificationCoverageSummary | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    if (filters.channel) params.set("channel", filters.channel);
    if (filters.eventType) params.set("event_type", filters.eventType);
    if (filters.templateKey) params.set("template_key", filters.templateKey);
    if (filters.status) params.set("status", filters.status);
    if (filters.search) params.set("search", filters.search);
    params.set("limit", "160");
    return params.toString();
  }, [filters]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/manager/notifications${queryString ? `?${queryString}` : ""}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message || "無法載入通知列表。");
      setLoading(false);
      return;
    }

    const data = (payload?.data || payload) as ListResponse;
    setBundle(data);
    setLoading(false);
    setSelectedIds((current) => current.filter((id) => data.items.some((item) => item.id === id)));
    if (!selectedId && data.items[0]?.id) {
      setSelectedId(data.items[0].id);
    }
  }, [queryString, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    const response = await fetch(`/api/manager/notifications/${id}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message || "無法載入通知詳情。");
      setDetailLoading(false);
      return;
    }
    setDetail(((payload?.data || payload) as { detail: ManagerNotificationDetail }).detail);
    setDetailLoading(false);
  }, []);

  const loadReadiness = useCallback(async () => {
    setReadinessLoading(true);
    const response = await fetch(`/api/manager/notifications/readiness?channel=${readinessChannel}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setReadiness(null);
      setReadinessLoading(false);
      return;
    }
    setReadiness(((payload?.data || payload) as { readiness: ManagerNotificationReadinessCheck }).readiness);
    setReadinessLoading(false);
  }, [readinessChannel]);

  const loadCoverage = useCallback(async () => {
    const response = await fetch("/api/manager/notifications/coverage", {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setCoverage(null);
      return;
    }
    setCoverage(((payload?.data || payload) as { summary: NotificationCoverageSummary }).summary);
  }, []);

  async function runAction(id: string, action: "retry" | "resend" | "cancel") {
    setActionMessage(null);
    const response = await fetch(`/api/manager/notifications/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setActionMessage(payload?.error?.message || `${action} 失敗`);
      return;
    }
    setActionMessage(
      action === "retry" ? "已加入重試流程。" : action === "resend" ? "已建立新的重送 delivery。" : "已取消尚未送出的通知。",
    );
    await loadList();
    await loadDetail(id);
  }

  async function runBatchAction(action: "retry" | "cancel" | "resend" | "reconcile") {
    if (selectedIds.length === 0) {
      setActionMessage("請先勾選至少一筆通知。");
      return;
    }

    setActionMessage(null);
    const endpoint =
      action === "retry"
        ? "/api/manager/notifications/retry"
        : action === "cancel"
          ? "/api/manager/notifications/cancel"
          : action === "resend"
            ? "/api/manager/notifications/resend"
            : "/api/manager/notifications/reconcile";
    const body =
      action === "retry"
        ? {
            action: "execute",
            deliveryIds: selectedIds,
            limit: selectedIds.length,
          }
        : action === "reconcile"
          ? {
              deliveryIds: selectedIds,
              providerStatus: batchReconcileStatus,
            }
          : {
              deliveryIds: selectedIds,
            };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setActionMessage(payload?.error?.message || `批次 ${action} 失敗`);
      return;
    }

    if (action === "retry") {
      const summary = payload?.data?.summary as { processed?: number; sent?: number; failed?: number } | undefined;
      setActionMessage(`已送出批次 retry，處理 ${summary?.processed || selectedIds.length} 筆。`);
    } else if (action === "resend") {
      const summary = (payload?.data?.summary || payload?.summary) as ManagerNotificationBatchActionResult | undefined;
      setActionMessage(
        `已完成批次 resend，成功 ${summary?.succeeded || 0} 筆，失敗 ${summary?.failed || 0} 筆。`,
      );
    } else if (action === "reconcile") {
      const summary = (payload?.data?.summary || payload?.summary) as ManagerNotificationBatchActionResult | undefined;
      setActionMessage(
        `已完成批次 reconcile，成功 ${summary?.succeeded || 0} 筆，失敗 ${summary?.failed || 0} 筆。`,
      );
    } else {
      const summary = (payload?.data?.summary || payload?.summary) as ManagerNotificationBatchActionResult | undefined;
      setActionMessage(
        `已完成批次 cancel，成功 ${summary?.succeeded || 0} 筆，阻擋 ${summary?.blocked || 0} 筆。`,
      );
    }
    setSelectedIds([]);
    await loadList();
    if (selectedId) {
      await loadDetail(selectedId);
    }
  }

  async function runReconcile(id: string) {
    setActionMessage(null);
    const response = await fetch(`/api/manager/notifications/${id}/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerStatus: reconcileStatus,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setActionMessage(payload?.error?.message || "Reconcile 失敗");
      return;
    }
    setActionMessage(`已回寫 provider status：${reconcileStatus}。`);
    await loadList();
    await loadDetail(id);
  }

  function resetFilters() {
    setFilters({
      dateFrom: "",
      dateTo: "",
      channel: "",
      eventType: "",
      templateKey: "",
      status: "",
      search: "",
    });
  }

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  useEffect(() => {
    void loadCoverage();
  }, [loadCoverage]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const items = bundle?.items || [];
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const selectedHasNonEmail = selectedItems.some((item) => item.channel !== "email");
  const summary = bundle?.summary || {
    total: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    retrying: 0,
  };
  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Manager Notifications</div>
          <h1 className={styles.title}>通知營運中心</h1>
          <p className={styles.subtitle}>
            檢視 booking lifecycle delivery、批次重試與取消、provider callback reconcile，以及 Email 上線前 readiness。
          </p>
          <div className={styles.runRow}>
            <Link className={styles.pill} href="/manager">
              回到店家後台
            </Link>
            <Link className={styles.pill} href="/manager/notifications-ops">
              Notification Ops
            </Link>
            <Link className={styles.pill} href="/manager/notification-coverage">
              Coverage / Eligibility
            </Link>
            <Link className={styles.pill} href="/manager/notification-coverage?action_type=bulk_resend">
              Remediation History
            </Link>
            <Link className={styles.pill} href="/manager/notifications-runtime-readiness">
              Runtime Readiness
            </Link>
            {bundle?.recentRuns?.[0] ? (
              <span className={styles.runPill}>
                最近 dispatch：{bundle.recentRuns[0].status} / {formatDateTime(bundle.recentRuns[0].startedAt)}
              </span>
            ) : null}
          </div>
        </section>

        <section className={styles.readinessGrid}>
          <article className={styles.panel}>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Channel Readiness</h2>
              <select
                className={styles.select}
                value={readinessChannel}
                onChange={(event) => setReadinessChannel(event.target.value as "email" | "line" | "sms" | "webhook")}
              >
                <option value="email">Email</option>
                <option value="line">LINE</option>
                <option value="sms">SMS</option>
                <option value="webhook">Webhook</option>
              </select>
              <button className={styles.ghost} type="button" onClick={() => void loadReadiness()}>
                重新檢查
              </button>
            </div>
            {readinessLoading ? <div className={styles.muted}>檢查中...</div> : null}
            {!readinessLoading && readiness ? (
              <>
                <div className={styles.metaRow}>
                  <span className={readiness.ready ? `${styles.badge} ${styles.statusSent}` : `${styles.badge} ${styles.statusFailed}`}>
                    {readiness.ready ? "ready" : "not_ready"}
                  </span>
                  <span className={styles.pill}>provider: {readiness.runtime.provider || "-"}</span>
                  <span className={styles.pill}>mode: {readiness.runtime.effectiveMode}</span>
                </div>
                <div className={styles.readinessFacts}>
                  <div>
                    <div className={styles.detailLabel}>Channel Enabled</div>
                    <div>{String(readiness.runtime.channelEnabled)}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>Endpoint Configured</div>
                    <div>{String(readiness.runtime.endpointConfigured)}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>Token Configured</div>
                    <div>{String(readiness.runtime.tokenConfigured)}</div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>Recipient Sample</div>
                    <div>
                      {readiness.channel === "email"
                        ? readiness.sampleRecipient?.email || "no_email_sample"
                        : readiness.channel === "line"
                          ? readiness.sampleRecipient?.lineUserId || "no_line_user_id_sample"
                          : readiness.channel === "sms"
                            ? readiness.sampleRecipient?.phone || "no_phone_sample"
                            : readiness.sampleRecipient?.bookingId || "no_booking_sample"}
                    </div>
                  </div>
                </div>
                <div className={styles.detailGroup}>
                  <div className={styles.detailLabel}>Template Coverage</div>
                  <div className={styles.historyList}>
                    {readiness.templateCoverage.map((item) => (
                      <div className={styles.historyItem} key={`${item.eventType}:${item.channel}`}>
                        <div className={styles.primaryText}>{item.eventType}</div>
                        <div className={styles.secondaryText}>
                          {item.found ? `ok / ${item.source}` : "missing"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {readiness.issues.length > 0 ? (
                  <div className={styles.errorList}>
                    {readiness.issues.map((issue) => (
                      <div key={issue}>{issue}</div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </article>

          <section className={styles.cardGrid}>
            <article className={styles.card}>
              <div className={styles.cardLabel}>Queued</div>
              <div className={styles.cardValue}>{summary.queued}</div>
            </article>
            <article className={styles.card}>
              <div className={styles.cardLabel}>Sent</div>
              <div className={styles.cardValue}>{summary.sent}</div>
            </article>
            <article className={styles.card}>
              <div className={styles.cardLabel}>Failed</div>
              <div className={styles.cardValue}>{summary.failed}</div>
            </article>
            <article className={styles.card}>
              <div className={styles.cardLabel}>Retrying</div>
              <div className={styles.cardValue}>{summary.retrying}</div>
            </article>
            <article className={styles.card}>
              <div className={styles.cardLabel}>Cancelled</div>
              <div className={styles.cardValue}>{summary.cancelled}</div>
            </article>
            <article className={styles.card}>
              <div className={styles.cardLabel}>Skipped</div>
              <div className={styles.cardValue}>{summary.skipped}</div>
          </article>

          <article className={styles.panel}>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Coverage Snapshot</h2>
              <Link className={styles.ghost} href="/manager/notification-coverage">
                查看完整 coverage
              </Link>
            </div>
            <div className={styles.cardGrid}>
              <article className={styles.card}>
                <div className={styles.cardLabel}>Email reachable</div>
                <div className={styles.cardValue}>{coverage?.emailReachableCount || 0}</div>
              </article>
              <article className={styles.card}>
                <div className={styles.cardLabel}>LINE reachable</div>
                <div className={styles.cardValue}>{coverage?.lineReachableCount || 0}</div>
              </article>
              <article className={styles.card}>
                <div className={styles.cardLabel}>Simulated only</div>
                <div className={styles.cardValue}>{coverage?.simulatedOnlyCount || 0}</div>
              </article>
              <article className={styles.card}>
                <div className={styles.cardLabel}>Skipped</div>
                <div className={styles.cardValue}>{coverage?.skippedCount || 0}</div>
              </article>
            </div>
            {coverage?.skippedReasonBreakdown?.length ? (
              <div className={styles.detailGroup}>
                <div className={styles.detailLabel}>Top skipped reasons</div>
                <div className={styles.historyList}>
                  {coverage.skippedReasonBreakdown.slice(0, 4).map((item) => (
                    <div className={styles.historyItem} key={item.bucket}>
                      <div className={styles.primaryText}>{item.bucket}</div>
                      <div className={styles.secondaryText}>{item.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        </section>
        </section>

        <section className={styles.panel}>
          <div className={styles.listMeta}>
            <h2 className={styles.sectionTitle}>篩選條件</h2>
            <button className={styles.ghost} type="button" onClick={resetFilters}>
              重設篩選
            </button>
          </div>
          <div className={styles.toolbar}>
            <div className={styles.field}>
              <label>From</label>
              <input
                className={styles.input}
                type="date"
                value={filters.dateFrom}
                onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label>To</label>
              <input
                className={styles.input}
                type="date"
                value={filters.dateTo}
                onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label>Channel</label>
              <select
                className={styles.select}
                value={filters.channel}
                onChange={(event) => setFilters((prev) => ({ ...prev, channel: event.target.value }))}
              >
                <option value="">All</option>
                <option value="email">Email</option>
                <option value="line">LINE</option>
                <option value="sms">SMS</option>
                <option value="in_app">In App</option>
                <option value="webhook">Webhook</option>
              </select>
            </div>
            <div className={styles.field}>
              <label>Status</label>
              <select
                className={styles.select}
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="retrying">Retrying</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="dead_letter">Dead Letter</option>
                <option value="cancelled">Cancelled</option>
                <option value="skipped">Skipped</option>
              </select>
            </div>
            <div className={styles.field}>
              <label>Event</label>
              <input
                className={styles.input}
                value={filters.eventType}
                onChange={(event) => setFilters((prev) => ({ ...prev, eventType: event.target.value }))}
                placeholder="booking_created"
              />
            </div>
            <div className={styles.field}>
              <label>Template</label>
              <input
                className={styles.input}
                value={filters.templateKey}
                onChange={(event) => setFilters((prev) => ({ ...prev, templateKey: event.target.value }))}
                placeholder="booking_created"
              />
            </div>
            <div className={styles.field}>
              <label>Search</label>
              <input
                className={styles.input}
                value={filters.search}
                onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder="booking ref / recipient / provider"
              />
            </div>
          </div>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}
        {actionMessage ? <div className={actionMessage.includes("失敗") ? styles.error : styles.success}>{actionMessage}</div> : null}

        <section className={styles.layout}>
          <section className={styles.panel}>
            <div className={styles.listMeta}>
              <div>
                <h2 className={styles.sectionTitle}>通知列表</h2>
                <span className={styles.muted}>{loading ? "載入中..." : `${items.length} 筆`}</span>
              </div>
              <div className={styles.actions}>
                <span className={styles.selectionHint}>已選 {selectedIds.length} 筆</span>
                <button className={styles.action} type="button" onClick={() => void runBatchAction("retry")} disabled={selectedIds.length === 0}>
                  批次 Retry
                </button>
                <button className={styles.ghost} type="button" onClick={() => void runBatchAction("resend")} disabled={selectedIds.length === 0}>
                  批次 Resend
                </button>
                <button className={styles.ghost} type="button" onClick={() => void runBatchAction("cancel")} disabled={selectedIds.length === 0}>
                  批次 Cancel
                </button>
                <select
                  className={styles.select}
                  value={batchReconcileStatus}
                  onChange={(event) => setBatchReconcileStatus(event.target.value)}
                >
                  <option value="delivered">delivered</option>
                  <option value="opened">opened</option>
                  <option value="clicked">clicked</option>
                  <option value="failed">failed</option>
                  <option value="bounced">bounced</option>
                  <option value="complained">complained</option>
                  <option value="cancelled">cancelled</option>
                  <option value="suppressed">suppressed</option>
                </select>
                <button
                  className={styles.ghost}
                  type="button"
                  onClick={() => void runBatchAction("reconcile")}
                  disabled={selectedIds.length === 0 || selectedHasNonEmail}
                  title={selectedHasNonEmail ? "LINE / SMS / In App / Webhook 不支援 manual reconcile。" : undefined}
                >
                  批次 Reconcile
                </button>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.checkboxColumn}>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(event) =>
                          setSelectedIds(event.target.checked ? items.map((item) => item.id) : [])
                        }
                      />
                    </th>
                    <th>Schedule</th>
                    <th>Event</th>
                    <th>Recipient</th>
                    <th>Booking</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className={styles.checkboxColumn}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={(event) =>
                            setSelectedIds((current) =>
                              event.target.checked
                                ? Array.from(new Set([...current, item.id]))
                                : current.filter((id) => id !== item.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <button className={styles.rowButton} type="button" onClick={() => setSelectedId(item.id)}>
                          <div className={styles.primaryText}>{formatDateTime(item.scheduledFor)}</div>
                          <div className={styles.secondaryText}>{item.channel}</div>
                        </button>
                      </td>
                      <td>
                        <div className={styles.primaryText}>{item.eventType || "-"}</div>
                        <div className={styles.secondaryText}>{item.templateKey || "-"}</div>
                      </td>
                      <td>
                        <div className={styles.primaryText}>{item.recipientName || "-"}</div>
                        <div className={styles.secondaryText}>{item.recipientEmail || item.recipientPhone || item.recipientLineUserId || "-"}</div>
                      </td>
                      <td>
                        <div className={styles.primaryText}>{item.bookingReference || "-"}</div>
                        <div className={styles.secondaryText}>{formatDateTime(item.bookingStartsAt)}</div>
                      </td>
                      <td>
                        <span className={badgeClass(item.status)}>{item.status}</span>
                      </td>
                      <td>
                        <div className={styles.primaryText}>{item.provider || item.deliveryMode}</div>
                        <div className={styles.secondaryText}>{item.deliveryMode}</div>
                      </td>
                      <td>
                        <div className={styles.primaryText}>{formatDateTime(item.sentAt || item.lastAttemptAt)}</div>
                        <div className={styles.secondaryText}>{item.failureReason || item.skippedReason || "-"}</div>
                      </td>
                    </tr>
                  ))}
                  {!loading && items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className={styles.empty}>
                        目前沒有符合條件的通知。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <aside className={styles.detail}>
            {detailLoading ? <div className={styles.muted}>載入詳情中...</div> : null}
            {!detailLoading && !detail ? <div className={styles.empty}>請先選擇一筆通知。</div> : null}
            {detail ? (
              <>
                <div>
                  <div className={styles.eyebrow}>Delivery Detail</div>
                  <h2 className={styles.detailTitle}>{detail.delivery.eventType || "notification_delivery"}</h2>
                  <div className={styles.metaRow}>
                    <span className={badgeClass(detail.delivery.status)}>{detail.delivery.status}</span>
                    <span className={styles.pill}>{detail.delivery.channel}</span>
                    <span className={styles.pill}>{detail.delivery.provider || detail.delivery.deliveryMode}</span>
                  </div>
                </div>

                <div className={styles.detailActions}>
                  {canRetry(detail.delivery.status) ? (
                    <button className={styles.action} type="button" onClick={() => void runAction(detail.delivery.id, "retry")}>
                      Retry Now
                    </button>
                  ) : null}
                  {canResend(detail.delivery.status) ? (
                    <button className={styles.ghost} type="button" onClick={() => void runAction(detail.delivery.id, "resend")}>
                      Resend
                    </button>
                  ) : null}
                  {canCancel(detail.delivery.status) ? (
                    <button className={styles.ghost} type="button" onClick={() => void runAction(detail.delivery.id, "cancel")}>
                      Cancel
                    </button>
                  ) : null}
                </div>

                <section className={styles.detailGroup}>
                  <div className={styles.detailGrid}>
                    <div>
                      <div className={styles.detailLabel}>Booking</div>
                      <div>{detail.delivery.bookingReference || "-"}</div>
                    </div>
                    <div>
                      <div className={styles.detailLabel}>Recipient</div>
                      <div>{detail.delivery.recipientName || "-"}</div>
                    </div>
                    <div>
                      <div className={styles.detailLabel}>Line User ID</div>
                      <div className={styles.detailText}>{detail.delivery.recipientLineUserId || "-"}</div>
                    </div>
                    <div>
                      <div className={styles.detailLabel}>Schedule</div>
                      <div>{formatDateTime(detail.delivery.scheduledFor)}</div>
                    </div>
                    <div>
                      <div className={styles.detailLabel}>Sent</div>
                      <div>{formatDateTime(detail.delivery.sentAt)}</div>
                    </div>
                    <div>
                      <div className={styles.detailLabel}>Failure</div>
                      <div className={styles.detailText}>{detail.delivery.failureReason || detail.delivery.skippedReason || "-"}</div>
                    </div>
                    <div>
                      <div className={styles.detailLabel}>Provider Message ID</div>
                      <div className={styles.detailText}>{detail.delivery.providerMessageId || "-"}</div>
                    </div>
                  </div>
                </section>

                <section className={styles.detailGroup}>
                  {detail.delivery.channel === "email" ? (
                    <div className={styles.listMeta}>
                      <div className={styles.detailLabel}>Manual Reconcile</div>
                      <div className={styles.inlineActions}>
                        <select
                          className={styles.select}
                          value={reconcileStatus}
                          onChange={(event) => setReconcileStatus(event.target.value)}
                        >
                          <option value="delivered">delivered</option>
                          <option value="opened">opened</option>
                          <option value="clicked">clicked</option>
                          <option value="failed">failed</option>
                          <option value="bounced">bounced</option>
                          <option value="cancelled">cancelled</option>
                          <option value="suppressed">suppressed</option>
                        </select>
                        <button className={styles.ghost} type="button" onClick={() => void runReconcile(detail.delivery.id)}>
                          Reconcile
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.muted}>LINE 目前以同步 provider response 判定狀態，不支援 manual reconcile。</div>
                  )}
                </section>

                <section className={styles.detailGroup}>
                  <div className={styles.detailLabel}>Payload Snapshot</div>
                  <pre className={styles.timelineItem}>{JSON.stringify(detail.payload || {}, null, 2)}</pre>
                </section>

                <section className={styles.detailGroup}>
                  <div className={styles.detailLabel}>Provider Response</div>
                  <pre className={styles.timelineItem}>{JSON.stringify(detail.providerResponse || {}, null, 2)}</pre>
                </section>

                <section className={styles.detailGroup}>
                  <div className={styles.detailLabel}>Delivery Timeline</div>
                  <div className={styles.timeline}>
                    {detail.events.map((event) => (
                      <div className={styles.timelineItem} key={event.id}>
                        <div className={styles.primaryText}>{event.eventType}</div>
                        <div className={styles.secondaryText}>{formatDateTime(event.eventAt)}</div>
                        <div className={styles.secondaryText}>
                          {event.provider || "-"} / {event.statusBefore || "-"} {"->"} {event.statusAfter || "-"}
                        </div>
                      </div>
                    ))}
                    {detail.events.length === 0 ? <div className={styles.empty}>尚無 delivery events。</div> : null}
                  </div>
                </section>

                <section className={styles.detailGroup}>
                  <div className={styles.detailLabel}>Resend History</div>
                  <div className={styles.historyList}>
                    {detail.parentDelivery ? (
                      <div className={styles.historyItem}>
                        <div className={styles.primaryText}>Parent Delivery</div>
                        <div className={styles.secondaryText}>
                          {detail.parentDelivery.id} / {detail.parentDelivery.status}
                        </div>
                      </div>
                    ) : null}
                    {detail.resendHistory.map((item) => (
                      <div className={styles.historyItem} key={item.id}>
                        <div className={styles.primaryText}>{item.id}</div>
                        <div className={styles.secondaryText}>
                          {item.status} / {formatDateTime(item.createdAt)}
                        </div>
                      </div>
                    ))}
                    {!detail.parentDelivery && detail.resendHistory.length === 0 ? (
                      <div className={styles.empty}>尚無 resend lineage。</div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
