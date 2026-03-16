"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PremiumToggleSwitch } from "../../../../components/premium-toggle-switch";
import styles from "../../platform-overview.module.css";

type CapabilityState = {
  key: string;
  label: string;
  description: string;
  platformAllowed: boolean;
  storeEnabled: boolean;
  effectiveEnabled: boolean;
};

type DetailResponse = {
  generatedAt: string;
  range: { preset: string; dateFrom: string; dateTo: string };
  tenant: { tenantId: string; tenantName: string; tenantStatus: string | null };
  bookingSummary: {
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
  };
  paymentSummary: {
    depositPendingCount: number;
    depositPaidTotal: number;
    outstandingTotal: number;
    singleBookingRevenueTotal: number;
    fullyPaidCount: number;
  };
  packageSummary: {
    activeEntryPassCount: number;
    activeTemplateCount: number;
    reservedSessionsCount: number;
    consumedSessionsCount: number;
    activePackageBookingCount: number;
  };
  notificationSummary: {
    queuedCount: number;
    sentCount: number;
    failedCount: number;
    cancelledCount: number;
    reminderQueuedCount: number;
    reminderSentCount: number;
    depositPendingQueuedCount: number;
    latestNotificationAt: string | null;
  };
  bookingSettings: {
    packagesEnabled: boolean;
    depositsEnabled: boolean;
    allowCustomerReschedule: boolean;
    allowCustomerCancel: boolean;
    notificationsEnabled: boolean;
    crossStoreTherapistEnabled: boolean;
  };
  capabilities: CapabilityState[];
  storefront: {
    brandName: string | null;
    configured: boolean;
    hasHeroImage: boolean;
    hasMobileImage: boolean;
    activeAssetCount: number;
    updatedAt: string | null;
  };
  branches: Array<{ branchId: string; name: string; code: string | null; therapistCount: number; serviceCount: number; bookingCount: number; completedCount: number; isActive: boolean }>;
  therapists: Array<{ therapistId: string; displayName: string; branchName: string | null; bookingCount: number; completedCount: number; packageConsumedSessionsCount: number }>;
  services: Array<{ serviceId: string; name: string; code: string | null; bookingCount: number; completedCount: number; averagePrice: number }>;
  risk: { supportScore: number; supportFlags: string[]; warnings: string[] };
};

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value || 0);
}

function percent(value: number) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-TW");
}

export default function PlatformTenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = String(params?.tenantId || "");
  const [preset, setPreset] = useState("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ preset });
      if (preset === "custom") {
        if (dateFrom) query.set("date_from", dateFrom);
        if (dateTo) query.set("date_to", dateTo);
      }
      const response = await fetch(`/api/platform/tenants/${tenantId}?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || payload?.message || "Failed to load tenant detail");
      setData(payload?.data || payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load tenant detail");
    } finally {
      setLoading(false);
    }
  }

  async function updateCapability(mode: "platform_capability" | "store_setting", capabilityKey: string, enabled: boolean) {
    setSavingKey(`${mode}:${capabilityKey}`);
    setError(null);
    try {
      const response = await fetch(`/api/platform/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, capabilityKey, enabled }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || payload?.message || "Failed to update capability");
      setData(payload?.data || payload);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update capability");
    } finally {
      setSavingKey(null);
    }
  }

  useEffect(() => {
    if (!tenantId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  if (!tenantId) return null;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Platform / Tenant drilldown</div>
        <h1 className={styles.title}>{data?.tenant.tenantName || "Loading tenant"} </h1>
        <p className={styles.subtitle}>
          Platform-level capability, store-level booking settings, and final effective booking states are shown together here so you can see exactly why a tenant can or cannot use deposits, packages, reminders, and customer controls.
        </p>
        <div className={styles.actions} style={{ marginTop: 14 }}>
          <Link className="fdPillBtn" href="/platform-admin/overview">Back to overview</Link>
          <Link className="fdPillBtn" href="/platform-admin/feature-flags">Raw feature flags</Link>
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
            <span className={styles.label}>Date from</span>
            <input className={styles.control} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} disabled={preset !== "custom"} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Date to</span>
            <input className={styles.control} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} disabled={preset !== "custom"} />
          </label>
          <div className={styles.actions} style={{ alignItems: "end" }}>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load()} disabled={loading}>
              {loading ? "Loading..." : "Refresh detail"}
            </button>
          </div>
        </div>
      </section>

      {error ? <div className={`${styles.message} ${styles.error}`}>{error}</div> : null}

      <section className={styles.metricGrid}>
        <div className={styles.card}><div className={styles.metricLabel}>Bookings</div><div className={styles.metricValue}>{data?.bookingSummary.bookingTotal ?? "-"}</div><div className={styles.metricSub}>{data?.bookingSummary.completedCount ?? 0} completed / {percent(data?.bookingSummary.completionRate || 0)}</div></div>
        <div className={styles.card}><div className={styles.metricLabel}>Payments</div><div className={styles.metricValue}>{money(data?.paymentSummary.depositPaidTotal || 0)}</div><div className={styles.metricSub}>Deposit paid · {money(data?.paymentSummary.outstandingTotal || 0)} outstanding</div></div>
        <div className={styles.card}><div className={styles.metricLabel}>Packages</div><div className={styles.metricValue}>{data?.packageSummary.consumedSessionsCount ?? "-"}</div><div className={styles.metricSub}>{data?.packageSummary.reservedSessionsCount ?? 0} reserved / {data?.packageSummary.activeEntryPassCount ?? 0} active passes</div></div>
        <div className={styles.card}><div className={styles.metricLabel}>Notifications</div><div className={styles.metricValue}>{data?.notificationSummary.queuedCount ?? "-"}</div><div className={styles.metricSub}>{data?.notificationSummary.failedCount ?? 0} failed / {data?.notificationSummary.reminderSentCount ?? 0} reminders sent</div></div>
      </section>

      <section className={styles.splitGrid}>
        <div className={styles.panel}>
          <div className={styles.rowBetween}>
            <div>
              <div className={styles.label}>Booking + storefront summary</div>
              <div className={styles.secondary}>Last activity {formatDate(data?.bookingSummary.recentActivityAt || null)}</div>
            </div>
            <span className={styles.badge}>{data?.tenant.tenantStatus || "unknown"}</span>
          </div>
          <div className={styles.list} style={{ marginTop: 12 }}>
            <div className={styles.listItem}><strong>{data?.storefront.brandName || "Brand not named yet"}</strong><span className={styles.secondary}>{data?.storefront.configured ? `${data?.storefront.activeAssetCount || 0} active brand assets` : "Storefront configuration incomplete"}</span></div>
            <div className={styles.listItem}><strong>Deposit pending</strong><span className={styles.secondary}>{data?.paymentSummary.depositPendingCount || 0} current bookings are waiting for deposit payment</span></div>
            <div className={styles.listItem}><strong>Notification health</strong><span className={styles.secondary}>{data?.notificationSummary.queuedCount || 0} queued / {data?.notificationSummary.failedCount || 0} failed / latest {formatDate(data?.notificationSummary.latestNotificationAt || null)}</span></div>
            <div className={styles.listItem}><strong>Risk flags</strong><span className={styles.secondary}>{data?.risk.supportFlags.join(" / ") || "No current platform support flags"}</span></div>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.label}>Feature capability matrix</div>
          <div className={styles.list} style={{ marginTop: 12 }}>
            {data?.capabilities.map((capability) => (
              <div key={capability.key} className={styles.capabilityCard}>
                <div className={styles.capabilityMeta}>
                  <strong>{capability.label}</strong>
                  <span className={styles.secondary}>{capability.description}</span>
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusChip}>Platform: {capability.platformAllowed ? "Allowed" : "Blocked"}</span>
                  <span className={styles.statusChip}>Store: {capability.storeEnabled ? "Enabled" : "Disabled"}</span>
                  <span className={styles.statusChip}>Effective: {capability.effectiveEnabled ? "On" : "Off"}</span>
                </div>
                <div className={styles.toggleGrid}>
                  <PremiumToggleSwitch
                    checked={capability.platformAllowed}
                    onCheckedChange={(checked) => void updateCapability("platform_capability", capability.key, checked)}
                    label="Platform allows"
                    description="Platform-level capability override"
                    disabled={savingKey !== null}
                  />
                  <PremiumToggleSwitch
                    checked={capability.storeEnabled}
                    onCheckedChange={(checked) => void updateCapability("store_setting", capability.key, checked)}
                    label="Store enabled"
                    description="Tenant default booking setting"
                    disabled={savingKey !== null}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.splitGrid}>
        <div className={styles.panel}>
          <div className={styles.label}>Branches</div>
          <div className={styles.tableWrap} style={{ marginTop: 10 }}>
            <table className={styles.table}>
              <thead><tr><th>Branch</th><th>Therapists</th><th>Services</th><th>Bookings</th><th>Completed</th></tr></thead>
              <tbody>
                {data?.branches.map((branch) => (
                  <tr key={branch.branchId}>
                    <td>{branch.name}<div className={styles.secondary}>{branch.code || "-"}</div></td>
                    <td>{branch.therapistCount}</td>
                    <td>{branch.serviceCount}</td>
                    <td>{branch.bookingCount}</td>
                    <td>{branch.completedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.label}>Therapists</div>
          <div className={styles.tableWrap} style={{ marginTop: 10 }}>
            <table className={styles.table}>
              <thead><tr><th>Therapist</th><th>Branch</th><th>Bookings</th><th>Completed</th><th>Package consumed</th></tr></thead>
              <tbody>
                {data?.therapists.map((therapist) => (
                  <tr key={therapist.therapistId}>
                    <td>{therapist.displayName}</td>
                    <td>{therapist.branchName || "-"}</td>
                    <td>{therapist.bookingCount}</td>
                    <td>{therapist.completedCount}</td>
                    <td>{therapist.packageConsumedSessionsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={styles.splitGrid}>
        <div className={styles.panel}>
          <div className={styles.label}>Services</div>
          <div className={styles.tableWrap} style={{ marginTop: 10 }}>
            <table className={styles.table}>
              <thead><tr><th>Service</th><th>Code</th><th>Bookings</th><th>Completed</th><th>Avg. price</th></tr></thead>
              <tbody>
                {data?.services.map((service) => (
                  <tr key={service.serviceId}>
                    <td>{service.name}</td>
                    <td>{service.code || "-"}</td>
                    <td>{service.bookingCount}</td>
                    <td>{service.completedCount}</td>
                    <td>{money(service.averagePrice || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.label}>Risk + warnings</div>
          <div className={styles.list} style={{ marginTop: 12 }}>
            <div className={styles.listItem}><strong>Support score</strong><span className={styles.secondary}>{data?.risk.supportScore || 0}</span></div>
            <div className={styles.listItem}><strong>Flags</strong><span className={styles.secondary}>{data?.risk.supportFlags.join(" / ") || "No current flags"}</span></div>
            <div className={styles.listItem}><strong>Warnings</strong><span className={styles.secondary}>{data?.risk.warnings.join(" / ") || "No missing platform data source"}</span></div>
          </div>
        </div>
      </section>
    </main>
  );
}
