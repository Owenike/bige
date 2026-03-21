"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PremiumToggleSwitch } from "../../../../components/premium-toggle-switch";
import type { StoreBookingSettings, StorefrontPayload } from "../../../../types/storefront";
import styles from "../settings.module.css";

type ManagerStorefrontPayload = StorefrontPayload & {
  error?: string;
};

export default function ManagerOperationsSettingsPage() {
  const [payload, setPayload] = useState<StorefrontPayload | null>(null);
  const [form, setForm] = useState<StoreBookingSettings | null>(null);
  const [branchId, setBranchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load(nextBranchId?: string) {
    const targetBranchId = typeof nextBranchId === "string" ? nextBranchId : branchId;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const query = targetBranchId ? `?branchId=${encodeURIComponent(targetBranchId)}` : "";
      const res = await fetch(`/api/manager/storefront${query}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as ManagerStorefrontPayload | null;
      if (!res.ok || !data) {
        setError(data?.error || "Failed to load operations settings.");
        return;
      }
      setPayload(data);
      setForm(data.bookingSettings);
      setBranchId(data.branch?.id || "");
    } catch {
      setError("Failed to load operations settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/storefront", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_booking_settings",
          branchId: branchId || null,
          bookingSettings: form,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error || "Failed to save operations settings.");
        return;
      }
      await load(branchId);
      setMessage("Operations settings saved.");
    } catch {
      setError("Failed to save operations settings.");
    } finally {
      setSaving(false);
    }
  }

  const summary = useMemo(() => {
    if (!form) return null;
    return [
      {
        title: "Booking window",
        value: `${form.bookingWindowDays} days / min advance ${form.minAdvanceMinutes} mins`,
      },
      {
        title: "Slot policy",
        value: `${form.slotIntervalMinutes} minute intervals / timezone ${form.timezone}`,
      },
      {
        title: "Cross-branch / coach rule",
        value: form.crossStoreTherapistEnabled ? "Enabled" : "Disabled",
      },
      {
        title: "Customer controls",
        value: `Cancel ${form.allowCustomerCancel ? `${form.latestCancelHours}h` : "off"} / Reschedule ${
          form.allowCustomerReschedule ? `${form.latestRescheduleHours}h` : "off"
        }`,
      },
      {
        title: "Notification defaults",
        value: form.notificationsEnabled
          ? `Notifications on / day-before ${form.reminderDayBeforeEnabled ? "yes" : "no"} / hour-before ${
              form.reminderHourBeforeEnabled ? "yes" : "no"
            }`
          : "Notifications disabled",
      },
      {
        title: "Package & redemption gate",
        value: form.packagesEnabled ? "Package usage enabled" : "Package usage disabled",
      },
    ];
  }, [form]);

  if (!form || !payload) {
    return (
      <main className="fdGlassScene">
        <section className="fdGlassBackdrop">
          <section className={styles.page}>
            <article className={`fdGlassPanel ${styles.heroCard}`}>
              <div className={styles.heroEyebrow}>Operations governance</div>
              <h1 className={styles.heroTitle}>Operations & Permissions</h1>
              <p className={styles.heroBody}>
                {loading ? "Loading operations settings..." : error || "No operations settings loaded yet."}
              </p>
            </article>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="fdGlassScene" data-ops-page>
      <section className="fdGlassBackdrop">
        <section className={styles.page}>
          <article className={`fdGlassPanel ${styles.heroCard}`}>
            <div className={styles.heroEyebrow}>Operations governance</div>
            <h1 className={styles.heroTitle}>Operations & Permissions</h1>
            <p className={styles.heroBody} data-ops-hero-body>
              This page manages global operating defaults and boundary-level policy. It does not implement auth, activation,
              or a full RBAC editor. Frontdesk, staffing, services, plans, and packages each keep their own dedicated pages.
            </p>
            <div className={styles.actionRow}>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void save()} disabled={saving} data-ops-save>
                {saving ? "Saving..." : "Save operations settings"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load(branchId)} disabled={loading} data-ops-reload>
                {loading ? "Refreshing..." : "Reload"}
              </button>
              <Link className="fdPillBtn" href="/manager/settings">
                Settings hub
              </Link>
              <Link className="fdPillBtn" href="/manager">
                Back to manager
              </Link>
            </div>
            {error ? (
              <div className="error" data-ops-error>
                {error}
              </div>
            ) : null}
            {message ? (
              <div className="ok" data-ops-message>
                {message}
              </div>
            ) : null}
          </article>

          <section className={styles.twoCol}>
            <article className={`fdGlassSubPanel ${styles.card}`}>
              <div className={styles.branchRow}>
                <label className={styles.field} style={{ minWidth: 260 }}>
                  <span className={styles.label}>Policy scope</span>
                  <select
                    className={styles.select}
                    value={branchId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setBranchId(value);
                      void load(value);
                    }}
                    data-ops-branch-select
                  >
                    <option value="">Tenant default operations policy</option>
                    {payload.branches.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.code ? ` (${item.code})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.note} data-ops-scope-note>
                  Current source: {form.resolvedFromScope === "branch_override" ? "branch override" : "tenant default"}
                </p>
              </div>

              <div className={styles.toggleStack}>
                <PremiumToggleSwitch
                  checked={form.packagesEnabled}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, packagesEnabled: checked } : prev))}
                  label="Enable package usage"
                  description="Controls whether package-based booking and redemption are available to downstream booking flows."
                />
                <PremiumToggleSwitch
                  checked={form.notificationsEnabled}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, notificationsEnabled: checked } : prev))}
                  label="Enable booking notifications"
                  description="Keeps reminder and deposit follow-up defaults in the central policy layer."
                />
                <PremiumToggleSwitch
                  checked={form.crossStoreTherapistEnabled}
                  onCheckedChange={(checked) =>
                    setForm((prev) => (prev ? { ...prev, crossStoreTherapistEnabled: checked } : prev))
                  }
                  label="Allow cross-branch therapist conflicts"
                  description="Decides whether availability checks treat therapists as globally shared across branches."
                />
                <PremiumToggleSwitch
                  checked={form.allowCustomerCancel}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, allowCustomerCancel: checked } : prev))}
                  label="Allow customer cancel"
                  description="Defines the customer-facing cancellation boundary without moving cancellation workflows into frontdesk."
                />
                <PremiumToggleSwitch
                  checked={form.allowCustomerReschedule}
                  onCheckedChange={(checked) =>
                    setForm((prev) => (prev ? { ...prev, allowCustomerReschedule: checked } : prev))
                  }
                  label="Allow customer reschedule"
                  description="Defines customer reschedule policy while leaving actual booking operations in frontdesk and storefront flows."
                />
              </div>

              <div className={styles.inlinePair}>
                <label className={styles.field}>
                  <span className={styles.label}>Booking window days</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="1"
                    step="1"
                    value={form.bookingWindowDays}
                    onChange={(event) =>
                      setForm((prev) => (prev ? { ...prev, bookingWindowDays: Number(event.target.value || 30) } : prev))
                    }
                    data-ops-booking-window
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Min advance minutes</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="0"
                    step="5"
                    value={form.minAdvanceMinutes}
                    onChange={(event) =>
                      setForm((prev) => (prev ? { ...prev, minAdvanceMinutes: Number(event.target.value || 0) } : prev))
                    }
                    data-ops-min-advance
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Slot interval minutes</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="5"
                    step="5"
                    value={form.slotIntervalMinutes}
                    onChange={(event) =>
                      setForm((prev) => (prev ? { ...prev, slotIntervalMinutes: Number(event.target.value || 30) } : prev))
                    }
                    data-ops-slot-interval
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Timezone</span>
                  <input
                    className={styles.input}
                    value={form.timezone}
                    onChange={(event) => setForm((prev) => (prev ? { ...prev, timezone: event.target.value } : prev))}
                    data-ops-timezone
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Latest cancel hours</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="0"
                    step="1"
                    value={form.latestCancelHours}
                    onChange={(event) =>
                      setForm((prev) => (prev ? { ...prev, latestCancelHours: Number(event.target.value || 0) } : prev))
                    }
                    data-ops-cancel-hours
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Latest reschedule hours</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="0"
                    step="1"
                    value={form.latestRescheduleHours}
                    onChange={(event) =>
                      setForm((prev) => (prev ? { ...prev, latestRescheduleHours: Number(event.target.value || 0) } : prev))
                    }
                    data-ops-reschedule-hours
                  />
                </label>
              </div>

              <PremiumToggleSwitch
                checked={form.reminderDayBeforeEnabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => (prev ? { ...prev, reminderDayBeforeEnabled: checked } : prev))
                }
                label="Day-before reminder"
                description="Simple notification policy flag only. Delivery channel setup remains outside this page."
              />
              <PremiumToggleSwitch
                checked={form.reminderHourBeforeEnabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => (prev ? { ...prev, reminderHourBeforeEnabled: checked } : prev))
                }
                label="Hour-before reminder"
                description="Keeps reminder policy centralized without turning this page into a job or channel configuration center."
              />

              <label className={styles.field}>
                <span className={styles.label}>Internal operations note</span>
                <textarea
                  className={styles.textarea}
                  value={form.notes}
                  onChange={(event) => setForm((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
                  data-ops-notes
                />
              </label>
            </article>

            <aside className={styles.previewStack}>
              <article className={`fdGlassSubPanel ${styles.card}`}>
                <h2 className={styles.panelTitle}>Current policy summary</h2>
                <div className={styles.sectionGrid}>
                  {summary?.map((item) => (
                    <div key={item.title}>
                      <p className={styles.label} style={{ margin: 0 }}>{item.title}</p>
                      <p
                        className={styles.panelText}
                        data-ops-summary={item.title}
                        data-ops-summary-window={item.title === "Booking window" ? item.value : undefined}
                        data-ops-summary-slot={item.title === "Slot policy" ? item.value : undefined}
                        data-ops-summary-cross-store={item.title === "Cross-branch / coach rule" ? item.value : undefined}
                        data-ops-summary-customer={item.title === "Customer controls" ? item.value : undefined}
                        data-ops-summary-notifications={item.title === "Notification defaults" ? item.value : undefined}
                        data-ops-summary-packages={item.title === "Package & redemption gate" ? item.value : undefined}
                      >
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className={`fdGlassSubPanel ${styles.card}`} data-ops-role-boundaries>
                <h2 className={styles.panelTitle}>Responsibility boundary</h2>
                <div className={styles.sectionGrid}>
                  <p className={styles.panelText}>
                    Frontdesk bookings consume these policy results but do not edit them. Use{" "}
                    <Link href="/frontdesk/bookings">/frontdesk/bookings</Link> for scheduling work only.
                  </p>
                  <p className={styles.panelText}>
                    Coach master data stays on <Link href="/manager/therapists">/manager/therapists</Link>.
                  </p>
                  <p className={styles.panelText}>
                    Availability and blocked time stay on <Link href="/manager/coach-slots">/manager/coach-slots</Link>.
                  </p>
                  <p className={styles.panelText}>
                    Service master data stays on <Link href="/manager/services">/manager/services</Link>.
                  </p>
                  <p className={styles.panelText}>
                    Entitlement rules and sale-layer templates stay on <Link href="/manager/plans">/manager/plans</Link> and{" "}
                    <Link href="/manager/packages">/manager/packages</Link>.
                  </p>
                </div>
              </article>

              <article className={`fdGlassSubPanel ${styles.card}`} data-ops-out-of-scope>
                <h2 className={styles.panelTitle}>Out of scope for this page</h2>
                <ul className="fdBkDraftAlertList" style={{ margin: 0 }}>
                  <li>Auth / activation flows</li>
                  <li>Full RBAC / permission matrix editor</li>
                  <li>Coach master data, services, plans, or packages CRUD beyond linked policy consumption</li>
                  <li>Waitlist or external integration implementation</li>
                  <li>Frontdesk booking creation, drag-and-drop, or redemption execution</li>
                </ul>
              </article>
            </aside>
          </section>
        </section>
      </section>
    </main>
  );
}
