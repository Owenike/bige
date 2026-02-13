"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface StaffItem {
  id: string;
  role: string;
  branch_id: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
}

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function ManagerStaffPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [items, setItems] = useState<StaffItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [role, setRole] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(true);

  function roleLabel(roleValue: string) {
    if (!zh) return roleValue;
    if (roleValue === "manager") return "\u7ba1\u7406\u8005";
    if (roleValue === "frontdesk") return "\u6ac3\u6aaf";
    if (roleValue === "coach") return "\u6559\u7df4";
    if (roleValue === "member") return "\u6703\u54e1";
    if (roleValue === "platform_admin") return "\u5e73\u53f0\u7ba1\u7406\u54e1";
    return roleValue;
  }

  async function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (role !== "all") params.set("role", role);
    if (q.trim()) params.set("q", q.trim());
    if (activeOnly) params.set("activeOnly", "1");
    const res = await fetch(`/api/manager/staff?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || (zh ? "\u8f09\u5165\u4eba\u54e1\u5931\u6557" : "Load staff failed"));
      setLoading(false);
      return;
    }
    setItems((payload.items || []) as StaffItem[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u5718\u968a\u540d\u55ae" : "TEAM DIRECTORY"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u4eba\u54e1\u7ba1\u7406" : "Staff"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u4f9d\u89d2\u8272\u8207\u5206\u9928\u7be9\u9078\u4eba\u54e1\uff0c\u63d0\u9ad8\u65e5\u5e38\u71df\u904b\u53ef\u8996\u6027\u3002"
                : "Filter active team members by role and branch assignment for daily operations visibility."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "\u56de\u5100\u8868\u677f" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u7be9\u9078\u689d\u4ef6" : "Filters"}</h2>
          <div className="actions" style={{ marginTop: 10 }}>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
              <option value="all">{zh ? "\u5168\u90e8" : "all"}</option>
              <option value="manager">{zh ? "\u7ba1\u7406\u8005" : "manager"}</option>
              <option value="frontdesk">{zh ? "\u6ac3\u6aaf" : "frontdesk"}</option>
              <option value="coach">{zh ? "\u6559\u7df4" : "coach"}</option>
              <option value="member">{zh ? "\u6703\u54e1" : "member"}</option>
            </select>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={zh ? "\u540d\u7a31\u641c\u5c0b" : "display name search"} className="input" />
            <label className="sub">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> {zh ? "\u50c5\u986f\u793a\u555f\u7528" : "activeOnly"}
            </label>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load()} disabled={loading}>
              {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Loading...") : zh ? "\u8f09\u5165" : "Load"}
            </button>
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u4eba\u54e1\u6e05\u55ae" : "Staff List"}</h2>
          <div className="fdActionGrid">
            {items.map((p) => (
              <article key={p.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{p.display_name || "-"}</h3>
                <p className="sub" style={{ marginTop: 8 }}>{zh ? "\u89d2\u8272" : "role"}: {roleLabel(p.role)}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "\u555f\u7528" : "active"}: {p.is_active ? "1" : "0"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "\u5206\u9928" : "branch"}: {p.branch_id || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "\u5efa\u7acb\u6642\u9593" : "created"}: {fmtDate(p.created_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "ID" : "id"}: {p.id}</p>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u4eba\u54e1\u8cc7\u6599\u3002" : "No staff records found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
