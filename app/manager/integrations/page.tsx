"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "../settings/settings.module.css";

type IntegrationChannel = "email" | "line" | "sms" | "webhook";

type IntegrationReadiness = {
  channel: IntegrationChannel;
  ready: boolean;
  issues: string[];
  templateCoverage: Array<{
    eventType: string;
    channel: string;
    found: boolean;
    source: "tenant" | "global" | "none";
  }>;
  runtime: {
    provider: string | null;
    requestedMode: "simulated" | "provider";
    effectiveMode: "simulated" | "provider";
    channelEnabled: boolean;
    configured: boolean;
    reason: string | null;
    endpointConfigured: boolean;
    tokenConfigured: boolean;
  };
};

type NotificationsOpsPayload = {
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
      byChannel: Partial<Record<IntegrationChannel, number>>;
      providerErrors: Record<string, number>;
    };
  };
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

type CoverageSummary = {
  memberCount: number;
  emailReachableCount: number;
  lineReachableCount: number;
  simulatedOnlyCount: number;
  skippedCount: number;
  bucketMetrics: Array<{
    bucket: string;
    affectedMembersCount: number;
    affectedDeliveriesCount: number;
    latestOccurrence: string | null;
  }>;
};

type Envelope<T> = {
  data?: T;
  error?: { message?: string } | string;
  message?: string;
};

const CHANNELS: IntegrationChannel[] = ["email", "line", "sms", "webhook"];

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as Envelope<unknown>;
  if (typeof body.error === "string" && body.error) return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") return body.error.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

async function requestJson<T>(input: string) {
  const response = await fetch(input, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const payload = (await response.json().catch(() => null)) as Envelope<T> | T | null;
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

function titleCaseChannel(channel: IntegrationChannel) {
  if (channel === "line") return "LINE";
  if (channel === "sms") return "SMS";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function readinessStatus(readiness: IntegrationReadiness | null) {
  if (!readiness) return "Unavailable";
  if (readiness.ready) return "Ready";
  if (!readiness.runtime.channelEnabled) return "Disabled";
  if (!readiness.runtime.configured) return "Needs configuration";
  return "Attention required";
}

function pipelineStatus(summary: NotificationsOpsPayload["summary"]["external"] | null) {
  if (!summary) return "Unavailable";
  if (summary.failed > 0 || summary.deadLetter > 0 || summary.channelNotConfigured > 0) return "Needs attention";
  if (summary.retrying > 0 || summary.pending > 0) return "Active";
  if (summary.sent > 0) return "Healthy";
  return "No recent external deliveries";
}

export default function ManagerIntegrationsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [ops, setOps] = useState<NotificationsOpsPayload | null>(null);
  const [coverage, setCoverage] = useState<CoverageSummary | null>(null);
  const [readinessMap, setReadinessMap] = useState<Record<IntegrationChannel, IntegrationReadiness | null>>({
    email: null,
    line: null,
    sms: null,
    webhook: null,
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [opsResult, coverageResult, readinessResult] = await Promise.allSettled([
        requestJson<NotificationsOpsPayload>("/api/manager/notifications/ops?limit=60"),
        requestJson<{ summary: CoverageSummary }>("/api/manager/notifications/coverage"),
        Promise.all(
          CHANNELS.map(async (channel) => {
            const payload = await requestJson<{ readiness: IntegrationReadiness }>(
              `/api/manager/notifications/readiness?channel=${encodeURIComponent(channel)}`,
            );
            return [channel, payload.readiness] as const;
          }),
        ),
      ]);

      const nextOps = opsResult.status === "fulfilled" ? opsResult.value : null;
      const nextCoverage = coverageResult.status === "fulfilled" ? coverageResult.value.summary : null;
      const nextReadiness =
        readinessResult.status === "fulfilled"
          ? {
              email: null,
              line: null,
              sms: null,
              webhook: null,
              ...Object.fromEntries(readinessResult.value),
            }
          : {
              email: null,
              line: null,
              sms: null,
              webhook: null,
            };

      if (!nextOps && !nextCoverage && Object.values(nextReadiness).every((value) => !value)) {
        throw new Error("Failed to load integration status.");
      }

      setOps(nextOps);
      setCoverage(nextCoverage);
      setReadinessMap(nextReadiness);
      setLastLoadedAt(new Date().toISOString());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load integration status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const pipelineSummary = useMemo(() => {
    const external = ops?.summary.external || null;
    const latestFailed = ops?.failedDeliveries?.[0] || null;
    const latestRetry = ops?.retryingDeliveries?.[0] || null;
    return {
      status: pipelineStatus(external),
      total: external?.total ?? 0,
      sent: external?.sent ?? 0,
      failed: external?.failed ?? 0,
      retrying: external?.retrying ?? 0,
      pending: external?.pending ?? 0,
      channelNotConfigured: external?.channelNotConfigured ?? 0,
      latestFailed,
      latestRetry,
    };
  }, [ops]);

  const readinessCards = useMemo(
    () =>
      CHANNELS.map((channel) => {
        const readiness = readinessMap[channel];
        return {
          channel,
          readiness,
          status: readinessStatus(readiness),
          provider: readiness?.runtime.provider || (channel === "webhook" ? "webhook" : "notify"),
          mode: readiness?.runtime.effectiveMode || "-",
          issues: readiness?.issues || [],
          configured: readiness?.runtime.configured ?? false,
          templatesReady: readiness?.templateCoverage.filter((item) => item.found).length ?? 0,
        };
      }),
    [readinessMap],
  );

  return (
    <main className="fdGlassScene" data-integrations-page>
      <section className="fdGlassBackdrop">
        <section className={styles.page}>
          <article className={`fdGlassPanel ${styles.heroCard}`}>
            <div className={styles.heroEyebrow}>External boundary</div>
            <h1 className={styles.heroTitle}>Integrations</h1>
            <p className={styles.heroBody}>
              This page is the manager-facing entry for external delivery and sync boundaries. It shows channel readiness,
              notification pipeline health, and where Google Sync / payment callbacks belong. It does not implement OAuth,
              queue orchestration, or a full integration control center.
            </p>
            <div className={styles.actionRow}>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load()} disabled={loading} data-integrations-reload>
                {loading ? "Refreshing..." : "Refresh statuses"}
              </button>
              <Link className="fdPillBtn" href="/manager/notifications">
                Notification detail
              </Link>
              <Link className="fdPillBtn" href="/manager/settings/operations">
                Operations policy
              </Link>
              <Link className="fdPillBtn" href="/manager">
                Back to manager
              </Link>
            </div>
            {error ? (
              <div className="error" data-integrations-error>
                {error}
              </div>
            ) : null}
            <div className={styles.sectionGrid}>
              <p className={styles.panelText} data-integrations-pipeline-status>
                Delivery pipeline: {pipelineSummary.status}
              </p>
              <p className={styles.panelText} data-integrations-coverage-summary>
                Reachability: email {coverage?.emailReachableCount ?? 0} / LINE {coverage?.lineReachableCount ?? 0} / simulated-only{" "}
                {coverage?.simulatedOnlyCount ?? 0}
              </p>
              <p className={styles.panelText} data-integrations-last-loaded>
                Last loaded: {formatDateTime(lastLoadedAt)}
              </p>
            </div>
          </article>

          <section className={styles.twoCol}>
            <article className={`fdGlassSubPanel ${styles.card}`}>
              <h2 className={styles.panelTitle}>Integration catalog</h2>
              <p className={styles.panelText}>
                Stable manager-scope data currently exists for notification delivery readiness and coverage. Google Calendar
                Sync and payment callback provider setup remain boundary-only at this level until a dedicated persistence model
                is introduced.
              </p>

              <div className={styles.statsRow}>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>External deliveries</span>
                  <strong className={styles.statValue}>{pipelineSummary.total}</strong>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Sent</span>
                  <strong className={styles.statValue}>{pipelineSummary.sent}</strong>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Failed</span>
                  <strong className={styles.statValue}>{pipelineSummary.failed}</strong>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Retrying / pending</span>
                  <strong className={styles.statValue}>
                    {pipelineSummary.retrying} / {pipelineSummary.pending}
                  </strong>
                </div>
              </div>

              <div className={styles.sectionGrid}>
                {readinessCards.map((item) => (
                  <article
                    key={item.channel}
                    className={`fdGlassCard ${styles.statCard}`}
                    data-integrations-card={item.channel}
                    style={{ alignItems: "flex-start", minHeight: 180 }}
                  >
                    <span className={styles.statLabel}>{titleCaseChannel(item.channel)}</span>
                    <strong className={styles.statValue} data-integrations-status={item.channel}>
                      {item.status}
                    </strong>
                    <p className={styles.panelText} style={{ margin: 0 }}>
                      Provider: {item.provider} / mode: {item.mode}
                    </p>
                    <p className={styles.panelText} style={{ margin: 0 }}>
                      Configured: {item.configured ? "yes" : "no"} / template coverage: {item.templatesReady}
                    </p>
                    <p className={styles.panelText} style={{ margin: 0 }}>
                      Issues: {item.issues.length ? item.issues.join(", ") : "none"}
                    </p>
                  </article>
                ))}
              </div>
            </article>

            <aside className={styles.previewStack}>
              <article className={`fdGlassSubPanel ${styles.card}`}>
                <h2 className={styles.panelTitle}>Read-only external boundaries</h2>
                <div className={styles.sectionGrid}>
                  <div className={`fdGlassCard ${styles.statCard}`} data-integrations-card="google-sync" style={{ alignItems: "flex-start" }}>
                    <span className={styles.statLabel}>Google Calendar Sync</span>
                    <strong className={styles.statValue}>Not configured here</strong>
                    <p className={styles.panelText} style={{ margin: 0 }}>
                      No stable manager-scoped persistence model exists yet for provider credentials or calendar scope.
                    </p>
                  </div>
                  <div className={`fdGlassCard ${styles.statCard}`} data-integrations-card="payment-callback" style={{ alignItems: "flex-start" }}>
                    <span className={styles.statLabel}>Payment callback / webhook</span>
                    <strong className={styles.statValue}>Boundary only</strong>
                    <p className={styles.panelText} style={{ margin: 0 }}>
                      Booking deposit callback handling is provider-route managed. This page surfaces the responsibility boundary,
                      not credential or webhook secret editing.
                    </p>
                  </div>
                </div>
              </article>

              <article className={`fdGlassSubPanel ${styles.card}`} data-integrations-boundaries>
                <h2 className={styles.panelTitle}>Responsibility boundaries</h2>
                <ul className="fdBkDraftAlertList">
                  <li>Notifications delivery health and channel readiness belong here as an external integration surface.</li>
                  <li>Reminder and package policy toggles still belong to Operations & Permissions.</li>
                  <li>Frontdesk booking only consumes outcomes. It does not configure integrations.</li>
                  <li>Google Sync, provider credentials, OAuth tokens, and queue automation are intentionally out of scope here.</li>
                </ul>
              </article>

              <article className={`fdGlassSubPanel ${styles.card}`} data-integrations-out-of-scope>
                <h2 className={styles.panelTitle}>Out of scope for this page</h2>
                <ul className="fdBkDraftAlertList">
                  <li>Auth / activation and any third-party sign-in flow.</li>
                  <li>Full webhook orchestration, retry engines, queue dashboards, or worker controls.</li>
                  <li>Coach, service, plan, package, or waitlist business management.</li>
                  <li>Frontdesk booking creation, draft confirmation, redemption, or schedule maintenance.</li>
                </ul>
              </article>

              <article className={`fdGlassSubPanel ${styles.card}`}>
                <h2 className={styles.panelTitle}>Recent runtime signals</h2>
                <div className={styles.sectionGrid}>
                  <p className={styles.panelText}>
                    Latest failed external delivery:{" "}
                    <span data-integrations-latest-failed>
                      {pipelineSummary.latestFailed
                        ? `${pipelineSummary.latestFailed.channel || "unknown"} / ${pipelineSummary.latestFailed.error_code || "runtime_error"}`
                        : "none"}
                    </span>
                  </p>
                  <p className={styles.panelText}>
                    Latest retrying delivery:{" "}
                    <span data-integrations-latest-retrying>
                      {pipelineSummary.latestRetry
                        ? `${pipelineSummary.latestRetry.channel || "unknown"} / next ${formatDateTime(pipelineSummary.latestRetry.next_retry_at)}`
                        : "none"}
                    </span>
                  </p>
                  <p className={styles.panelText}>
                    Channel-not-configured signals:{" "}
                    <span data-integrations-channel-unconfigured>{pipelineSummary.channelNotConfigured}</span>
                  </p>
                </div>
              </article>
            </aside>
          </section>
        </section>
      </section>
    </main>
  );
}
