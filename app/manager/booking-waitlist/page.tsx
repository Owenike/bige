"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "../settings/settings.module.css";

type WaitlistEligibility = {
  eligible?: boolean;
  reasonCode?: string | null;
  candidate?: { contractId?: string | null } | null;
} | null;

type WaitlistItem = {
  id: string;
  branchId: string | null;
  memberId: string | null;
  linkedBookingId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  desiredDate: string | null;
  desiredTime: string | null;
  note: string | null;
  status: string | null;
  createdAt: string | null;
  eligibility: WaitlistEligibility;
};

type WaitlistPayload = {
  items?: WaitlistItem[];
  warning?: string;
  error?: string;
};

type StorefrontPayload = {
  branches?: Array<{ id: string; name: string; code: string | null }>;
  error?: string;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string } | string;
  message?: string;
  warning?: string;
};

const STATUS_OPTIONS = ["pending", "notified", "booked", "cancelled"] as const;

function toErrorMessage(payload: unknown, fallback: string) {
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
    throw new Error(toErrorMessage(payload, "Request failed"));
  }
  if (payload && typeof payload === "object" && "data" in payload && payload.data) {
    return payload.data as T;
  }
  return payload as T;
}

function statusLabel(status: string | null) {
  if (status === "pending") return "Waiting";
  if (status === "notified") return "Contacted";
  if (status === "booked") return "Converted";
  if (status === "cancelled") return "Cancelled";
  return status || "Unknown";
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function ManagerBookingWaitlistPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [items, setItems] = useState<WaitlistItem[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string | null }>>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const [createForm, setCreateForm] = useState({
    contactName: "Waitlist Probe Guest",
    contactPhone: "0912-000-000",
    desiredDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    desiredTime: "10:30",
    note: "Request morning slot if possible.",
  });

  const [editForm, setEditForm] = useState({
    status: "pending",
    desiredDate: "",
    desiredTime: "",
    note: "",
    linkedBookingId: "",
  });

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  const stats = useMemo(() => {
    const counts = {
      total: items.length,
      pending: items.filter((item) => item.status === "pending").length,
      notified: items.filter((item) => item.status === "notified").length,
      booked: items.filter((item) => item.status === "booked").length,
      cancelled: items.filter((item) => item.status === "cancelled").length,
    };
    return counts;
  }, [items]);

  function bindItem(item: WaitlistItem) {
    setSelectedId(item.id);
    setEditForm({
      status: STATUS_OPTIONS.includes((item.status as (typeof STATUS_OPTIONS)[number]) || "pending")
        ? (item.status as (typeof STATUS_OPTIONS)[number])
        : "pending",
      desiredDate: item.desiredDate || "",
      desiredTime: item.desiredTime || "",
      note: item.note || "",
      linkedBookingId: item.linkedBookingId || "",
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [waitlistResponse, storefrontPayload] = await Promise.all([
        fetch("/api/frontdesk/booking-waitlist?limit=50", { cache: "no-store" }),
        requestJson<StorefrontPayload>("/api/manager/storefront"),
      ]);
      const waitlistBody = (await waitlistResponse.json().catch(() => null)) as
        | { data?: WaitlistPayload; items?: WaitlistItem[]; warning?: string; error?: string }
        | null;
      if (!waitlistResponse.ok) {
        throw new Error(waitlistBody?.error || "Failed to load waitlist");
      }
      const waitlistPayload = waitlistBody?.data || waitlistBody || {};
      const nextItems = waitlistPayload.items || [];
      setItems(nextItems);
      setWarning(waitlistPayload.warning || null);
      setBranches(storefrontPayload.branches || []);
      const nextSelected = nextItems.find((item) => item.id === selectedId) || nextItems[0] || null;
      if (nextSelected) bindItem(nextSelected);
      else setSelectedId("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load waitlist");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resolveBranchLabel(branchId: string | null) {
    if (!branchId) return "Tenant-wide";
    const branch = branches.find((item) => item.id === branchId);
    return branch ? `${branch.name}${branch.code ? ` (${branch.code})` : ""}` : branchId;
  }

  async function createWaitlistItem(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await requestJson<{ item: WaitlistItem }>("/api/frontdesk/booking-waitlist", {
        method: "POST",
        body: JSON.stringify({
          contactName: createForm.contactName,
          contactPhone: createForm.contactPhone || null,
          desiredDate: createForm.desiredDate || null,
          desiredTime: createForm.desiredTime || null,
          note: createForm.note || null,
        }),
      });
      setMessage(`Waitlist item created: ${payload.item.id}`);
      await load();
      if (payload.item.id) {
        const created = items.find((item) => item.id === payload.item.id);
        if (created) bindItem(created);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create waitlist item");
    } finally {
      setSaving(false);
    }
  }

  async function updateWaitlistItem(event: FormEvent) {
    event.preventDefault();
    if (!selectedItem) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await requestJson<{ item: WaitlistItem }>(`/api/frontdesk/booking-waitlist/${selectedItem.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: editForm.status,
          desiredDate: editForm.desiredDate || null,
          desiredTime: editForm.desiredTime || null,
          note: editForm.note || null,
          linkedBookingId: editForm.linkedBookingId || null,
        }),
      });
      setMessage(`Waitlist item updated: ${selectedItem.id}`);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update waitlist item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="fdGlassScene" data-waitlist-page>
      <section className="fdGlassBackdrop">
        <section className={styles.page}>
          <article className={`fdGlassPanel ${styles.heroCard}`}>
            <div className={styles.heroEyebrow}>Waitlist operations</div>
            <h1 className={styles.heroTitle}>Booking Waitlist</h1>
            <p className={styles.heroBody} data-waitlist-scope>
              This page manages waitlist intake, review, and minimal status progression. It does not replace the frontdesk
              booking workbench, staffing rules, service master data, or a full CRM / messaging center.
            </p>
            <div className={styles.actionRow}>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading} data-waitlist-reload>
                {loading ? "Refreshing..." : "Reload"}
              </button>
              <Link className="fdPillBtn" href="/manager">
                Back to manager
              </Link>
              <Link className="fdPillBtn" href="/frontdesk/bookings">
                Frontdesk bookings
              </Link>
            </div>
            {warning ? (
              <div className="error" data-waitlist-warning>
                Waitlist warning: {warning}
              </div>
            ) : null}
            {error ? (
              <div className="error" data-waitlist-error>
                {error}
              </div>
            ) : null}
            {message ? (
              <div className="ok" data-waitlist-message>
                {message}
              </div>
            ) : null}
          </article>

          <section className="fdActionGrid" style={{ marginBottom: 14 }}>
            <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
              <h3 className="fdActionTitle">Total</h3>
              <p className="h2" style={{ marginTop: 8 }} data-waitlist-total>{stats.total}</p>
            </article>
            <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
              <h3 className="fdActionTitle">Waiting</h3>
              <p className="h2" style={{ marginTop: 8 }} data-waitlist-pending>{stats.pending}</p>
            </article>
            <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
              <h3 className="fdActionTitle">Contacted</h3>
              <p className="h2" style={{ marginTop: 8 }} data-waitlist-notified>{stats.notified}</p>
            </article>
            <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
              <h3 className="fdActionTitle">Converted</h3>
              <p className="h2" style={{ marginTop: 8 }} data-waitlist-booked>{stats.booked}</p>
            </article>
            <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
              <h3 className="fdActionTitle">Cancelled</h3>
              <p className="h2" style={{ marginTop: 8 }} data-waitlist-cancelled>{stats.cancelled}</p>
            </article>
          </section>

          <section className={styles.twoCol}>
            <form onSubmit={createWaitlistItem} className={`fdGlassSubPanel ${styles.card}`} data-waitlist-create-form>
              <h2 className={styles.panelTitle}>Add waitlist item</h2>
              <p className={styles.panelText}>
                Stable intake fields only: contact, preferred date/time, and note. Therapist / service preference is not stored in
                the current model, so this page does not invent new schema for it.
              </p>
              <div className={styles.fieldGridWide}>
                <label className={styles.field}>
                  <span className={styles.label}>Contact name</span>
                  <input
                    className={styles.input}
                    value={createForm.contactName}
                    onChange={(event) => setCreateForm((current) => ({ ...current, contactName: event.target.value }))}
                    required
                    data-waitlist-create-contact-name
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Contact phone</span>
                  <input
                    className={styles.input}
                    value={createForm.contactPhone}
                    onChange={(event) => setCreateForm((current) => ({ ...current, contactPhone: event.target.value }))}
                    data-waitlist-create-contact-phone
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Preferred date</span>
                  <input
                    className={styles.input}
                    type="date"
                    value={createForm.desiredDate}
                    onChange={(event) => setCreateForm((current) => ({ ...current, desiredDate: event.target.value }))}
                    data-waitlist-create-date
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Preferred time</span>
                  <input
                    className={styles.input}
                    type="time"
                    value={createForm.desiredTime}
                    onChange={(event) => setCreateForm((current) => ({ ...current, desiredTime: event.target.value }))}
                    data-waitlist-create-time
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Note</span>
                  <textarea
                    className={styles.textarea}
                    value={createForm.note}
                    onChange={(event) => setCreateForm((current) => ({ ...current, note: event.target.value }))}
                    data-waitlist-create-note
                  />
                </label>
              </div>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving} data-waitlist-create>
                {saving ? "Saving..." : "Create waitlist item"}
              </button>
            </form>

            <form onSubmit={updateWaitlistItem} className={`fdGlassSubPanel ${styles.card}`} data-waitlist-edit-form>
              <h2 className={styles.panelTitle}>Waitlist item detail</h2>
              {!selectedItem ? (
                <p className={styles.panelText}>Select a waitlist item from the list to review status, preferred slot, and notes.</p>
              ) : (
                <div className={styles.fieldGridWide}>
                  <div className={styles.scopeBanner}>
                    <div className={styles.scopeText}>
                      <strong data-waitlist-selected-contact>{selectedItem.contactName || "-"}</strong>
                      <div data-waitlist-selected-id>{selectedItem.id}</div>
                    </div>
                    <span className="pill" data-waitlist-selected-status={selectedItem.status || "unknown"}>
                      {statusLabel(selectedItem.status)}
                    </span>
                  </div>
                  <div className={styles.sectionGrid}>
                    <p className={styles.panelText} data-waitlist-selected-branch>
                      Branch: {resolveBranchLabel(selectedItem.branchId)}
                    </p>
                    <p className={styles.panelText} data-waitlist-selected-linked-booking>
                      Linked booking: {selectedItem.linkedBookingId || "-"}
                    </p>
                    <p className={styles.panelText} data-waitlist-selected-created-at>
                      Created: {formatDateTime(selectedItem.createdAt)}
                    </p>
                    <p className={styles.panelText} data-waitlist-selected-eligibility>
                      Eligibility:{" "}
                      {selectedItem.eligibility
                        ? selectedItem.eligibility.eligible
                          ? "eligible"
                          : selectedItem.eligibility.reasonCode || "not eligible"
                        : "not evaluated"}
                    </p>
                  </div>
                  <label className={styles.field}>
                    <span className={styles.label}>Status</span>
                    <select
                      className={styles.select}
                      value={editForm.status}
                      onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value }))}
                      data-waitlist-edit-status
                    >
                      <option value="pending">Waiting</option>
                      <option value="notified">Contacted</option>
                      <option value="booked">Converted</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Preferred date</span>
                    <input
                      className={styles.input}
                      type="date"
                      value={editForm.desiredDate}
                      onChange={(event) => setEditForm((current) => ({ ...current, desiredDate: event.target.value }))}
                      data-waitlist-edit-date
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Preferred time</span>
                    <input
                      className={styles.input}
                      type="time"
                      value={editForm.desiredTime}
                      onChange={(event) => setEditForm((current) => ({ ...current, desiredTime: event.target.value }))}
                      data-waitlist-edit-time
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Linked booking id</span>
                    <input
                      className={styles.input}
                      value={editForm.linkedBookingId}
                      onChange={(event) => setEditForm((current) => ({ ...current, linkedBookingId: event.target.value }))}
                      data-waitlist-edit-linked-booking
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Note</span>
                    <textarea
                      className={styles.textarea}
                      value={editForm.note}
                      onChange={(event) => setEditForm((current) => ({ ...current, note: event.target.value }))}
                      data-waitlist-edit-note
                    />
                  </label>
                  <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving} data-waitlist-save>
                    {saving ? "Saving..." : "Save waitlist item"}
                  </button>
                </div>
              )}
            </form>
          </section>

          <section className={`fdGlassSubPanel ${styles.card}`} data-waitlist-list>
            <h2 className={styles.panelTitle}>Waitlist queue</h2>
            <p className={styles.panelText}>
              Stable fields currently available: contact, phone, preferred date/time, note, branch, linked booking, status, and
              eligibility summary. Therapist preference, service preference, and expired-state automation are not modeled here yet.
            </p>
            <div className="fdActionGrid">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="fdGlassSubPanel fdActionCard"
                  style={{ padding: 12 }}
                  data-waitlist-card
                  data-waitlist-id={item.id}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <h3 className="fdActionTitle" data-waitlist-contact>{item.contactName || "-"}</h3>
                    <span className="pill" data-waitlist-status-badge={item.status || "unknown"}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <p className="sub" style={{ marginTop: 4 }} data-waitlist-phone>{item.contactPhone || "-"}</p>
                  <p className="sub" style={{ marginTop: 4 }} data-waitlist-branch>
                    Branch: {resolveBranchLabel(item.branchId)}
                  </p>
                  <p className="sub" style={{ marginTop: 4 }} data-waitlist-preferred>
                    Preferred slot: {item.desiredDate || "-"} {item.desiredTime || ""}
                  </p>
                  <p className="sub" style={{ marginTop: 4 }} data-waitlist-linked-booking>
                    Linked booking: {item.linkedBookingId || "-"}
                  </p>
                  <p className="sub" style={{ marginTop: 4 }} data-waitlist-note>
                    {item.note || "-"}
                  </p>
                  <button type="button" className="fdPillBtn" style={{ marginTop: 8 }} onClick={() => bindItem(item)} data-waitlist-edit>
                    Review / Update
                  </button>
                </article>
              ))}
              {!items.length ? (
                <div className={styles.panelText} data-waitlist-empty>
                  {loading ? "Loading waitlist..." : warning ? "Waitlist table is missing in this environment." : "No waitlist items yet."}
                </div>
              ) : null}
            </div>
          </section>

          <section className={`fdGlassSubPanel ${styles.card}`} data-waitlist-out-of-scope>
            <h2 className={styles.panelTitle}>Out of scope for this page</h2>
            <ul className="fdBkDraftAlertList" style={{ margin: 0 }}>
              <li>Frontdesk booking creation, drag-and-drop, and redemption execution</li>
              <li>Coach availability / blocked time management</li>
              <li>Service, plan, and package rule authoring</li>
              <li>Auth / activation and full RBAC engineering</li>
              <li>External messaging center or CRM workflow automation</li>
            </ul>
          </section>
        </section>
      </section>
    </main>
  );
}
