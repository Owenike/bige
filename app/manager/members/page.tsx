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

export default function ManagerMembersPage() {
  const [items, setItems] = useState<MemberItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [q, setQ] = useState("");

  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStoreId, setEditStoreId] = useState("");

  async function load(query?: string) {
    setError(null);
    const params = new URLSearchParams();
    const value = (query ?? q).trim();
    if (value) params.set("q", value);
    const res = await fetch(`/api/manager/members?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load members failed");
      return;
    }
    setItems((payload.items || []) as MemberItem[]);
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
    setError(null);
    setMessage(null);

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
  }

  return (
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Members</h1>
        <p>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
        {message ? <p style={{ color: "green" }}>{message}</p> : null}

        <section style={{ marginTop: 16 }}>
          <h2>Search</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name / phone" />
            <button type="submit" style={{ marginLeft: 8 }}>
              Search
            </button>
            <button type="button" onClick={() => void load("")} style={{ marginLeft: 8 }}>
              Recent
            </button>
          </form>
        </section>

        <section style={{ marginTop: 16 }}>
          <h2>Edit Member</h2>
          <form onSubmit={save}>
            <p>
              <input value={editId} onChange={(e) => setEditId(e.target.value)} placeholder="memberId" required />
            </p>
            <p>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="full name" />
            </p>
            <p>
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="phone" />
            </p>
            <p>
              <input value={editStoreId} onChange={(e) => setEditStoreId(e.target.value)} placeholder="branchId/storeId" />
            </p>
            <p>
              <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="notes" />
            </p>
            <button type="submit">Save</button>
          </form>
        </section>

        <section style={{ marginTop: 16 }}>
          <h2>Member List</h2>
          <ul>
            {items.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => loadIntoForm(m)} style={{ marginRight: 8 }}>
                  Edit
                </button>
                {m.full_name} | {m.phone || "-"} | store {m.store_id || "-"} | id {m.id}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
