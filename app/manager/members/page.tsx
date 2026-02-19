"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface MemberItem {
  id: string;
  full_name: string;
  phone: string | null;
  notes: string | null;
  store_id: string | null;
  created_at: string;
}

interface ErrorPayload {
  error?: string;
}

interface MemberListPayload extends ErrorPayload {
  items?: MemberItem[];
}

interface MemberMutatePayload extends ErrorPayload {
  member?: MemberItem;
}

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
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

  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createStoreId, setCreateStoreId] = useState("");
  const [createNotes, setCreateNotes] = useState("");

  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStoreId, setEditStoreId] = useState("");

  async function load(query?: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const value = (query ?? q).trim();
      if (value) params.set("q", value);
      const res = await fetch(`/api/manager/members?${params.toString()}`);
      const payload = (await parseJsonSafe<MemberListPayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "載入會員失敗" : "Load members failed"));
        setItems([]);
        setLoading(false);
        return;
      }
      const rows = payload.items || [];
      setItems(rows);
    } catch {
      setError(zh ? "載入會員失敗" : "Load members failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
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

  async function createMember(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: createName,
          phone: createPhone || null,
          storeId: createStoreId || null,
          notes: createNotes || null,
        }),
      });
      const payload = (await parseJsonSafe<MemberMutatePayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "建立會員失敗" : "Create member failed"));
        setSaving(false);
        return;
      }
      setMessage(`${zh ? "已建立會員" : "Member created"}: ${payload.member?.id || "-"}`);
      setCreateName("");
      setCreatePhone("");
      setCreateStoreId("");
      setCreateNotes("");
      await load();
    } catch {
      setError(zh ? "建立會員失敗" : "Create member failed");
    } finally {
      setSaving(false);
    }
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
      const payload = (await parseJsonSafe<MemberMutatePayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "儲存失敗" : "Save failed"));
        setSaving(false);
        return;
      }
      setMessage(`${zh ? "已儲存" : "Saved"}: ${payload.member?.id || editId}`);
      await load();
    } catch {
      setError(zh ? "儲存失敗" : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const stats = useMemo(() => {
    const total = items.length;
    const withPhone = items.filter((m) => !!m.phone).length;
    const withBranch = items.filter((m) => !!m.store_id).length;
    return { total, withPhone, withBranch };
  }, [items]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "會員維運" : "MEMBER OPS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "會員管理" : "Members"}
            </h1>
            <p className="fdGlassText">
              {zh ? "可搜尋、新增並編輯會員資料與分館歸屬。" : "Search, create, and edit member profiles with branch ownership."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "回儀表板" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "清單筆數" : "Loaded Members"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.total}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "有電話" : "With Phone"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.withPhone}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "已綁分館" : "With Branch"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.withBranch}</p>
          </article>
        </section>

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "搜尋" : "Search"}</h2>
            <form
              className="actions"
              style={{ marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                void load();
              }}
            >
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={zh ? "姓名 / 電話" : "name / phone"} className="input" />
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={loading}>
                {loading ? (zh ? "搜尋中..." : "Searching...") : zh ? "搜尋" : "Search"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load("")}>
                {zh ? "最新" : "Recent"}
              </button>
            </form>
          </section>

          <form onSubmit={createMember} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "新增會員" : "Create Member"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder={zh ? "姓名" : "full name"} className="input" required />
              <input value={createPhone} onChange={(e) => setCreatePhone(e.target.value)} placeholder={zh ? "電話（選填）" : "phone (optional)"} className="input" />
              <input value={createStoreId} onChange={(e) => setCreateStoreId(e.target.value)} placeholder={zh ? "分館 ID/storeId（選填）" : "branchId/storeId (optional)"} className="input" />
              <input value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} placeholder={zh ? "備註（選填）" : "notes (optional)"} className="input" />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>
              {saving ? (zh ? "建立中..." : "Creating...") : zh ? "建立會員" : "Create Member"}
            </button>
          </form>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "編輯會員" : "Edit Member"}</h2>
          <form onSubmit={save}>
            <div className="actions" style={{ marginTop: 8 }}>
              <input value={editId} onChange={(e) => setEditId(e.target.value)} placeholder={zh ? "會員 ID" : "memberId"} className="input" required />
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={zh ? "姓名" : "full name"} className="input" />
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder={zh ? "電話" : "phone"} className="input" />
              <input value={editStoreId} onChange={(e) => setEditStoreId(e.target.value)} placeholder={zh ? "分館 ID/storeId" : "branchId/storeId"} className="input" />
              <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder={zh ? "備註" : "notes"} className="input" />
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving || !editId}>
                {saving ? (zh ? "儲存中..." : "Saving...") : zh ? "儲存" : "Save"}
              </button>
            </div>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "會員清單" : "Member List"}</h2>
          <div className="fdActionGrid">
            {items.map((m) => (
              <article key={m.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{m.full_name || "-"}</h3>
                <p className="sub" style={{ marginTop: 8 }}>{zh ? "電話" : "phone"}: {m.phone || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "分館" : "branch"}: {m.store_id || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "建立時間" : "created"}: {fmtDate(m.created_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "ID" : "id"}: {m.id}</p>
                <button type="button" className="fdPillBtn" style={{ marginTop: 8 }} onClick={() => loadIntoForm(m)}>
                  {zh ? "載入編輯" : "Edit"}
                </button>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">{zh ? "找不到會員。" : "No members found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
