"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

interface ServiceItem {
  id: string;
  code: string;
  name: string;
  durationMinutes: number;
  capacity: number;
  isActive: boolean;
}

export default function ManagerServicesPage() {
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState("personal_training");
  const [name, setName] = useState("Personal Training");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [capacity, setCapacity] = useState("1");
  const [isActive, setIsActive] = useState(true);

  const codeToExisting = useMemo(() => {
    const map = new Map<string, ServiceItem>();
    for (const s of items) map.set(s.code, s);
    return map;
  }, [items]);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/manager/services");
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load services failed");
      setLoading(false);
      return;
    }
    setItems((payload.items || []) as ServiceItem[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function loadIntoForm(s: ServiceItem) {
    setCode(s.code);
    setName(s.name);
    setDurationMinutes(String(s.durationMinutes));
    setCapacity(String(s.capacity));
    setIsActive(s.isActive);
    setError(null);
    setMessage(null);
  }

  async function upsert(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          durationMinutes: Number(durationMinutes),
          capacity: Number(capacity),
          isActive,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || "Save failed");
        return;
      }
      setMessage(`Saved: ${payload.service?.code || code}`);
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
            <div className="fdEyebrow">COURSE TEMPLATES</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Services
            </h1>
            <p className="fdGlassText">Define bookable service templates including duration, capacity, and activation state.</p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={upsert} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Upsert Service</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" className="input" required />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" className="input" required />
              <input type="number" min="1" step="1" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} placeholder="durationMinutes" className="input" required />
              <input type="number" min="1" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="capacity" className="input" required />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> isActive
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? "Saving..." : codeToExisting.has(code) ? "Update" : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? "Reloading..." : "Reload"}
              </button>
            </div>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Service List</h2>
            <div className="fdActionGrid">
              {items.map((s) => (
                <article key={s.code} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{s.name}</h3>
                  <p className="sub" style={{ marginTop: 6 }}>{s.code}</p>
                  <p className="sub" style={{ marginTop: 2 }}>{s.durationMinutes}m | cap {s.capacity} | active {s.isActive ? "1" : "0"}</p>
                  <button type="button" className="fdPillBtn" onClick={() => loadIntoForm(s)} style={{ marginTop: 8 }}>
                    Edit
                  </button>
                </article>
              ))}
              {items.length === 0 ? <p className="fdGlassText">No services found.</p> : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
