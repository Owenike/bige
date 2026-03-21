"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PremiumToggleSwitch } from "../../../components/premium-toggle-switch";
import styles from "./therapists.module.css";
import type { TherapistManagementPayload } from "../../../types/therapist-scheduling";

export default function ManagerTherapistsPage() {
  const [payload, setPayload] = useState<TherapistManagementPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedTherapistId, setSelectedTherapistId] = useState<string>("");
  const [branchSelections, setBranchSelections] = useState<string[]>([]);
  const [primaryBranchId, setPrimaryBranchId] = useState<string>("");
  const [therapistActive, setTherapistActive] = useState(true);

  const selectedTherapist = useMemo(
    () => payload?.therapists.find((item) => item.id === selectedTherapistId) || payload?.therapists[0] || null,
    [payload?.therapists, selectedTherapistId],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/manager/therapists", { cache: "no-store" });
      const next = (await response.json()) as TherapistManagementPayload & { error?: string };
      if (!response.ok) throw new Error(next.error || "Failed to load coach master data");
      setPayload(next);
      const firstId = selectedTherapistId || next.therapists[0]?.id || "";
      setSelectedTherapistId(firstId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load coach master data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTherapist) return;
    setBranchSelections(selectedTherapist.branchIds);
    setPrimaryBranchId(selectedTherapist.primaryBranchId || selectedTherapist.branchIds[0] || "");
    setTherapistActive(selectedTherapist.isActive);
  }, [selectedTherapist]);

  async function saveTherapist() {
    if (!selectedTherapist) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/manager/therapists", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          therapistId: selectedTherapist.id,
          primaryBranchId: primaryBranchId || null,
          branchIds: branchSelections,
          isActive: therapistActive,
        }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Failed to save coach profile");
      setMessage("Coach profile updated.");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save coach profile");
    } finally {
      setSaving(false);
    }
  }

  const branches = payload?.branches || [];

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Coach Master Data</div>
          <h1 className={styles.title}>Formal coach identity, branch coverage, and activation status.</h1>
          <p className={styles.heroText}>
            This page is the formal manager entry for coach master data. It keeps identity, branch assignment, and active
            status separate from scheduling rules, blocked times, services, and frontdesk booking operations.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.linkButton} href="/manager">
              Back to dashboard
            </Link>
            <Link className={styles.linkButton} href="/manager/coach-slots">
              Scheduling / blocked slots
            </Link>
            <Link className={styles.linkButton} href="/manager/services">
              Services
            </Link>
            <Link className={styles.linkButton} href="/manager/settings/operations">
              Operations & permissions
            </Link>
          </div>
        </section>

        <div className={styles.statusBar}>
          {message ? <div className={styles.message}>{message}</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}
        </div>

        <section className={styles.layout}>
          <aside className={styles.panel}>
            <h2 className={styles.panelTitle}>Coaches</h2>
            <p className={styles.panelText}>
              Select a coach, then review and update master data only. Scheduling and block rules move to dedicated pages.
            </p>
            <div className={styles.list}>
              {(payload?.therapists || []).map((therapist) => (
                <button
                  key={therapist.id}
                  type="button"
                  className={styles.listItem}
                  data-active={selectedTherapist?.id === therapist.id}
                  onClick={() => setSelectedTherapistId(therapist.id)}
                >
                  <div className={styles.itemTitleRow}>
                    <span className={styles.itemTitle}>{therapist.displayName || therapist.id.slice(0, 8)}</span>
                    <span className={styles.badge}>{therapist.isActive ? "Active" : "Inactive"}</span>
                  </div>
                  <p className={styles.meta}>{therapist.primaryBranchName || "No primary branch"}</p>
                  <p className={styles.subtle}>
                    {therapist.branchLinks.map((item) => item.branchName || item.branchId).join(" / ") || "No branch links"}
                  </p>
                </button>
              ))}
            </div>
          </aside>

          <section className={styles.grid}>
            <article className={styles.card}>
              <div className={styles.rowBetween}>
                <div>
                  <h2 className={styles.panelTitle}>{selectedTherapist?.displayName || "Select coach"}</h2>
                  <p className={styles.panelText}>
                    Keep coach identity, primary branch, branch coverage, active services, and active status here.
                  </p>
                </div>
                {selectedTherapist ? (
                  <PremiumToggleSwitch
                    checked={therapistActive}
                    onCheckedChange={setTherapistActive}
                    label="Coach active"
                    description="Inactive coaches remain in records but should not be used by later scheduling flows."
                  />
                ) : null}
              </div>

              {selectedTherapist ? (
                <div className={styles.twoCol}>
                  <div className={styles.fieldGrid}>
                    <label className={styles.fieldLabel}>
                      Coach ID
                      <input className={styles.input} value={selectedTherapist.id} readOnly />
                    </label>
                    <label className={styles.fieldLabel}>
                      Role
                      <input className={styles.input} value={selectedTherapist.role} readOnly />
                    </label>
                    <label className={styles.fieldLabel}>
                      Primary branch
                      <select className={styles.select} value={primaryBranchId} onChange={(event) => setPrimaryBranchId(event.target.value)}>
                        <option value="">No primary branch</option>
                        {branchSelections.map((branchId) => {
                          const branch = branches.find((item) => item.id === branchId);
                          return (
                            <option key={branchId} value={branchId}>
                              {branch?.name || branchId}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <div className={styles.fieldLabel}>
                      Active services inherited from branch links
                      <div className={styles.servicePills}>
                        {selectedTherapist.serviceNames.length > 0 ? (
                          selectedTherapist.serviceNames.map((item) => (
                            <span key={item} className={styles.pill}>
                              {item}
                            </span>
                          ))
                        ) : (
                          <span className={styles.pill}>No active services found</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={styles.fieldGrid}>
                    <div className={styles.fieldLabel}>
                      Branch coverage
                      <div className={styles.checkboxList}>
                        {branches.map((branch) => {
                          const checked = branchSelections.includes(branch.id);
                          return (
                            <label key={branch.id} className={styles.checkboxRow}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setBranchSelections((current) =>
                                    event.target.checked
                                      ? Array.from(new Set([...current, branch.id]))
                                      : current.filter((item) => item !== branch.id),
                                  );
                                }}
                              />
                              <span>{branch.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className={styles.actions}>
                <button type="button" className={styles.primaryButton} disabled={!selectedTherapist || saving} onClick={() => void saveTherapist()}>
                  {saving ? "Saving..." : "Save coach profile"}
                </button>
              </div>
            </article>

            <article className={styles.card}>
              <h2 className={styles.panelTitle}>Out of scope for this page</h2>
              <p className={styles.panelText}>
                This page does not maintain recurring schedules, blocked time, services, entitlement rules, permission
                policies, or frontdesk booking operations. Use the dedicated manager pages instead.
              </p>
              <div className={styles.actions}>
                <Link className={styles.linkButton} href="/manager/coach-slots">
                  Scheduling / blocked slots
                </Link>
                <Link className={styles.linkButton} href="/manager/services">
                  Services
                </Link>
                <Link className={styles.linkButton} href="/manager/plans">
                  Plan rules
                </Link>
                <Link className={styles.linkButton} href="/manager/settings/operations">
                  Operations & permissions
                </Link>
              </div>
            </article>
          </section>
        </section>

        {loading ? <div className={styles.message}>Loading coach master data...</div> : null}
      </div>
    </main>
  );
}
