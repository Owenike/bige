"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../platform-overview.module.css";

type CapabilityState = {
  key: string;
  label: string;
  platformAllowed: boolean;
  storeEnabled: boolean;
  effectiveEnabled: boolean;
};

type OverviewItem = {
  tenantId: string;
  tenantName: string;
  tenantStatus: string | null;
  branchCount: number;
  therapistCount: number;
  serviceCount: number;
  bookingTotal: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  completionRate: number;
  depositPendingCount: number;
  packageReservedSessionsCount: number;
  packageConsumedSessionsCount: number;
  notificationQueuedCount: number;
  notificationFailedCount: number;
  recentActivityAt: string | null;
  supportScore: number;
  supportFlags: string[];
  capabilities: CapabilityState[];
  storefront: {
    brandName: string | null;
    configured: boolean;
    activeAssetCount: number;
  };
};

type OverviewResponse = {
  generatedAt: string;
  range: { preset: string; dateFrom: string; dateTo: string };
  summary: {
    tenantTotal: number;
    activeTenantCount: number;
    bookingTotal: number;
    completedCount: number;
    cancelledCount: number;
    noShowCount: number;
    depositPendingCount: number;
    notificationsFailedCount: number;
    packageConsumedSessionsCount: number;
  };
  items: OverviewItem[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  warnings: string[];
};

function formatPercent(value: number) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-TW");
}

function capabilitySummary(capabilities: CapabilityState[]) {
  return capabilities
    .filter((item) => item.effectiveEnabled)
    .map((item) => item.label)
    .slice(0, 3)
    .join(" / ");
}

export default function PlatformOverviewPage() {
  const [preset, setPreset] = useState("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tenantStatus, setTenantStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextPage = page) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        preset,
        tenant_status: tenantStatus,
        search,
        page: String(nextPage),
        page_size: "12",
      });
      if (preset === "custom") {
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);
      }
      const response = await fetch(`/api/platform/overview?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || payload?.message || "Failed to load platform overview");
      const next = payload?.data || payload;
      setData(next);
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load platform overview");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Platform / Multi-tenant overview</div>
        <h1 className={styles.title}>Cross-tenant booking operations</h1>
        <p className={styles.subtitle}>
          Platform admin can scan booking volume, payment risk, package usage, reminder health, and final booking capability states across every tenant without changing manager-side reporting logic.
        </p>
        <div className={styles.actions} style={{ marginTop: 14 }}>
          <Link className="fdPillBtn" href="/platform-admin">Legacy console</Link>
          <Link className="fdPillBtn" href="/platform-admin/feature-flags">Feature flags</Link>
          <Link className="fdPillBtn" href="/platform-admin/tenant-ops">Tenant ops support</Link>
        </div>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.presetRow}>
          {["today", "this_week", "this_month", "custom"].map((item) => (
            <button key={item} type="button" className="fdPillBtn" onClick={() => setPreset(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Search</span>
            <input className={styles.control} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tenant name / id / capability" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Tenant status</span>
            <select className={styles.control} value={tenantStatus} onChange={(event) => setTenantStatus(event.target.value)}>
              <option value="all">All tenants</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Date from</span>
            <input className={styles.control} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} disabled={preset !== "custom"} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Date to</span>
            <input className={styles.control} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} disabled={preset !== "custom"} />
          </label>
          <div className={styles.actions} style={{ alignItems: "end" }}>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load(1)} disabled={loading}>
              {loading ? "Loading..." : "Apply filters"}
            </button>
          </div>
        </div>
      </section>

      {error ? <div className={`${styles.message} ${styles.error}`}>{error}</div> : null}
      {data?.warnings.length ? (
        <section className={`${styles.card} ${styles.warning}`}>
          <div className={styles.label}>Data warnings</div>
          <div className={styles.list} style={{ marginTop: 10 }}>
            {data.warnings.map((warning) => (
              <div key={warning} className={styles.muted}>{warning}</div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.metricGrid}>
        <div className={styles.card}><div className={styles.metricLabel}>Tenants</div><div className={styles.metricValue}>{data?.summary.tenantTotal ?? "-"}</div><div className={styles.metricSub}>{data?.summary.activeTenantCount ?? 0} active</div></div>
        <div className={styles.card}><div className={styles.metricLabel}>Bookings</div><div className={styles.metricValue}>{data?.summary.bookingTotal ?? "-"}</div><div className={styles.metricSub}>{data?.summary.completedCount ?? 0} completed</div></div>
        <div className={styles.card}><div className={styles.metricLabel}>Cancelled</div><div className={styles.metricValue}>{data?.summary.cancelledCount ?? "-"}</div><div className={styles.metricSub}>{data?.summary.noShowCount ?? 0} no-show</div></div>
        <div className={styles.card}><div className={styles.metricLabel}>Deposit pending</div><div className={styles.metricValue}>{data?.summary.depositPendingCount ?? "-"}</div><div className={styles.metricSub}>Current pending bookings</div></div>
        <div className={styles.card}><div className={styles.metricLabel}>Notification failures</div><div className={styles.metricValue}>{data?.summary.notificationsFailedCount ?? "-"}</div><div className={styles.metricSub}>Queued / failed delivery watch</div></div>
        <div className={styles.card}><div className={styles.metricLabel}>Package consumed</div><div className={styles.metricValue}>{data?.summary.packageConsumedSessionsCount ?? "-"}</div><div className={styles.metricSub}>Sessions consumed in range</div></div>
      </section>

      <section className={styles.tenantGrid}>
        {data?.items.map((item) => (
          <article key={item.tenantId} className={styles.tenantCard}>
            <div className={styles.tenantTop}>
              <div>
                <h2 className={styles.tenantName}>{item.tenantName}</h2>
                <div className={styles.secondary}>{item.storefront.brandName || "Brand content pending"} · last activity {formatDate(item.recentActivityAt)}</div>
              </div>
              <span className={`${styles.badge} ${item.tenantStatus === "active" ? styles.badgeActive : styles.badgeMuted}`}>{item.tenantStatus || "unknown"}</span>
            </div>
            <div className={styles.miniGrid}>
              <div className={styles.miniItem}><div className={styles.label}>Branches / Therapists</div><div className={styles.miniValue}>{item.branchCount} / {item.therapistCount}</div></div>
              <div className={styles.miniItem}><div className={styles.label}>Bookings</div><div className={styles.miniValue}>{item.bookingTotal}</div></div>
              <div className={styles.miniItem}><div className={styles.label}>Completion rate</div><div className={styles.miniValue}>{formatPercent(item.completionRate)}</div></div>
              <div className={styles.miniItem}><div className={styles.label}>Notifications</div><div className={styles.miniValue}>{item.notificationQueuedCount} queued / {item.notificationFailedCount} failed</div></div>
              <div className={styles.miniItem}><div className={styles.label}>Deposit pending</div><div className={styles.miniValue}>{item.depositPendingCount}</div></div>
              <div className={styles.miniItem}><div className={styles.label}>Packages</div><div className={styles.miniValue}>{item.packageReservedSessionsCount} reserved / {item.packageConsumedSessionsCount} consumed</div></div>
            </div>
            <div className={styles.capabilityMeta}>
              <div className={styles.label}>Final capability state</div>
              <div className={styles.secondary}>{capabilitySummary(item.capabilities) || "No active booking capability"}</div>
              <div className={styles.chipRow}>
                {item.capabilities.map((capability) => (
                  <span key={capability.key} className={styles.statusChip}>
                    {capability.label}: {capability.effectiveEnabled ? "On" : "Off"}
                  </span>
                ))}
              </div>
            </div>
            <div className={styles.rowBetween}>
              <div className={styles.secondary}>Support score {item.supportScore} · {item.storefront.configured ? `${item.storefront.activeAssetCount} assets` : "Brand setup incomplete"}</div>
              <Link className="fdPillBtn fdPillBtnPrimary" href={`/platform-admin/tenants/${item.tenantId}`}>Open drilldown</Link>
            </div>
          </article>
        ))}
      </section>

      <section className={styles.tableCard}>
        <div className={styles.rowBetween}>
          <div>
            <div className={styles.label}>Pagination</div>
            <div className={styles.secondary}>Page {data?.pagination.page ?? 1} / {data?.pagination.totalPages ?? 1} · {data?.pagination.totalItems ?? 0} tenants</div>
          </div>
          <div className={styles.actions}>
            <button type="button" className="fdPillBtn" onClick={() => void load(Math.max(1, page - 1))} disabled={!data || page <= 1 || loading}>Previous</button>
            <button type="button" className="fdPillBtn" onClick={() => void load(page + 1)} disabled={!data || page >= (data.pagination.totalPages || 1) || loading}>Next</button>
          </div>
        </div>
      </section>
    </main>
  );
}
