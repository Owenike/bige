"use client";

import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";

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
  const { locale } = useI18n();
  const zh = locale !== "en";
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
      setError(payload?.error || (zh ? "\u8f09\u5165\u6703\u54e1\u5931\u6557" : "Load members failed"));
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
        setError(payload?.error || (zh ? "\u5132\u5b58\u5931\u6557" : "Save failed"));
        return;
      }
      setMessage(`${zh ? "\u5df2\u5132\u5b58" : "Saved"}: ${payload.member?.id || editId}`);
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
            <div className="fdEyebrow">{zh ? "\u6703\u54e1\u7dad\u904b" : "MEMBER OPS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u6703\u54e1\u7ba1\u7406" : "Members"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u641c\u5c0b\u6703\u54e1\u3001\u7de8\u8f2f\u8cc7\u6599\uff0c\u4e26\u78ba\u8a8d\u6240\u5c6c\u5206\u9928\u3002"
                : "Search member profiles, edit details, and map member records to the correct branch."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "\u56de\u5100\u8868\u677f" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u641c\u5c0b" : "Search"}</h2>
            <form
              className="actions"
              style={{ marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                void load();
              }}
            >
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={zh ? "\u59d3\u540d / \u96fb\u8a71" : "name / phone"} className="input" />
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={loading}>
                {loading ? (zh ? "\u641c\u5c0b\u4e2d..." : "Searching...") : zh ? "\u641c\u5c0b" : "Search"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load("")}>
                {zh ? "\u6700\u65b0" : "Recent"}
              </button>
            </form>
          </section>

          <form onSubmit={save} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u7de8\u8f2f\u6703\u54e1" : "Edit Member"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={editId} onChange={(e) => setEditId(e.target.value)} placeholder={zh ? "\u6703\u54e1 ID" : "memberId"} className="input" required />
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={zh ? "\u59d3\u540d" : "full name"} className="input" />
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder={zh ? "\u96fb\u8a71" : "phone"} className="input" />
              <input value={editStoreId} onChange={(e) => setEditStoreId(e.target.value)} placeholder={zh ? "\u5206\u9928 ID/storeId" : "branchId/storeId"} className="input" />
              <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder={zh ? "\u5099\u8a3b" : "notes"} className="input" />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>
              {saving ? (zh ? "\u5132\u5b58\u4e2d..." : "Saving...") : zh ? "\u5132\u5b58" : "Save"}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u6703\u54e1\u6e05\u55ae" : "Member List"}</h2>
          <div className="fdActionGrid">
            {items.map((m) => (
              <article key={m.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{m.full_name || "-"}</h3>
                <p className="sub" style={{ marginTop: 8 }}>{zh ? "\u96fb\u8a71" : "phone"}: {m.phone || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "\u5206\u9928" : "branch"}: {m.store_id || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "\u5efa\u7acb\u6642\u9593" : "created"}: {fmtDate(m.created_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "ID" : "id"}: {m.id}</p>
                <button type="button" className="fdPillBtn" style={{ marginTop: 8 }} onClick={() => loadIntoForm(m)}>
                  {zh ? "\u7de8\u8f2f" : "Edit"}
                </button>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u6703\u54e1\u3002" : "No members found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
