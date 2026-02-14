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
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [recentCreatedId, setRecentCreatedId] = useState<string | null>(null);

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
            created: "\u6703\u54e1\u5df2\u5efa\u7acb",
            memberId: "\u6703\u54e1ID",
            branch: "\u5206\u5e97",
            continueHint: "\u53ef\u4ee5\u76f4\u63a5\u7528\u6b64\u6703\u54e1\u524d\u5f80\u6536\u6b3e\u3001\u9810\u7d04\u6216\u5165\u5834\u6383\u78bc\u3002",
            quickActions: "\u5feb\u901f\u4e0b\u4e00\u6b65",
            goOrder: "\u65b0\u589e\u8a02\u55ae",
            goBooking: "\u5efa\u7acb\u9810\u7d04",
            goCheckin: "\u5165\u5834\u6383\u78bc",
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
            created: "Member created",
            memberId: "Member ID",
            branch: "Branch",
            continueHint: "You can continue with this member for payment, booking, or check-in.",
            quickActions: "Quick Actions",
            goOrder: "New Order",
            goBooking: "New Booking",
            goCheckin: "Check-in",
          },
    [lang],
  );

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const keyword = q.trim();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/members?q=${encodeURIComponent(keyword)}`);
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
    setMessage(null);
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
      const createdId = String(payload?.member?.id || "");
      setName("");
      setPhone("");
      setRecentCreatedId(createdId || null);
      setQ(payload?.member?.full_name || "");
      setMessage(`${t.created}: ${createdId}`);
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
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <div className="fdGlassSubPanel" style={{ padding: 14 }}>
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

          <div className="fdGlassSubPanel" style={{ padding: 14 }}>
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
            <p className="fdGlassText" style={{ marginTop: 10, fontSize: 12 }}>{t.continueHint}</p>
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          {recentCreatedId ? (
            <div className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 12 }}>
              <h2 className="sectionTitle" style={{ marginBottom: 8 }}>{t.quickActions}</h2>
              <div className="actions" style={{ marginTop: 0 }}>
                <a className="fdPillBtn fdPillBtnPrimary" href={`/frontdesk/orders/new?memberId=${encodeURIComponent(recentCreatedId)}`}>{t.goOrder}</a>
                <a className="fdPillBtn" href={`/frontdesk/bookings?memberId=${encodeURIComponent(recentCreatedId)}`}>{t.goBooking}</a>
                <a className="fdPillBtn" href="/frontdesk/checkin">{t.goCheckin}</a>
              </div>
            </div>
          ) : null}

          <h2 className="sectionTitle">{t.resultTitle}</h2>
          <div className="fdActionGrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {items.length === 0 ? (
              <div className="fdGlassSubPanel" style={{ padding: 14 }}>
                <div className="kvValue">{t.empty}</div>
              </div>
            ) : (
              items.map((item) => (
                <article
                  key={item.id}
                  className="fdGlassSubPanel fdActionCard"
                  style={{
                    padding: 14,
                    borderColor: item.id === recentCreatedId ? "rgba(116, 182, 241, .9)" : undefined,
                    boxShadow: item.id === recentCreatedId ? "0 0 0 2px rgba(159, 212, 255, .45)" : undefined,
                  }}
                >
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
