"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { PremiumToggleSwitch } from "../../../components/premium-toggle-switch";
import styles from "./therapists.module.css";
import type {
  TherapistBlockItem,
  TherapistManagementPayload,
  TherapistRecurringSchedule,
} from "../../../types/therapist-scheduling";

function toDatetimeLocalValue(date: Date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
}

function fmtDateTime(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function dayLabel(day: number) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day] || String(day);
}

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
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);

  const now = new Date();
  const [scheduleForm, setScheduleForm] = useState({
    branchId: "",
    dayOfWeek: "1",
    startTime: "10:00",
    endTime: "18:00",
    timezone: "Asia/Taipei",
    effectiveFrom: "",
    effectiveUntil: "",
    note: "",
  });
  const [blockForm, setBlockForm] = useState({
    branchId: "",
    startsAt: toDatetimeLocalValue(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
    endsAt: toDatetimeLocalValue(new Date(now.getTime() + 25 * 60 * 60 * 1000)),
    reason: "",
    note: "",
    blockType: "time_off",
  });

  const selectedTherapist = useMemo(
    () => payload?.therapists.find((item) => item.id === selectedTherapistId) || payload?.therapists[0] || null,
    [payload?.therapists, selectedTherapistId],
  );

  const schedules = useMemo(
    () => (payload?.schedules || []).filter((item) => item.coachId === selectedTherapist?.id),
    [payload?.schedules, selectedTherapist?.id],
  );
  const blocks = useMemo(
    () => (payload?.blocks || []).filter((item) => item.coachId === selectedTherapist?.id),
    [payload?.blocks, selectedTherapist?.id],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/manager/therapists", { cache: "no-store" });
      const next = (await response.json()) as TherapistManagementPayload & { error?: string };
      if (!response.ok) throw new Error(next.error || "Failed to load therapist scheduling");
      setPayload(next);
      const firstId = selectedTherapistId || next.therapists[0]?.id || "";
      setSelectedTherapistId(firstId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load therapist scheduling");
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
    setScheduleForm((current) => ({
      ...current,
      branchId: selectedTherapist.primaryBranchId || selectedTherapist.branchIds[0] || "",
    }));
    setBlockForm((current) => ({
      ...current,
      branchId: selectedTherapist.primaryBranchId || selectedTherapist.branchIds[0] || "",
    }));
  }, [selectedTherapist]);

  function beginScheduleEdit(schedule: TherapistRecurringSchedule) {
    setEditingScheduleId(schedule.id);
    setScheduleForm({
      branchId: schedule.branchId || "",
      dayOfWeek: String(schedule.dayOfWeek),
      startTime: schedule.startTime.slice(0, 5),
      endTime: schedule.endTime.slice(0, 5),
      timezone: schedule.timezone,
      effectiveFrom: schedule.effectiveFrom || "",
      effectiveUntil: schedule.effectiveUntil || "",
      note: schedule.note || "",
    });
  }

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
      if (!response.ok) throw new Error(next.error || "Failed to save therapist");
      setMessage("Therapist scope updated.");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save therapist");
    } finally {
      setSaving(false);
    }
  }

  async function submitSchedule(event: FormEvent) {
    event.preventDefault();
    if (!selectedTherapist) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const endpoint = editingScheduleId
        ? `/api/manager/therapist-schedules/${encodeURIComponent(editingScheduleId)}`
        : "/api/manager/therapist-schedules";
      const method = editingScheduleId ? "PATCH" : "POST";
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachId: selectedTherapist.id,
          branchId: scheduleForm.branchId || null,
          dayOfWeek: Number(scheduleForm.dayOfWeek),
          startTime: scheduleForm.startTime,
          endTime: scheduleForm.endTime,
          timezone: scheduleForm.timezone,
          effectiveFrom: scheduleForm.effectiveFrom || null,
          effectiveUntil: scheduleForm.effectiveUntil || null,
          note: scheduleForm.note || null,
          isActive: true,
        }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Failed to save schedule");
      setMessage(editingScheduleId ? "Recurring schedule updated." : "Recurring schedule created.");
      setEditingScheduleId(null);
      setScheduleForm((current) => ({ ...current, note: "" }));
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSchedule(schedule: TherapistRecurringSchedule) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/manager/therapist-schedules/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !schedule.isActive }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Failed to update schedule");
      setMessage(schedule.isActive ? "Recurring schedule paused." : "Recurring schedule activated.");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update schedule");
    } finally {
      setSaving(false);
    }
  }

  async function createBlock(event: FormEvent) {
    event.preventDefault();
    if (!selectedTherapist) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/frontdesk/coach-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachId: selectedTherapist.id,
          branchId: blockForm.branchId || null,
          startsAt: new Date(blockForm.startsAt).toISOString(),
          endsAt: new Date(blockForm.endsAt).toISOString(),
          reason: blockForm.reason,
          note: blockForm.note || null,
          blockType: blockForm.blockType,
        }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Failed to create block");
      setMessage("Exception / blocked time saved.");
      setBlockForm((current) => ({ ...current, reason: "", note: "" }));
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create block");
    } finally {
      setSaving(false);
    }
  }

  async function toggleBlock(block: TherapistBlockItem) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/frontdesk/coach-blocks/${encodeURIComponent(block.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: block.status === "active" ? "cancelled" : "active",
          blockType: block.blockType,
          reason: block.reason || "manager_toggle",
        }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Failed to update block");
      setMessage(block.status === "active" ? "Blocked time removed." : "Blocked time restored.");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update block");
    } finally {
      setSaving(false);
    }
  }

  const branches = payload?.branches || [];

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Therapist Scheduling</div>
          <h1 className={styles.title}>Formal therapist availability, time off, and cross-branch coverage.</h1>
          <p className={styles.heroText}>
            This surface controls the schedule data that now feeds the public booking availability engine and the final
            server-side conflict guard before a booking is inserted.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.linkButton} href="/manager">
              Back to dashboard
            </Link>
            <Link className={styles.linkButton} href="/manager/bookings">
              Open booking overview
            </Link>
            <Link className={styles.linkButton} href="/manager/coach-slots">
              Manual availability windows
            </Link>
          </div>
        </section>

        <div className={styles.statusBar}>
          {message ? <div className={styles.message}>{message}</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}
        </div>

        <section className={styles.layout}>
          <aside className={styles.panel}>
            <h2 className={styles.panelTitle}>Therapists</h2>
            <p className={styles.panelText}>Use the left column to switch therapist, then edit branch coverage, weekly schedule, and exception blocks.</p>
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
                    <span className={styles.badge}>{therapist.isActive ? "Active" : "Paused"}</span>
                  </div>
                  <p className={styles.meta}>{therapist.primaryBranchName || "No primary branch"}</p>
                  <p className={styles.subtle}>{therapist.branchLinks.map((item) => item.branchName || item.branchId).join(" / ") || "No branch links"}</p>
                </button>
              ))}
            </div>
          </aside>

          <section className={styles.grid}>
            <article className={styles.card}>
              <div className={styles.rowBetween}>
                <div>
                  <h2 className={styles.panelTitle}>{selectedTherapist?.displayName || "Select therapist"}</h2>
                  <p className={styles.panelText}>
                    Primary branch, multi-branch coverage, active services, and account status are all kept inside the same tenant scope.
                  </p>
                </div>
                {selectedTherapist ? (
                  <PremiumToggleSwitch
                    checked={therapistActive}
                    onCheckedChange={setTherapistActive}
                    label="Therapist active"
                    description="Inactive therapists are removed from availability and manager selection."
                  />
                ) : null}
              </div>

              {selectedTherapist ? (
                <div className={styles.twoCol}>
                  <div className={styles.fieldGrid}>
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
                      Active services inherited from current branch links
                      <div className={styles.servicePills}>
                        {selectedTherapist.serviceNames.length > 0 ? selectedTherapist.serviceNames.map((item) => <span key={item} className={styles.pill}>{item}</span>) : <span className={styles.pill}>No active services found</span>}
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
                                    event.target.checked ? Array.from(new Set([...current, branch.id])) : current.filter((item) => item !== branch.id),
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
                  {saving ? "Saving..." : "Save therapist scope"}
                </button>
              </div>
            </article>

            <section className={styles.twoCol}>
              <article className={styles.card}>
                <h2 className={styles.panelTitle}>Recurring weekly schedule</h2>
                <p className={styles.panelText}>This becomes the default availability window before booking conflicts and temporary blocks are applied.</p>
                <form className={styles.fieldGrid} onSubmit={submitSchedule}>
                  <label className={styles.fieldLabel}>
                    Branch
                    <select className={styles.select} value={scheduleForm.branchId} onChange={(event) => setScheduleForm((current) => ({ ...current, branchId: event.target.value }))}>
                      <option value="">Any linked branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.twoCol}>
                    <label className={styles.fieldLabel}>
                      Day
                      <select className={styles.select} value={scheduleForm.dayOfWeek} onChange={(event) => setScheduleForm((current) => ({ ...current, dayOfWeek: event.target.value }))}>
                        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                          <option key={day} value={day}>
                            {dayLabel(day)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.fieldLabel}>
                      Timezone
                      <input className={styles.input} value={scheduleForm.timezone} onChange={(event) => setScheduleForm((current) => ({ ...current, timezone: event.target.value }))} />
                    </label>
                  </div>
                  <div className={styles.twoCol}>
                    <label className={styles.fieldLabel}>
                      Start
                      <input className={styles.input} type="time" value={scheduleForm.startTime} onChange={(event) => setScheduleForm((current) => ({ ...current, startTime: event.target.value }))} />
                    </label>
                    <label className={styles.fieldLabel}>
                      End
                      <input className={styles.input} type="time" value={scheduleForm.endTime} onChange={(event) => setScheduleForm((current) => ({ ...current, endTime: event.target.value }))} />
                    </label>
                  </div>
                  <div className={styles.twoCol}>
                    <label className={styles.fieldLabel}>
                      Effective from
                      <input className={styles.input} type="date" value={scheduleForm.effectiveFrom} onChange={(event) => setScheduleForm((current) => ({ ...current, effectiveFrom: event.target.value }))} />
                    </label>
                    <label className={styles.fieldLabel}>
                      Effective until
                      <input className={styles.input} type="date" value={scheduleForm.effectiveUntil} onChange={(event) => setScheduleForm((current) => ({ ...current, effectiveUntil: event.target.value }))} />
                    </label>
                  </div>
                  <label className={styles.fieldLabel}>
                    Note
                    <textarea className={styles.textarea} value={scheduleForm.note} onChange={(event) => setScheduleForm((current) => ({ ...current, note: event.target.value }))} />
                  </label>
                  <div className={styles.actions}>
                    <button type="submit" className={styles.primaryButton} disabled={!selectedTherapist || saving}>
                      {editingScheduleId ? "Update schedule" : "Create recurring schedule"}
                    </button>
                    {editingScheduleId ? (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => {
                          setEditingScheduleId(null);
                          setScheduleForm((current) => ({ ...current, note: "" }));
                        }}
                      >
                        Cancel edit
                      </button>
                    ) : null}
                  </div>
                </form>

                <div className={styles.stack}>
                  {schedules.map((schedule) => {
                    const branch = branches.find((item) => item.id === schedule.branchId);
                    return (
                      <article key={schedule.id} className={styles.scheduleCard}>
                        <div className={styles.rowBetween}>
                          <strong>{dayLabel(schedule.dayOfWeek)} {schedule.startTime.slice(0, 5)} - {schedule.endTime.slice(0, 5)}</strong>
                          <span className={styles.badge}>{schedule.isActive ? "Active" : "Paused"}</span>
                        </div>
                        <p className={styles.meta}>{branch?.name || "Any linked branch"} · {schedule.timezone}</p>
                        <p className={styles.subtle}>{schedule.note || "No note"}</p>
                        <div className={styles.actions}>
                          <button type="button" className={styles.secondaryButton} onClick={() => beginScheduleEdit(schedule)}>Edit</button>
                          <button type="button" className={schedule.isActive ? styles.dangerButton : styles.primaryButton} onClick={() => void toggleSchedule(schedule)}>
                            {schedule.isActive ? "Pause" : "Activate"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {schedules.length === 0 ? <p className={styles.panelText}>No recurring schedule yet.</p> : null}
                </div>
              </article>

              <article className={styles.card}>
                <h2 className={styles.panelTitle}>Exception / blocked time</h2>
                <p className={styles.panelText}>Use this for time off, blocked ranges, offsite work, or one-off operational changes.</p>
                <form className={styles.fieldGrid} onSubmit={createBlock}>
                  <label className={styles.fieldLabel}>
                    Branch
                    <select className={styles.select} value={blockForm.branchId} onChange={(event) => setBlockForm((current) => ({ ...current, branchId: event.target.value }))}>
                      <option value="">Any linked branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.fieldLabel}>
                    Block type
                    <select className={styles.select} value={blockForm.blockType} onChange={(event) => setBlockForm((current) => ({ ...current, blockType: event.target.value }))}>
                      <option value="time_off">Time off</option>
                      <option value="blocked">Blocked</option>
                      <option value="offsite">Offsite</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <div className={styles.twoCol}>
                    <label className={styles.fieldLabel}>
                      Starts at
                      <input className={styles.input} type="datetime-local" value={blockForm.startsAt} onChange={(event) => setBlockForm((current) => ({ ...current, startsAt: event.target.value }))} />
                    </label>
                    <label className={styles.fieldLabel}>
                      Ends at
                      <input className={styles.input} type="datetime-local" value={blockForm.endsAt} onChange={(event) => setBlockForm((current) => ({ ...current, endsAt: event.target.value }))} />
                    </label>
                  </div>
                  <label className={styles.fieldLabel}>
                    Reason
                    <input className={styles.input} value={blockForm.reason} onChange={(event) => setBlockForm((current) => ({ ...current, reason: event.target.value }))} />
                  </label>
                  <label className={styles.fieldLabel}>
                    Note
                    <textarea className={styles.textarea} value={blockForm.note} onChange={(event) => setBlockForm((current) => ({ ...current, note: event.target.value }))} />
                  </label>
                  <div className={styles.actions}>
                    <button type="submit" className={styles.primaryButton} disabled={!selectedTherapist || saving}>Save exception block</button>
                  </div>
                </form>

                <div className={styles.stack}>
                  {blocks.map((block) => {
                    const branch = branches.find((item) => item.id === block.branchId);
                    return (
                      <article key={block.id} className={styles.blockCard}>
                        <div className={styles.rowBetween}>
                          <strong>{block.reason}</strong>
                          <span className={styles.badge}>{block.blockType}</span>
                        </div>
                        <p className={styles.meta}>{fmtDateTime(block.startsAt)} - {fmtDateTime(block.endsAt)}</p>
                        <p className={styles.subtle}>{branch?.name || "Any linked branch"} · {block.status}</p>
                        <div className={styles.actions}>
                          <button type="button" className={block.status === "active" ? styles.dangerButton : styles.primaryButton} onClick={() => void toggleBlock(block)}>
                            {block.status === "active" ? "Cancel block" : "Restore block"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {blocks.length === 0 ? <p className={styles.panelText}>No exception block yet.</p> : null}
                </div>
              </article>
            </section>
          </section>
        </section>

        {loading ? <div className={styles.message}>Loading therapist scheduling...</div> : null}
      </div>
    </main>
  );
}
