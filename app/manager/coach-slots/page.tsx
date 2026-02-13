"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const coachMap = useMemo(() => new Map(coaches.map((c) => [c.id, c])), [coaches]);
  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  async function loadRefs() {
    setError(null);
    const [coachRes, branchRes] = await Promise.all([fetch("/api/coaches"), fetch("/api/manager/branches?activeOnly=1")]);
    const coachPayload = await coachRes.json();
    const branchPayload = await branchRes.json();

    if (!coachRes.ok) {
      setError(coachPayload?.error || "Load coaches failed");
      return;
    }
    if (!branchRes.ok) {
      setError(branchPayload?.error || "Load branches failed");
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
    setError(null);
    const params = new URLSearchParams();
    if (coachId) params.set("coachId", coachId);
    const res = await fetch(`/api/manager/coach-slots?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load slots failed");
      return;
    }
    setItems((payload.items || []) as SlotItem[]);
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
    setError(null);
    setMessage(null);

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
      setError(payload?.error || "Create slot failed");
      return;
    }
    setMessage(`Created slot: ${payload.slot?.id || ""}`);
    setNote("");
    await loadSlots();
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
      setError(payload?.error || "Update slot failed");
      return;
    }
    setMessage(`Updated slot: ${id} -> ${payload.slot?.status || ""}`);
    setActionReasonById((prev) => ({ ...prev, [id]: "" }));
    await loadSlots();
  }

  return (
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Coach Schedule (Slots)</h1>
        <p>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
        {message ? <p style={{ color: "green" }}>{message}</p> : null}

        <section style={{ marginTop: 16 }}>
          <h2>Create Slot</h2>
          <form onSubmit={createSlot}>
            <p>
              <select value={coachId} onChange={(e) => setCoachId(e.target.value)} required>
                <option value="">Select coach</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName || c.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </p>
            <p>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">(No branch)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </p>
            <p>
              <input type="datetime-local" value={startsLocal} onChange={(e) => setStartsLocal(e.target.value)} required />
            </p>
            <p>
              <input type="datetime-local" value={endsLocal} onChange={(e) => setEndsLocal(e.target.value)} required />
            </p>
            <p>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" />
            </p>
            <button type="submit">Create</button>
            <button type="button" onClick={() => void loadSlots()} style={{ marginLeft: 8 }}>
              Reload
            </button>
          </form>
        </section>

        <section style={{ marginTop: 16 }}>
          <h2>Slot List</h2>
          <ul>
            {items.map((s) => (
              <li key={s.id}>
                <input
                  value={actionReasonById[s.id] || ""}
                  onChange={(e) => setActionReasonById((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  placeholder="reason (required)"
                  style={{ marginRight: 8 }}
                />
                <button
                  type="button"
                  onClick={() =>
                    void updateSlot(
                      s.id,
                      s.status === "active" ? "cancel" : "activate",
                      (actionReasonById[s.id] || "").trim(),
                    )
                  }
                  style={{ marginRight: 8 }}
                  disabled={!(actionReasonById[s.id] || "").trim()}
                >
                  {s.status === "active" ? "Cancel" : "Activate"}
                </button>
                coach {coachMap.get(s.coach_id)?.displayName || s.coach_id.slice(0, 8)} | branch{" "}
                {s.branch_id ? branchMap.get(s.branch_id)?.name || s.branch_id.slice(0, 8) : "-"} |{" "}
                {new Date(s.starts_at).toLocaleString()} - {new Date(s.ends_at).toLocaleString()} | {s.status}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
