"use client";

import { FormEvent, useEffect, useState } from "react";

interface MemberItem {
  id: string;
  full_name: string;
  phone: string | null;
  notes: string | null;
  store_id: string | null;
  created_at: string;
}

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function ManagerMembersPage() {
  const [items, setItems] = useState<MemberItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState("");

  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStoreId, setEditStoreId] = useState("");

  async function load(query?: string) {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    const value = (query ?? q).trim();
    if (value) params.set("q", value);
    const res = await fetch(`/api/manager/members?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load members failed");
      setLoading(false);
      return;
    }
    setItems((payload.items || []) as MemberItem[]);
    setLoading(false);
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadIntoForm(m: MemberItem) {
    setEditId(m.id);
    setEditName(m.full_name);
    setEditPhone(m.phone || "");
    setEditNotes(m.notes || "");
    setEditStoreId(m.store_id || "");
    setError(null);
    setMessage(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/manager/members/${encodeURIComponent(editId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: editName,
          phone: editPhone,
          notes: editNotes,
          storeId: editStoreId,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || "Save failed");
        return;
      }
      setMessage(`Saved: ${payload.member?.id || editId}`);
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">MEMBER OPS</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Members
            </h1>
            <p className="fdGlassText">Search member profiles, edit details, and map member records to the correct branch.</p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Search</h2>
            <form
              className="actions"
              style={{ marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                void load();
              }}
            >
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name / phone" className="input" />
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={loading}>
                {loading ? "Searching..." : "Search"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load("")}>
                Recent
              </button>
            </form>
          </section>

          <form onSubmit={save} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Edit Member</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={editId} onChange={(e) => setEditId(e.target.value)} placeholder="memberId" className="input" required />
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="full name" className="input" />
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="phone" className="input" />
              <input value={editStoreId} onChange={(e) => setEditStoreId(e.target.value)} placeholder="branchId/storeId" className="input" />
              <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="notes" className="input" />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">Member List</h2>
          <div className="fdActionGrid">
            {items.map((m) => (
              <article key={m.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{m.full_name || "-"}</h3>
                <p className="sub" style={{ marginTop: 8 }}>phone: {m.phone || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>branch: {m.store_id || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>created: {fmtDate(m.created_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>id: {m.id}</p>
                <button type="button" className="fdPillBtn" style={{ marginTop: 8 }} onClick={() => loadIntoForm(m)}>
                  Edit
                </button>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">No members found.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
