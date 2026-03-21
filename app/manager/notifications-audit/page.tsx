"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../notifications/notifications.module.css";
import type {
  ManagerNotificationDetail,
  ManagerNotificationListItem,
  ManagerNotificationRunItem,
  ManagerNotificationSummary,
} from "../../../types/manager-notifications";

type NotificationsListPayload = {
  summary: ManagerNotificationSummary;
  recentRuns: ManagerNotificationRunItem[];
  items: ManagerNotificationListItem[];
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
};

type AuditPayload = {
  scope: string;
  tenantId: string | null;
  items: Array<{
    id: string;
    action: string;
    actor: {
      userId: string | null;
      role: string | null;
    };
    tenantId: string | null;
    scope: string;
    resourceType: string;
    resourceId: string | null;
    createdAt: string;
    metadataSummary: {
      keys: string[];
      blockedCodes: string[];
      blockedCount: number;
    };
  }>;
  nextCursor: string | null;
};

type DetailPayload = {
  detail: ManagerNotificationDetail;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string } | string;
  message?: string;
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

export default function ManagerNotificationsAuditPage() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [listPayload, setListPayload] = useState<NotificationsListPayload | null>(null);
  const [opsPayload, setOpsPayload] = useState<OpsPayload | null>(null);
  const [auditPayload, setAuditPayload] = useState<AuditPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailPayload, setDetailPayload] = useState<ManagerNotificationDetail | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search) params.set("search", search);
    params.set("limit", "60");
    return params.toString();
  }, [status, search]);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listResult, opsResult, auditResult] = await Promise.all([
        requestJson<NotificationsListPayload>(`/api/manager/notifications?${queryString}`),
        requestJson<OpsPayload>("/api/manager/notifications/ops?limit=40"),
        requestJson<AuditPayload>("/api/manager/notifications/audit?limit=40"),
      ]);

      setListPayload(listResult);
      setOpsPayload(opsResult);
      setAuditPayload(auditResult);

      if (!selectedId && listResult.items[0]?.id) {
        setSelectedId(listResult.items[0].id);
      } else if (selectedId && !listResult.items.some((item) => item.id === selectedId)) {
        setSelectedId(listResult.items[0]?.id || null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load notification audit workspace.");
    } finally {
      setLoading(false);
    }
  }, [queryString, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const payload = await requestJson<DetailPayload>(`/api/manager/notifications/${id}`);
      setDetailPayload(payload.detail);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load notification detail.");
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

  const summary = listPayload?.summary ?? {
    total: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    retrying: 0,
  };

  const items = listPayload?.items ?? [];
  const recentRuns = listPayload?.recentRuns ?? [];
  const opsRuns = opsPayload?.runs ?? [];
  const auditItems = auditPayload?.items ?? [];

  return (
    <main className={styles.page} data-notifications-audit-page>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Notification Audit / History</div>
          <h1 className={styles.title}>Notification Audit / History / Run Trace</h1>
          <p className={styles.subtitle}>
            This page owns historical delivery visibility, recent run trace, failure history, and admin audit records.
            It does not execute retries, manage provider credentials, or operate queues.
          </p>
          <div className={styles.actions}>
            <Link className={styles.ghost} href="/manager/notifications">Back to notifications</Link>
            <Link className={styles.ghost} href="/manager/notification-retry">Retry workbench</Link>
            <button className={styles.action} type="button" onClick={() => void loadWorkspace()} disabled={loading} data-notifications-audit-refresh>
              {loading ? "Loading..." : "Refresh history"}
            </button>
          </div>
        </section>

        {error ? <div className={styles.error} data-notifications-audit-error>{error}</div> : null}

        <section className={styles.cardGrid}>
          <article className={styles.card}><div className={styles.cardLabel}>Total deliveries</div><div className={styles.cardValue} data-notifications-audit-total>{summary.total}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Sent</div><div className={styles.cardValue}>{summary.sent}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Failed / dead letter</div><div className={styles.cardValue}>{summary.failed}</div></article>
          <article className={styles.card}><div className={styles.cardLabel}>Retrying</div><div className={styles.cardValue}>{summary.retrying}</div></article>
        </section>

        <section className={styles.readinessGrid}>
          <article className={styles.panel} data-notifications-audit-runs>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Recent runs</h2>
              <span className={styles.muted}>{recentRuns.length + opsRuns.length} run traces loaded</span>
            </div>
            <div className={styles.historyList}>
              {[...recentRuns, ...opsRuns].slice(0, 8).map((run) => (
                <div className={styles.historyItem} key={run.id}>
                  <div className={styles.primaryText}>{run.jobType}</div>
                  <div className={styles.secondaryText}>{run.status} / {run.triggerMode}</div>
                  <div className={styles.secondaryText}>{formatDateTime(run.startedAt)} {"->"} {formatDateTime(run.finishedAt)}</div>
                  <div className={styles.secondaryText}>affected {run.affectedCount} / errors {run.errorCount}</div>
                  <div className={styles.secondaryText}>{run.errorSummary || "-"}</div>
                </div>
              ))}
              {[...recentRuns, ...opsRuns].length === 0 ? <div className={styles.historyItem}><div className={styles.primaryText}>No recent runs in the current dataset.</div></div> : null}
            </div>
          </article>

          <article className={styles.panel} data-notifications-audit-admin>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Admin audit history</h2>
              <span className={styles.muted}>{auditItems.length} rows</span>
            </div>
            <div className={styles.historyList}>
              {auditItems.slice(0, 8).map((item) => (
                <div className={styles.historyItem} key={item.id}>
                  <div className={styles.primaryText}>{item.action}</div>
                  <div className={styles.secondaryText}>{item.resourceType}:{item.resourceId || "-"}</div>
                  <div className={styles.secondaryText}>actor {item.actor.userId || "-"} / {item.actor.role || "-"}</div>
                  <div className={styles.secondaryText}>{formatDateTime(item.createdAt)}</div>
                  <div className={styles.secondaryText}>blocked {item.metadataSummary.blockedCount} / codes {item.metadataSummary.blockedCodes.join(", ") || "-"}</div>
                </div>
              ))}
              {auditItems.length === 0 ? <div className={styles.historyItem}><div className={styles.primaryText}>No admin audit rows in the current dataset.</div></div> : null}
            </div>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.listMeta}>
            <h2 className={styles.sectionTitle}>Filters</h2>
            <button className={styles.ghost} type="button" onClick={() => { setStatus(""); setSearch(""); }}>Reset</button>
          </div>
          <div className={styles.toolbar}>
            <div className={styles.field}>
              <label>Status</label>
              <select className={styles.select} value={status} onChange={(event) => setStatus(event.target.value)} data-notifications-audit-filter-status>
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
              <label>Search</label>
              <input className={styles.input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="booking ref / recipient / provider" data-notifications-audit-filter-search />
            </div>
          </div>
        </section>

        <section className={styles.layout}>
          <section className={styles.panel} data-notifications-audit-list>
            <div className={styles.listMeta}>
              <div>
                <h2 className={styles.sectionTitle}>Delivery history</h2>
                <span className={styles.muted} data-notifications-audit-list-count>{loading ? "Loading..." : `${items.length} items`}</span>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Scheduled</th>
                    <th>Event</th>
                    <th>Recipient</th>
                    <th>Booking</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Failure / latest</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} data-notifications-audit-row={item.id}>
                      <td>
                        <button className={styles.rowButton} type="button" onClick={() => setSelectedId(item.id)}>
                          <div className={styles.primaryText}>{formatDateTime(item.scheduledFor)}</div>
                          <div className={styles.secondaryText}>{item.channel}</div>
                        </button>
                      </td>
                      <td><div className={styles.primaryText}>{item.eventType || "-"}</div><div className={styles.secondaryText}>{item.templateKey || "-"}</div></td>
                      <td><div className={styles.primaryText}>{item.recipientName || "-"}</div><div className={styles.secondaryText}>{item.recipientEmail || item.recipientPhone || item.recipientLineUserId || "-"}</div></td>
                      <td><div className={styles.primaryText}>{item.bookingReference || "-"}</div><div className={styles.secondaryText}>{formatDateTime(item.bookingStartsAt)}</div></td>
                      <td><span className={badgeClass(item.status)}>{item.status}</span></td>
                      <td><div className={styles.primaryText}>{item.provider || item.deliveryMode}</div><div className={styles.secondaryText}>{item.deliveryMode}</div></td>
                      <td><div className={styles.primaryText}>{item.failureReason || item.skippedReason || "-"}</div><div className={styles.secondaryText}>{formatDateTime(item.sentAt || item.lastAttemptAt)}</div></td>
                    </tr>
                  ))}
                  {!loading && items.length === 0 ? <tr><td colSpan={7} className={styles.empty}>No delivery history rows matched the current filters.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <aside className={styles.detail} data-notifications-audit-detail>
            {detailLoading ? <div className={styles.muted}>Loading delivery trace...</div> : null}
            {!detailLoading && !detailPayload ? <div className={styles.empty}>Select a delivery row to inspect audit trace.</div> : null}
            {detailPayload ? (
              <>
                <div>
                  <div className={styles.eyebrow}>Delivery trace</div>
                  <h2 className={styles.detailTitle}>{detailPayload.delivery.eventType || "notification_delivery"}</h2>
                  <div className={styles.metaRow}>
                    <span className={badgeClass(detailPayload.delivery.status)} data-notifications-audit-detail-status>{detailPayload.delivery.status}</span>
                    <span className={styles.pill}>{detailPayload.delivery.channel}</span>
                    <span className={styles.pill}>{detailPayload.delivery.provider || detailPayload.delivery.deliveryMode}</span>
                  </div>
                </div>

                <section className={styles.detailGroup}>
                  <div className={styles.detailGrid}>
                    <div><div className={styles.detailLabel}>Booking</div><div>{detailPayload.delivery.bookingReference || "-"}</div></div>
                    <div><div className={styles.detailLabel}>Recipient</div><div>{detailPayload.delivery.recipientName || "-"}</div></div>
                    <div><div className={styles.detailLabel}>Failure reason</div><div className={styles.detailText}>{detailPayload.delivery.failureReason || detailPayload.errorMessage || "-"}</div></div>
                    <div><div className={styles.detailLabel}>Retry count</div><div>{detailPayload.delivery.resendCount}</div></div>
                  </div>
                </section>

                <section className={styles.detailGroup}>
                  <div className={styles.detailLabel}>Resend / remediation history</div>
                  <div className={styles.historyList} data-notifications-audit-resend-history>
                    {detailPayload.resendHistory.length > 0 ? detailPayload.resendHistory.map((item) => (
                      <div className={styles.historyItem} key={item.id}>
                        <div className={styles.primaryText}>{item.id}</div>
                        <div className={styles.secondaryText}>{item.status} / {formatDateTime(item.createdAt)}</div>
                      </div>
                    )) : <div className={styles.historyItem}><div className={styles.primaryText}>No resend history recorded for this delivery.</div></div>}
                  </div>
                </section>

                <section className={styles.detailGroup}>
                  <div className={styles.detailLabel}>Execution timeline</div>
                  <div className={styles.timeline} data-notifications-audit-trace>
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

        <section className={styles.panel} data-notifications-audit-boundaries>
          <div className={styles.listMeta}><h2 className={styles.sectionTitle}>Responsibility boundaries</h2></div>
          <div className={styles.historyList}>
            <div className={styles.historyItem}><div className={styles.primaryText}>This page owns read-only audit, history, and run trace visibility.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Notifications overview remains responsible for current-state summary and ops snapshot.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Notification retry remains responsible for retry / remediation execution.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Frontdesk booking consumes outcomes; it does not maintain notification audit history.</div></div>
          </div>
        </section>

        <section className={styles.panel} data-notifications-audit-out-of-scope>
          <div className={styles.listMeta}><h2 className={styles.sectionTitle}>Out of scope for this page</h2></div>
          <div className={styles.historyList}>
            <div className={styles.historyItem}><div className={styles.primaryText}>Retry execution, remediation actions, provider credentials, OAuth, and auth / activation.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Queue, cron, worker, and full observability control center responsibilities.</div></div>
            <div className={styles.historyItem}><div className={styles.primaryText}>Frontdesk booking, staffing, services, plans, packages, and global operations settings.</div></div>
          </div>
        </section>
      </div>
    </main>
  );
}
