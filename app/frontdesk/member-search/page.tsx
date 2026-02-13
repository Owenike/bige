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
            title: "\u6703\u54e1\u67e5\u8a62 / \u5efa\u6a94",
            sub: "\u5feb\u901f\u67e5\u8a62\u6703\u54e1\u8cc7\u6599\uff0c\u4e26\u53ef\u5728\u6ac3\u6aaf\u76f4\u63a5\u65b0\u589e\u6703\u54e1\u3002",
            findTitle: "\u67e5\u8a62\u6703\u54e1",
            findHint: "\u53ef\u7528\u59d3\u540d\u6216\u96fb\u8a71\u67e5\u8a62",
            findPlaceholder: "\u8f38\u5165\u59d3\u540d\u6216\u96fb\u8a71",
            findBtn: "\u958b\u59cb\u67e5\u8a62",
            creatingBtn: "\u5efa\u7acb\u4e2d...",
            createTitle: "\u65b0\u589e\u6703\u54e1",
            createName: "\u59d3\u540d",
            createPhone: "\u96fb\u8a71",
            createBtn: "\u5efa\u7acb\u6703\u54e1",
            searching: "\u67e5\u8a62\u4e2d...",
            resultTitle: "\u67e5\u8a62\u7d50\u679c",
            empty: "\u76ee\u524d\u6c92\u6709\u8cc7\u6599",
            searchFail: "\u67e5\u8a62\u5931\u6557",
            createFail: "\u5efa\u7acb\u5931\u6557",
            memberId: "\u6703\u54e1ID",
            branch: "\u5206\u5e97",
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
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{t.badge}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {t.title}
            </h1>
            <p className="fdGlassText">{t.sub}</p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}

        <section className="fdTwoCol">
          <div className="fdGlassPanel">
            <h2 className="sectionTitle">{t.findTitle}</h2>
            <p className="fdGlassText" style={{ marginTop: 6 }}>
              {t.findHint}
            </p>
            <form onSubmit={search} className="field">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.findPlaceholder} className="input" />
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={loading}>
                {loading ? t.searching : t.findBtn}
              </button>
            </form>
          </div>

          <div className="fdGlassPanel">
            <h2 className="sectionTitle">{t.createTitle}</h2>
            <form onSubmit={createMember} className="field">
              <label className="fdGlassText" style={{ marginTop: 0 }}>
                {t.createName}
              </label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.createName} className="input" required />
              <label className="fdGlassText">{t.createPhone}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.createPhone} className="input" />
              <button type="submit" className="fdPillBtn" disabled={creating}>
                {creating ? t.creatingBtn : t.createBtn}
              </button>
            </form>
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">{t.resultTitle}</h2>
          <div className="fdActionGrid">
            {items.length === 0 ? (
              <div className="fdGlassPanel">
                <div className="kvValue">{t.empty}</div>
              </div>
            ) : (
              items.map((item) => (
                <article key={item.id} className="fdGlassPanel fdActionCard">
                  <h3 className="fdActionTitle" style={{ fontSize: 20 }}>
                    {item.full_name}
                  </h3>
                  <p className="fdGlassText">{item.phone || "-"}</p>
                  <p className="fdGlassText" style={{ marginTop: 8 }}>
                    {t.memberId}: <code>{item.id}</code>
                  </p>
                  <p className="fdGlassText" style={{ marginTop: 4 }}>
                    {t.branch}: {item.store_id || "-"}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
