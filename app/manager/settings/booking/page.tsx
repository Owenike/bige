"use client";

import { useEffect, useMemo, useState } from "react";
import { PremiumCalendar } from "../../../../components/premium-calendar";
import { PremiumToggleSwitch } from "../../../../components/premium-toggle-switch";
import type { StoreBookingSettings, StorefrontPayload } from "../../../../types/storefront";
import styles from "../settings.module.css";

type ManagerStorefrontPayload = StorefrontPayload & {
  error?: string;
};

export default function ManagerBookingSettingsPage() {
  const [payload, setPayload] = useState<StorefrontPayload | null>(null);
  const [form, setForm] = useState<StoreBookingSettings | null>(null);
  const [branchId, setBranchId] = useState("");
  const [calendarDate, setCalendarDate] = useState<string | null>(new Date().toISOString().slice(0, 10));
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
      const res = await fetch(`/api/manager/storefront${query}`);
      const data = (await res.json().catch(() => null)) as ManagerStorefrontPayload | null;
      if (!res.ok || !data) {
        setError(data?.error || "Failed to load booking settings.");
        setLoading(false);
        return;
      }
      setPayload(data);
      setForm(data.bookingSettings);
      setBranchId(data.branch?.id || "");
    } catch {
      setError("Failed to load booking settings.");
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
        setError(data?.error || "Failed to save booking settings.");
        setSaving(false);
        return;
      }
      setMessage("Booking settings saved.");
      await load(branchId);
    } catch {
      setError("Failed to save booking settings.");
    } finally {
      setSaving(false);
    }
  }

  const disabledDates = useMemo(() => {
    const today = new Date();
    const values: string[] = [];
    for (let offset = 0; offset < 14; offset += 1) {
      if (offset % 5 === 0) {
        const date = new Date(today);
        date.setDate(today.getDate() + offset);
        values.push(date.toISOString().slice(0, 10));
      }
    }
    return values;
  }, []);

  if (!form) {
    return (
      <main className="fdGlassScene">
        <section className="fdGlassBackdrop">
          <section className={styles.page}>
            <article className={`fdGlassPanel ${styles.heroCard}`}>
              <div className={styles.heroEyebrow}>Booking rules</div>
              <h1 className={styles.heroTitle}>Store Booking Settings</h1>
              <p className={styles.heroBody}>{loading ? "Loading booking settings..." : error || "No booking settings loaded yet."}</p>
            </article>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className={styles.page}>
          <article className={`fdGlassPanel ${styles.heroCard}`}>
            <div className={styles.heroEyebrow}>Booking governance</div>
            <h1 className={styles.heroTitle}>Store Booking Rules</h1>
            <p className={styles.heroBody}>
              Deposits, customer cancellation and reschedule rules, notification toggles, and cross-store therapist scheduling now have a
              dedicated branch-aware settings model. The premium toggle and calendar are the UI foundation for later booking flow upgrades.
            </p>
            <div className={styles.actionRow}>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving..." : "Save booking rules"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load(branchId)} disabled={loading}>
                {loading ? "Refreshing..." : "Reload"}
              </button>
              <a className="fdPillBtn" href="/manager/settings">
                Settings hub
              </a>
            </div>
            {error ? <div className="error">{error}</div> : null}
            {message ? <div className="ok">{message}</div> : null}
          </article>

          <section className={styles.twoCol}>
            <article className={`fdGlassSubPanel ${styles.card}`}>
              <div className={styles.branchRow}>
                <label className={styles.field} style={{ minWidth: 260 }}>
                  <span className={styles.label}>Store scope</span>
                  <select
                    className={styles.select}
                    value={branchId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setBranchId(value);
                      void load(value);
                    }}
                  >
                    <option value="">Tenant default booking rules</option>
                    {payload?.branches.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.code ? ` (${item.code})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.note}>Use tenant defaults for shared policy, then override per branch where needed.</p>
              </div>

              <div className={styles.toggleStack}>
                <PremiumToggleSwitch
                  checked={form.depositsEnabled}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, depositsEnabled: checked } : prev))}
                  label="Enable deposit flow"
                  description="Turns on deposit state, amount calculation, and storefront disclosure."
                />
                <PremiumToggleSwitch
                  checked={form.packagesEnabled}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, packagesEnabled: checked } : prev))}
                  label="Enable package booking"
                  description="Controls whether customers can use session packages during booking."
                />
                <PremiumToggleSwitch
                  checked={form.allowCustomerReschedule}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, allowCustomerReschedule: checked } : prev))}
                  label="Allow customer reschedule"
                  description="Controls whether public / customer self-service rescheduling is allowed."
                />
                <PremiumToggleSwitch
                  checked={form.allowCustomerCancel}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, allowCustomerCancel: checked } : prev))}
                  label="Allow customer cancel"
                  description="Keeps cancellation access consistent with store policy."
                />
                <PremiumToggleSwitch
                  checked={form.notificationsEnabled}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, notificationsEnabled: checked } : prev))}
                  label="Enable booking notifications"
                  description="Feeds the existing notification and cron stack without forking another system."
                />
                <PremiumToggleSwitch
                  checked={form.crossStoreTherapistEnabled}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, crossStoreTherapistEnabled: checked } : prev))}
                  label="Enable cross-store therapist scheduling"
                  description="Future booking slot validation can respect cross-branch therapist conflicts."
                />
                <PremiumToggleSwitch
                  checked={form.reminderDayBeforeEnabled}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, reminderDayBeforeEnabled: checked } : prev))}
                  label="Send day-before reminder"
                  description="Uses the same notification productization foundation already in the project."
                />
                <PremiumToggleSwitch
                  checked={form.reminderHourBeforeEnabled}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, reminderHourBeforeEnabled: checked } : prev))}
                  label="Send 1-hour reminder"
                  description="Reserved for precise appointment reminders in later phases."
                />
                <PremiumToggleSwitch
                  checked={form.depositReminderEnabled}
                  onCheckedChange={(checked) => setForm((prev) => (prev ? { ...prev, depositReminderEnabled: checked } : prev))}
                  label="Send unpaid deposit reminder"
                  description="Supports deposit follow-up without duplicating notification jobs."
                />
              </div>

              <div className={styles.inlinePair}>
                <label className={styles.field}>
                  <span className={styles.label}>Deposit mode</span>
                  <select
                    className={styles.select}
                    value={form.depositRequiredMode}
                    onChange={(event) =>
                      setForm((prev) => (prev ? { ...prev, depositRequiredMode: event.target.value as StoreBookingSettings["depositRequiredMode"] } : prev))
                    }
                  >
                    <option value="optional">Optional</option>
                    <option value="required">Required</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Deposit calculation</span>
                  <select
                    className={styles.select}
                    value={form.depositCalculationType}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, depositCalculationType: event.target.value as StoreBookingSettings["depositCalculationType"] } : prev,
                      )
                    }
                  >
                    <option value="fixed">Fixed amount</option>
                    <option value="percent">Percentage</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Deposit value</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="0"
                    step="1"
                    value={form.depositValue}
                    onChange={(event) => setForm((prev) => (prev ? { ...prev, depositValue: Number(event.target.value || 0) } : prev))}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Slot interval</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="5"
                    step="5"
                    value={form.slotIntervalMinutes}
                    onChange={(event) => setForm((prev) => (prev ? { ...prev, slotIntervalMinutes: Number(event.target.value || 30) } : prev))}
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
                    onChange={(event) => setForm((prev) => (prev ? { ...prev, latestCancelHours: Number(event.target.value || 0) } : prev))}
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
                    onChange={(event) => setForm((prev) => (prev ? { ...prev, latestRescheduleHours: Number(event.target.value || 0) } : prev))}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Booking window days</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="1"
                    step="1"
                    value={form.bookingWindowDays}
                    onChange={(event) => setForm((prev) => (prev ? { ...prev, bookingWindowDays: Number(event.target.value || 30) } : prev))}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Minimum advance minutes</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="0"
                    step="5"
                    value={form.minAdvanceMinutes}
                    onChange={(event) => setForm((prev) => (prev ? { ...prev, minAdvanceMinutes: Number(event.target.value || 0) } : prev))}
                  />
                </label>
              </div>

              <label className={styles.field}>
                <span className={styles.label}>Timezone</span>
                <input
                  className={styles.input}
                  value={form.timezone}
                  onChange={(event) => setForm((prev) => (prev ? { ...prev, timezone: event.target.value } : prev))}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Internal notes</span>
                <textarea
                  className={styles.textarea}
                  value={form.notes}
                  onChange={(event) => setForm((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
                />
              </label>
            </article>

            <aside className={styles.previewStack}>
              <article className={`fdGlassSubPanel ${styles.card}`}>
                <h2 className={styles.panelTitle}>Premium calendar foundation</h2>
                <p className={styles.panelText}>
                  This is the Phase 1 calendar surface for the later booking flow. It keeps the interaction clean while remaining flexible
                  enough to plug into real slot availability logic in Phase 2.
                </p>
                <PremiumCalendar
                  selectedDate={calendarDate}
                  onSelectDate={setCalendarDate}
                  disabledDates={disabledDates}
                  helperText="Black circle for selected day, pale grey for unavailable days, ready for slot validation integration."
                  actionLabel="Apply date"
                />
              </article>

              <article className={`fdGlassSubPanel ${styles.card}`}>
                <h2 className={styles.panelTitle}>Current policy summary</h2>
                <div className={styles.sectionGrid}>
                  <p className={styles.panelText}>Deposit: {form.depositsEnabled ? `${form.depositCalculationType} / ${form.depositValue}` : "disabled"}</p>
                  <p className={styles.panelText}>Customer cancel: {form.allowCustomerCancel ? "allowed" : "disabled"}</p>
                  <p className={styles.panelText}>Customer reschedule: {form.allowCustomerReschedule ? "allowed" : "disabled"}</p>
                  <p className={styles.panelText}>Notification pipeline: {form.notificationsEnabled ? "enabled" : "disabled"}</p>
                  <p className={styles.panelText}>Cross-store therapist: {form.crossStoreTherapistEnabled ? "enabled" : "disabled"}</p>
                </div>
              </article>
            </aside>
          </section>
        </section>
      </section>
    </main>
  );
}
