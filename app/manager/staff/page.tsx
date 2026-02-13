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

export default function ManagerStaffPage() {
  const [items, setItems] = useState<StaffItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [role, setRole] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(true);

  async function load() {
    setError(null);
    const params = new URLSearchParams();
    if (role !== "all") params.set("role", role);
    if (q.trim()) params.set("q", q.trim());
    if (activeOnly) params.set("activeOnly", "1");
    const res = await fetch(`/api/manager/staff?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load staff failed");
      return;
    }
    setItems((payload.items || []) as StaffItem[]);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Staff</h1>
        <p>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

        <section style={{ marginTop: 16 }}>
          <h2>Filters</h2>
          <p>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="all">all</option>
              <option value="manager">manager</option>
              <option value="frontdesk">frontdesk</option>
              <option value="coach">coach</option>
              <option value="member">member</option>
            </select>
            {" "}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="display name search" />
            {" "}
            <label>
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> activeOnly
            </label>
            {" "}
            <button type="button" onClick={() => void load()}>
              Load
            </button>
          </p>
        </section>

        <section style={{ marginTop: 16 }}>
          <h2>Staff List</h2>
          <ul>
            {items.map((p) => (
              <li key={p.id}>
                {p.role} | {p.display_name || "-"} | active {p.is_active ? "1" : "0"} | branch {p.branch_id || "-"} | id {p.id}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
