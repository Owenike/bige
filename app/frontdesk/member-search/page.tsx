"use client";

import { FormEvent, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface MemberItem {
  id: string;
  full_name: string;
  phone: string | null;
  store_id: string | null;
}

export default function FrontdeskMemberSearchPage() {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [items, setItems] = useState<MemberItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "MEMBER DESK",
            title: "會員查詢 / 建檔",
            sub: "快速查詢會員資料，並在櫃台直接建立新會員。",
            findTitle: "查詢會員",
            findHint: "可用姓名或電話查詢",
            findPlaceholder: "輸入姓名或電話",
            findBtn: "開始查詢",
            creatingBtn: "建立中...",
            createTitle: "新增會員",
            createName: "姓名",
            createPhone: "電話",
            createBtn: "建立會員",
            searching: "查詢中...",
            resultTitle: "查詢結果",
            empty: "目前沒有資料",
            searchFail: "查詢失敗",
            createFail: "建立失敗",
            memberId: "會員ID",
            branch: "分店",
          }
        : {
            badge: "MEMBER DESK",
            title: "Member Search / Create",
            sub: "Find member records quickly and create new members at the frontdesk.",
            findTitle: "Find Member",
            findHint: "Search by name or phone",
            findPlaceholder: "Enter name or phone",
            findBtn: "Search",
            creatingBtn: "Creating...",
            createTitle: "Create Member",
            createName: "Full Name",
            createPhone: "Phone",
            createBtn: "Create Member",
            searching: "Searching...",
            resultTitle: "Results",
            empty: "No records yet",
            searchFail: "Search failed",
            createFail: "Create failed",
            memberId: "Member ID",
            branch: "Branch",
          },
    [lang],
  );

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/members?q=${encodeURIComponent(q)}`);
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || t.searchFail);
        return;
      }
      setItems((payload.items || []) as MemberItem[]);
    } finally {
      setLoading(false);
    }
  }

  async function createMember(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name, phone }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || t.createFail);
        return;
      }
      setName("");
      setPhone("");
      await search();
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card kv" style={{ padding: 18 }}>
          <div className="kvLabel">{t.badge}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
            {t.title}
          </h1>
          <p className="sub">{t.sub}</p>
        </div>
      </section>

      {error ? (
        <div className="error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card kv" style={{ padding: 16 }}>
          <h2 className="sectionTitle">{t.findTitle}</h2>
          <p className="sub" style={{ marginTop: 6 }}>
            {t.findHint}
          </p>
          <form onSubmit={search} className="field">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.findPlaceholder}
              className="input"
            />
            <button type="submit" className="btn btnPrimary" disabled={loading}>
              {loading ? t.searching : t.findBtn}
            </button>
          </form>
        </div>

        <div className="card kv" style={{ padding: 16 }}>
          <h2 className="sectionTitle">{t.createTitle}</h2>
          <form onSubmit={createMember} className="field">
            <label className="sub" style={{ marginTop: 0 }}>
              {t.createName}
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.createName} className="input" required />
            <label className="sub">{t.createPhone}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.createPhone} className="input" />
            <button type="submit" className="btn" disabled={creating}>
              {creating ? t.creatingBtn : t.createBtn}
            </button>
          </form>
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        <h2 className="sectionTitle">{t.resultTitle}</h2>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {items.length === 0 ? (
            <div className="card kv">
              <div className="kvValue">{t.empty}</div>
            </div>
          ) : (
            items.map((item) => (
              <article key={item.id} className="card kv" style={{ padding: 14 }}>
                <h3 style={{ margin: 0, fontSize: 20 }}>{item.full_name}</h3>
                <p className="sub">{item.phone || "-"}</p>
                <p className="sub" style={{ marginTop: 8 }}>
                  {t.memberId}: <code>{item.id}</code>
                </p>
                <p className="sub" style={{ marginTop: 4 }}>
                  {t.branch}: {item.store_id || "-"}
                </p>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

