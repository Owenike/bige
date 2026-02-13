"use client";

import { FormEvent, useEffect, useState } from "react";

interface BranchItem {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
}

export default function ManagerBranchesPage() {
  const [items, setItems] = useState<BranchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [isActive, setIsActive] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/manager/branches");
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load branches failed");
      setLoading(false);
      return;
    }
    setItems((payload.items || []) as BranchItem[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          code: code || null,
          address: address || null,
          isActive,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || "Create failed");
        return;
      }
      setMessage(`Created: ${payload.branch?.name || name}`);
      setName("");
      setCode("");
      setAddress("");
      setIsActive(true);
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
            <div className="fdEyebrow">ORG SETTINGS</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Branches
            </h1>
            <p className="fdGlassText">Create and maintain active branch records used by frontdesk, coach, and membership workflows.</p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={create} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Create Branch</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" className="input" required />
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="code (optional)" className="input" />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="address (optional)" className="input" />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> isActive
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? "Creating..." : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? "Reloading..." : "Reload"}
              </button>
            </div>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Branch List</h2>
            <div className="fdActionGrid">
              {items.map((b) => (
                <article key={b.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{b.name}</h3>
                  <p className="sub" style={{ marginTop: 6 }}>code: {b.code || "-"}</p>
                  <p className="sub" style={{ marginTop: 2 }}>address: {b.address || "-"}</p>
                  <p className="sub" style={{ marginTop: 2 }}>active: {b.is_active ? "1" : "0"}</p>
                  <p className="sub" style={{ marginTop: 2 }}>id: {b.id}</p>
                </article>
              ))}
              {items.length === 0 ? <p className="fdGlassText">No branches found.</p> : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
