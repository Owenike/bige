"use client";

import { useEffect, useState } from "react";

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
  const [items, setItems] = useState<StaffItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [role, setRole] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(true);

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
      setError(payload?.error || "Load staff failed");
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
            <div className="fdEyebrow">TEAM DIRECTORY</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Staff
            </h1>
            <p className="fdGlassText">Filter active team members by role and branch assignment for daily operations visibility.</p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">Filters</h2>
          <div className="actions" style={{ marginTop: 10 }}>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
              <option value="all">all</option>
              <option value="manager">manager</option>
              <option value="frontdesk">frontdesk</option>
              <option value="coach">coach</option>
              <option value="member">member</option>
            </select>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="display name search" className="input" />
            <label className="sub">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> activeOnly
            </label>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load()} disabled={loading}>
              {loading ? "Loading..." : "Load"}
            </button>
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">Staff List</h2>
          <div className="fdActionGrid">
            {items.map((p) => (
              <article key={p.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{p.display_name || "-"}</h3>
                <p className="sub" style={{ marginTop: 8 }}>role: {p.role}</p>
                <p className="sub" style={{ marginTop: 2 }}>active: {p.is_active ? "1" : "0"}</p>
                <p className="sub" style={{ marginTop: 2 }}>branch: {p.branch_id || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>created: {fmtDate(p.created_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>id: {p.id}</p>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">No staff records found.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
