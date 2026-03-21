"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../notifications.module.css";
import ManagerNotificationsDomainNav from "../../../../components/manager-notifications-domain-nav";
import type {
  ManagerNotificationListItem,
  ManagerNotificationReadinessCheck,
  ManagerNotificationRunItem,
  ManagerNotificationSummary,
} from "../../../../types/manager-notifications";
import type {
  NotificationCoverageSummary,
  NotificationRemediationItem,
  NotificationRemediationSummary,
} from "../../../../types/notification-coverage";

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
      byStatus: Record<string, number>;
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

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string } | string;
  message?: string;
};

type ChannelKey = "email" | "line" | "sms" | "webhook";

const CHANNELS: ChannelKey[] = ["email", "line", "sms", "webhook"];

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
  if (!response.ok) throw new Error(getErrorMessage(payload, "Request failed"));
  if (payload && typeof payload === "object" && "data" in payload && payload.data) return payload.data as T;
  return payload as T;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "unknown";
  return normalized.replace(/_/g, " ");
}

function readinessBadgeClass(readiness: ManagerNotificationReadinessCheck | null) {
  if (!readiness) return `${styles.badge} ${styles.statusPending}`;
  if (readiness.ready) return `${styles.badge} ${styles.statusSent}`;
  if (readiness.runtime.configured || readiness.runtime.channelEnabled) return `${styles.badge} ${styles.statusRetrying}`;
  return `${styles.badge} ${styles.statusFailed}`;
}

function readinessLabel(readiness: ManagerNotificationReadinessCheck | null) {
  if (!readiness) return "Loading";
  if (readiness.ready) return "Ready";
  if (readiness.runtime.configured || readiness.runtime.channelEnabled) return "Degraded";
  return "Blocked";
}

export default function ManagerNotificationsReadinessPage() {
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>("email");
  const [readinessByChannel, setReadinessByChannel] = useState<Record<ChannelKey, ManagerNotificationReadinessCheck | null>>({
    email: null,
    line: null,
    sms: null,
    webhook: null,
  });
  const [coveragePayload, setCoveragePayload] = useState<NotificationCoverageSummary | null>(null);
  const [opsPayload, setOpsPayload] = useState<OpsPayload | null>(null);
  const [remediationPayload, setRemediationPayload] = useState<RemediationPayload | null>(null);
  const [listPayload, setListPayload] = useState<NotificationsListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const [readinessResults, coverageResult, opsResult, remediationResult, listResult] = await Promise.all([
        Promise.all(
          CHANNELS.map(async (channel) => {
            const result = await requestJson<ReadinessPayload>(
              `/api/manager/notifications/readiness?channel=${encodeURIComponent(channel)}`,
            );
            return [channel, result.readiness] as const;
          }),
        ),
        requestJson<CoveragePayload>("/api/manager/notifications/coverage"),
        requestJson<OpsPayload>("/api/manager/notifications/ops?limit=40"),
        requestJson<RemediationPayload>("/api/manager/notifications/remediation?limit=24"),
        requestJson<NotificationsListPayload>("/api/manager/notifications?limit=40"),
      ]);

      setReadinessByChannel(
        readinessResults.reduce<Record<ChannelKey, ManagerNotificationReadinessCheck | null>>(
          (acc, [channel, readiness]) => {
            acc[channel] = readiness;
            return acc;
          },
          { email: null, line: null, sms: null, webhook: null },
        ),
      );
      setCoveragePayload(coverageResult.summary);
      setOpsPayload(opsResult);
      setRemediationPayload(remediationResult);
      setListPayload(listResult);
      setMessage("Readiness workspace loaded.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load notification readiness workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectedReadiness = readinessByChannel[selectedChannel];
  const channelCards = CHANNELS.map((channel) => readinessByChannel[channel]).filter(Boolean) as ManagerNotificationReadinessCheck[];
  const readyCount = channelCards.filter((item) => item.ready).length;
  const blockedCount = channelCards.length - readyCount;
  const totalIssues = channelCards.reduce((sum, item) => sum + item.issues.length, 0);
  const coverageSummary = coveragePayload;
  const remediationSummary = remediationPayload?.summary;
  const gapBuckets = coverageSummary?.bucketMetrics ?? [];
  const recentItems = listPayload?.items ?? [];
  const problematicItems = recentItems.filter(
    (item) => item.status === "failed" || item.status === "retrying" || item.status === "skipped" || item.status === "dead_letter",
  );
  const runs = useMemo(() => {
    const notificationsRuns = listPayload?.recentRuns ?? [];
    const opsRuns = opsPayload?.runs ?? [];
    return [...notificationsRuns, ...opsRuns].slice(0, 8);
  }, [listPayload?.recentRuns, opsPayload?.runs]);

  return (
    <main className={styles.page} data-notifications-readiness-page>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Notification Readiness / Preflight</div>
          <h1 className={styles.title}>Notification Readiness / Configuration Gaps</h1>
          <p className={styles.subtitle}>
            This page owns channel readiness, configuration gaps, blocking reasons, and delivery preflight visibility.
            It does not edit provider credentials, operate retries, or manage frontdesk flows.
          </p>
          <div className={styles.actions}>
            <Link className={styles.ghost} href="/manager/notifications">
              Back to notifications
            </Link>
            <Link className={styles.ghost} href="/manager/notification-retry">
              Retry workbench
            </Link>
            <Link className={styles.ghost} href="/manager/notifications-audit">
              Audit history
            </Link>
            <button
              className={styles.action}
              type="button"
              onClick={() => void loadWorkspace()}
              disabled={loading}
              data-notifications-readiness-refresh
            >
              {loading ? "Loading..." : "Refresh readiness"}
            </button>
          </div>
        </section>

        <ManagerNotificationsDomainNav />

        {error ? (
          <div className={styles.error} data-notifications-readiness-error>
            {error}
          </div>
        ) : null}

        {message ? (
          <div className={styles.success} data-notifications-readiness-message>
            {message}
          </div>
        ) : null}

        <section className={styles.cardGrid}>
          <article className={styles.card}>
            <div className={styles.cardLabel}>Ready channels</div>
            <div className={styles.cardValue} data-notifications-readiness-ready-count>
              {readyCount}
            </div>
          </article>
          <article className={styles.card}>
            <div className={styles.cardLabel}>Blocked / degraded</div>
            <div className={styles.cardValue}>{blockedCount}</div>
          </article>
          <article className={styles.card}>
            <div className={styles.cardLabel}>Coverage skipped</div>
            <div className={styles.cardValue} data-notifications-readiness-coverage-skipped>
              {coverageSummary?.skippedCount ?? 0}
            </div>
          </article>
          <article className={styles.card}>
            <div className={styles.cardLabel}>Configuration issues</div>
            <div className={styles.cardValue}>{totalIssues}</div>
          </article>
        </section>

        <section className={styles.readinessGrid}>
          <article className={styles.panel} data-notifications-readiness-cards>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Channel readiness</h2>
              <span className={styles.muted}>{channelCards.length} channels loaded</span>
            </div>
            <div className={styles.historyList}>
              {CHANNELS.map((channel) => {
                const readiness = readinessByChannel[channel];
                return (
                  <button
                    key={channel}
                    type="button"
                    className={styles.historyItem}
                    onClick={() => setSelectedChannel(channel)}
                    data-notifications-readiness-card={channel}
                    style={{ textAlign: "left", cursor: "pointer" }}
                  >
                    <div className={styles.listMeta}>
                      <div className={styles.primaryText}>{channel}</div>
                      <span className={readinessBadgeClass(readiness)}>{readinessLabel(readiness)}</span>
                    </div>
                    <div className={styles.secondaryText}>
                      mode {readiness?.runtime.effectiveMode || "-"} / provider {readiness?.runtime.provider || "-"}
                    </div>
                    <div className={styles.secondaryText}>
                      config {readiness?.runtime.configured ? "configured" : "missing"} / endpoint{" "}
                      {readiness?.runtime.endpointConfigured ? "ok" : "missing"}
                    </div>
                    <div className={styles.secondaryText}>
                      issues {(readiness?.issues.length ?? 0)} / event {readiness?.eventType || "-"}
                    </div>
                  </button>
                );
              })}
            </div>
          </article>

          <article className={styles.detail} data-notifications-readiness-selected>
            <div>
              <div className={styles.eyebrow}>Selected channel</div>
              <h2 className={styles.detailTitle} data-notifications-readiness-selected-channel>
                {selectedChannel}
              </h2>
            </div>

            <div className={styles.detailGroup}>
              <div className={styles.listMeta}>
                <span className={readinessBadgeClass(selectedReadiness)}>{readinessLabel(selectedReadiness)}</span>
                <span className={styles.muted}>{selectedReadiness?.eventType || "-"}</span>
              </div>
              <div className={styles.detailGrid}>
                <div>
                  <div className={styles.detailLabel}>Requested mode</div>
                  <div className={styles.detailText}>{selectedReadiness?.runtime.requestedMode || "-"}</div>
                </div>
                <div>
                  <div className={styles.detailLabel}>Effective mode</div>
                  <div className={styles.detailText}>{selectedReadiness?.runtime.effectiveMode || "-"}</div>
                </div>
                <div>
                  <div className={styles.detailLabel}>Provider</div>
                  <div className={styles.detailText}>{selectedReadiness?.runtime.provider || "-"}</div>
                </div>
                <div>
                  <div className={styles.detailLabel}>Blocking reason</div>
                  <div className={styles.detailText}>{selectedReadiness?.runtime.reason || "-"}</div>
                </div>
              </div>
            </div>

            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>Configuration gaps</div>
              <div className={styles.historyList}>
                {(selectedReadiness?.issues ?? []).map((issue) => (
                  <div key={issue} className={styles.historyItem}>
                    <div className={styles.primaryText}>{issue}</div>
                  </div>
                ))}
                {selectedReadiness && selectedReadiness.issues.length === 0 ? (
                  <div className={styles.historyItem}>
                    <div className={styles.primaryText}>No blocking issues for this channel.</div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>Sample recipient</div>
              <div className={styles.detailText}>
                {selectedReadiness?.sampleRecipient
                  ? `${selectedReadiness.sampleRecipient.name || "-"} / ${selectedReadiness.sampleRecipient.email || selectedReadiness.sampleRecipient.phone || selectedReadiness.sampleRecipient.lineUserId || "-"}`
                  : "No sample recipient returned."}
              </div>
            </div>
          </article>
        </section>

        <section className={styles.layout}>
          <article className={styles.panel} data-notifications-readiness-coverage>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Coverage gaps</h2>
              <span className={styles.muted}>
                email {coverageSummary?.emailReachableCount ?? 0} / line {coverageSummary?.lineReachableCount ?? 0}
              </span>
            </div>
            <div className={styles.historyList}>
              {gapBuckets.map((bucket) => (
                <div key={bucket.bucket} className={styles.historyItem}>
                  <div className={styles.listMeta}>
                    <div className={styles.primaryText}>{formatStatusLabel(bucket.bucket)}</div>
                    <span className={styles.badge}>{bucket.affectedDeliveriesCount} deliveries</span>
                  </div>
                  <div className={styles.secondaryText}>
                    affected members {bucket.affectedMembersCount} / remediable now {bucket.remediableNowCount} / blocked now {bucket.blockedNowCount}
                  </div>
                  <div className={styles.secondaryText}>latest occurrence {formatDateTime(bucket.latestOccurrence)}</div>
                </div>
              ))}
              {gapBuckets.length === 0 ? (
                <div className={styles.historyItem}>
                  <div className={styles.primaryText}>No coverage bucket data in the current dataset.</div>
                </div>
              ) : null}
            </div>
          </article>

          <article className={styles.detail} data-notifications-readiness-remediation>
            <div>
              <div className={styles.eyebrow}>Blocking summary</div>
              <h2 className={styles.detailTitle}>Remediation hints</h2>
            </div>
            <div className={styles.detailGrid}>
              <div>
                <div className={styles.detailLabel}>Remediable now</div>
                <div className={styles.detailText}>{remediationSummary?.remediableNow ?? 0}</div>
              </div>
              <div>
                <div className={styles.detailLabel}>Blocked by config</div>
                <div className={styles.detailText}>{remediationSummary?.blockedByConfig ?? 0}</div>
              </div>
              <div>
                <div className={styles.detailLabel}>Blocked by preference</div>
                <div className={styles.detailText}>{remediationSummary?.blockedByPreference ?? 0}</div>
              </div>
              <div>
                <div className={styles.detailLabel}>Channel not configured</div>
                <div className={styles.detailText}>{opsPayload?.summary.external.channelNotConfigured ?? 0}</div>
              </div>
            </div>
            <div className={styles.historyList}>
              {(remediationPayload?.items ?? []).slice(0, 6).map((item) => (
                <div key={item.deliveryId} className={styles.historyItem}>
                  <div className={styles.primaryText}>{item.memberName || item.deliveryId}</div>
                  <div className={styles.secondaryText}>
                    {item.channel} / {item.deliveryStatus} / {formatStatusLabel(item.bucket)}
                  </div>
                  <div className={styles.secondaryText}>{item.hintLabel}</div>
                  <div className={styles.secondaryText}>{item.rawReason || "-"}</div>
                </div>
              ))}
              {(remediationPayload?.items ?? []).length === 0 ? (
                <div className={styles.historyItem}>
                  <div className={styles.primaryText}>No remediable candidates in the current dataset.</div>
                </div>
              ) : null}
            </div>
          </article>
        </section>

        <section className={styles.layout}>
          <article className={styles.panel}>
            <div className={styles.listMeta}>
              <h2 className={styles.sectionTitle}>Recent delivery pressure</h2>
              <span className={styles.muted} data-notifications-readiness-list-count>
                {problematicItems.length} problematic rows
              </span>
            </div>
            <div className={styles.historyList}>
              {problematicItems.slice(0, 8).map((item) => (
                <div key={item.id} className={styles.historyItem}>
                  <div className={styles.listMeta}>
                    <div className={styles.primaryText}>{item.eventType || item.id}</div>
                    <span className={styles.badge}>{formatStatusLabel(item.status)}</span>
                  </div>
                  <div className={styles.secondaryText}>
                    {item.channel} / booking {item.bookingReference || "-"} / recipient {item.recipientName || "-"}
                  </div>
                  <div className={styles.secondaryText}>{item.failureReason || item.skippedReason || "-"}</div>
                  <div className={styles.secondaryText}>created {formatDateTime(item.createdAt)}</div>
                </div>
              ))}
              {problematicItems.length === 0 ? (
                <div className={styles.historyItem}>
                  <div className={styles.primaryText}>No failed, retrying, or skipped deliveries in the current dataset.</div>
                </div>
              ) : null}
            </div>
          </article>

          <article className={styles.detail}>
            <div>
              <div className={styles.eyebrow}>Recent runs</div>
              <h2 className={styles.detailTitle}>Preflight visibility</h2>
            </div>
            <div className={styles.historyList}>
              {runs.map((run) => (
                <div key={run.id} className={styles.historyItem}>
                  <div className={styles.primaryText}>{run.jobType}</div>
                  <div className={styles.secondaryText}>
                    {run.status} / affected {run.affectedCount} / errors {run.errorCount}
                  </div>
                  <div className={styles.secondaryText}>
                    {formatDateTime(run.startedAt)} {"->"} {formatDateTime(run.finishedAt)}
                  </div>
                  <div className={styles.secondaryText}>{run.errorSummary || "-"}</div>
                </div>
              ))}
              {runs.length === 0 ? (
                <div className={styles.historyItem}>
                  <div className={styles.primaryText}>No recent runs in the current dataset.</div>
                </div>
              ) : null}
            </div>
          </article>
        </section>

        <section className={styles.panel} data-notifications-readiness-boundaries>
          <h2 className={styles.sectionTitle}>Responsibility boundaries</h2>
          <div className={styles.historyList}>
            <div className={styles.historyItem}>
              <div className={styles.primaryText}>This page owns readiness / preflight / configuration gaps.</div>
              <div className={styles.secondaryText}>
                It reads channel readiness, coverage gaps, blocking reasons, remediation hints, and recent run health.
              </div>
            </div>
            <div className={styles.historyItem}>
              <div className={styles.primaryText}>Notifications overview stays in /manager/notifications.</div>
              <div className={styles.secondaryText}>
                Overview owns summary + ops workspace, not configuration-gap deep dive.
              </div>
            </div>
            <div className={styles.historyItem}>
              <div className={styles.primaryText}>Retry / remediation stays in /manager/notification-retry.</div>
              <div className={styles.secondaryText}>
                This page surfaces hints only. It does not execute single retry, bulk resend, or retry plans.
              </div>
            </div>
          </div>
        </section>

        <section className={styles.panel} data-notifications-readiness-out-of-scope>
          <h2 className={styles.sectionTitle}>Out of scope</h2>
          <div className={styles.historyList}>
            <div className={styles.historyItem}>
              <div className={styles.primaryText}>No provider credential editor.</div>
              <div className={styles.secondaryText}>OAuth, API tokens, webhook secrets, and channel credential setup stay outside this page.</div>
            </div>
            <div className={styles.historyItem}>
              <div className={styles.primaryText}>No queue / cron / worker controls.</div>
              <div className={styles.secondaryText}>This page is not a scheduler, retry engine, or background-job control center.</div>
            </div>
            <div className={styles.historyItem}>
              <div className={styles.primaryText}>No frontdesk booking, scheduling, service, or package maintenance.</div>
              <div className={styles.secondaryText}>Frontdesk and manager business pages continue to own their own workflows and master data.</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
