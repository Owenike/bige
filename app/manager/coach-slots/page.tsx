"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface CoachItem {
  id: string;
  displayName: string | null;
  branchId: string | null;
}

interface BranchItem {
  id: string;
  name: string;
}

interface SlotItem {
  id: string;
  coach_id: string;
  branch_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string | null;
}

function toDatetimeLocalValue(input: Date) {
  const value = new Date(input.getTime() - input.getTimezoneOffset() * 60 * 1000);
  return value.toISOString().slice(0, 16);
}

function localDatetimeToIso(value: string) {
  return value ? new Date(value).toISOString() : "";
}

export default function ManagerCoachSlotsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [coaches, setCoaches] = useState<CoachItem[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [items, setItems] = useState<SlotItem[]>([]);

  const now = new Date();
  const [coachId, setCoachId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [startsLocal, setStartsLocal] = useState(toDatetimeLocalValue(new Date(now.getTime() + 60 * 60 * 1000)));
  const [endsLocal, setEndsLocal] = useState(toDatetimeLocalValue(new Date(now.getTime() + 2 * 60 * 60 * 1000)));
  const [note, setNote] = useState("");
  const [actionReasonById, setActionReasonById] = useState<Record<string, string>>({});

  function slotStatusLabel(status: string) {
    if (!zh) return status;
    if (status === "active") return "\u555f\u7528\u4e2d";
    if (status === "cancelled") return "\u5df2\u53d6\u6d88";
    if (status === "completed") return "\u5df2\u5b8c\u6210";
    return status;
  }

  const coachMap = useMemo(() => new Map(coaches.map((c) => [c.id, c])), [coaches]);
  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  async function loadRefs() {
    setError(null);
    const [coachRes, branchRes] = await Promise.all([fetch("/api/coaches"), fetch("/api/manager/branches?activeOnly=1")]);
    const coachPayload = await coachRes.json();
    const branchPayload = await branchRes.json();

    if (!coachRes.ok) {
      setError(coachPayload?.error || (zh ? "\u8f09\u5165\u6559\u7df4\u5931\u6557" : "Load coaches failed"));
      return;
    }
    if (!branchRes.ok) {
      setError(branchPayload?.error || (zh ? "\u8f09\u5165\u5206\u9928\u5931\u6557" : "Load branches failed"));
      return;
    }

    const coachItems = (coachPayload.items || []) as CoachItem[];
    const branchItems = (branchPayload.items || []).map((b: any) => ({ id: String(b.id), name: String(b.name) })) as BranchItem[];
    setCoaches(coachItems);
    setBranches(branchItems);
    if (!coachId) setCoachId(coachItems[0]?.id || "");
    if (!branchId) setBranchId(branchItems[0]?.id || "");
  }

  async function loadSlots() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (coachId) params.set("coachId", coachId);
    const res = await fetch(`/api/manager/coach-slots?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || (zh ? "\u8f09\u5165\u6642\u6bb5\u5931\u6557" : "Load slots failed"));
      setLoading(false);
      return;
    }
    setItems((payload.items || []) as SlotItem[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadRefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachId]);

  async function createSlot(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/coach-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachId,
          branchId: branchId || null,
          startsAt: localDatetimeToIso(startsLocal),
          endsAt: localDatetimeToIso(endsLocal),
          note: note || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || (zh ? "\u5efa\u7acb\u6642\u6bb5\u5931\u6557" : "Create slot failed"));
        return;
      }
      setMessage(`${zh ? "\u5df2\u5efa\u7acb\u6642\u6bb5" : "Created slot"}: ${payload.slot?.id || ""}`);
      setNote("");
      await loadSlots();
    } finally {
      setSaving(false);
    }
  }

  async function updateSlot(id: string, action: "cancel" | "activate", reason: string) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/manager/coach-slots/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || (zh ? "\u66f4\u65b0\u6642\u6bb5\u5931\u6557" : "Update slot failed"));
      return;
    }
    setMessage(`${zh ? "\u5df2\u66f4\u65b0\u6642\u6bb5" : "Updated slot"}: ${id} -> ${payload.slot?.status || ""}`);
    setActionReasonById((prev) => ({ ...prev, [id]: "" }));
    await loadSlots();
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u6559\u7df4\u6392\u7a0b" : "COACH SCHEDULE"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u6559\u7df4\u6642\u6bb5" : "Coach Slots"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u5efa\u7acb\u8207\u7ba1\u7406\u6559\u7df4\u53ef\u9810\u7d04\u6642\u6bb5\uff0c\u652f\u63f4\u5206\u9928\u7bc4\u570d\u8207\u72c0\u614b\u5207\u63db\u3002"
                : "Create and manage coach availability windows with branch scope and status transitions."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "\u56de\u5100\u8868\u677f" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createSlot} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u5efa\u7acb\u6642\u6bb5" : "Create Slot"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <select value={coachId} onChange={(e) => setCoachId(e.target.value)} className="input" required>
                <option value="">{zh ? "\u9078\u64c7\u6559\u7df4" : "Select coach"}</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName || c.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input">
                <option value="">{zh ? "\uff08\u7121\u5206\u9928\uff09" : "(No branch)"}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <input type="datetime-local" value={startsLocal} onChange={(e) => setStartsLocal(e.target.value)} className="input" required />
              <input type="datetime-local" value={endsLocal} onChange={(e) => setEndsLocal(e.target.value)} className="input" required />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={zh ? "\u5099\u8a3b\uff08\u9078\u586b\uff09" : "note (optional)"} className="input" />
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? (zh ? "\u5efa\u7acb\u4e2d..." : "Creating...") : zh ? "\u5efa\u7acb" : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void loadSlots()} disabled={loading}>
                {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Reloading...") : zh ? "\u91cd\u65b0\u8f09\u5165" : "Reload"}
              </button>
            </div>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u6642\u6bb5\u6e05\u55ae" : "Slot List"}</h2>
            <div className="fdActionGrid">
              {items.map((s) => {
                const reason = (actionReasonById[s.id] || "").trim();
                return (
                  <article key={s.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                    <h3 className="fdActionTitle" style={{ fontSize: 18 }}>
                      {coachMap.get(s.coach_id)?.displayName || s.coach_id.slice(0, 8)}
                    </h3>
                    <p className="sub" style={{ marginTop: 8 }}>
                      {zh ? "\u5206\u9928" : "branch"}: {s.branch_id ? branchMap.get(s.branch_id)?.name || s.branch_id.slice(0, 8) : "-"}
                    </p>
                    <p className="sub" style={{ marginTop: 2 }}>
                      {new Date(s.starts_at).toLocaleString()} - {new Date(s.ends_at).toLocaleString()}
                    </p>
                    <p className="sub" style={{ marginTop: 2 }}>{zh ? "\u72c0\u614b" : "status"}: {slotStatusLabel(s.status)}</p>
                    <p className="sub" style={{ marginTop: 2 }}>{zh ? "ID" : "id"}: {s.id}</p>
                    <input
                      value={actionReasonById[s.id] || ""}
                      onChange={(e) => setActionReasonById((prev) => ({ ...prev, [s.id]: e.target.value }))}
                      placeholder={zh ? "\u539f\u56e0\uff08\u5fc5\u586b\uff09" : "reason (required)"}
                      className="input"
                      style={{ marginTop: 8 }}
                    />
                    <button
                      type="button"
                      className="fdPillBtn"
                      style={{ marginTop: 8 }}
                      disabled={!reason}
                      onClick={() => void updateSlot(s.id, s.status === "active" ? "cancel" : "activate", reason)}
                    >
                      {s.status === "active" ? (zh ? "\u53d6\u6d88" : "Cancel") : zh ? "\u555f\u7528" : "Activate"}
                    </button>
                  </article>
                );
              })}
              {items.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u6642\u6bb5\u3002" : "No slots found."}</p> : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
