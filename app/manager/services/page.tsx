"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface ServiceItem {
  id: string;
  code: string;
  name: string;
  durationMinutes: number;
  capacity: number;
  isActive: boolean;
}

export default function ManagerServicesPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
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
      setError(payload?.error || (zh ? "\u8f09\u5165\u670d\u52d9\u5931\u6557" : "Load services failed"));
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
        setError(payload?.error || (zh ? "\u5132\u5b58\u5931\u6557" : "Save failed"));
        return;
      }
      setMessage(`${zh ? "\u5df2\u5132\u5b58" : "Saved"}: ${payload.service?.code || code}`);
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
            <div className="fdEyebrow">{zh ? "\u8ab2\u7a0b\u6a23\u677f" : "COURSE TEMPLATES"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u670d\u52d9\u7ba1\u7406" : "Services"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u5b9a\u7fa9\u53ef\u9810\u7d04\u7684\u670d\u52d9\u6a23\u677f\uff0c\u5305\u542b\u6642\u9577\u3001\u5bb9\u91cf\u8207\u555f\u7528\u72c0\u614b\u3002"
                : "Define bookable service templates including duration, capacity, and activation state."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "\u56de\u5100\u8868\u677f" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={upsert} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u65b0\u589e/\u66f4\u65b0\u670d\u52d9" : "Upsert Service"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={zh ? "\u670d\u52d9\u4ee3\u78bc" : "code"} className="input" required />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={zh ? "\u540d\u7a31" : "name"} className="input" required />
              <input type="number" min="1" step="1" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} placeholder={zh ? "\u6642\u9577\uff08\u5206\u9418\uff09" : "durationMinutes"} className="input" required />
              <input type="number" min="1" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder={zh ? "\u4eba\u6578\u4e0a\u9650" : "capacity"} className="input" required />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {zh ? "\u555f\u7528" : "isActive"}
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? (zh ? "\u5132\u5b58\u4e2d..." : "Saving...") : codeToExisting.has(code) ? (zh ? "\u66f4\u65b0" : "Update") : zh ? "\u5efa\u7acb" : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Reloading...") : zh ? "\u91cd\u65b0\u8f09\u5165" : "Reload"}
              </button>
            </div>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u670d\u52d9\u6e05\u55ae" : "Service List"}</h2>
            <div className="fdActionGrid">
              {items.map((s) => (
                <article key={s.code} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{s.name}</h3>
                  <p className="sub" style={{ marginTop: 6 }}>{s.code}</p>
                  <p className="sub" style={{ marginTop: 2 }}>
                    {s.durationMinutes}m | {zh ? "\u5bb9\u91cf" : "cap"} {s.capacity} | {zh ? "\u555f\u7528" : "active"} {s.isActive ? "1" : "0"}
                  </p>
                  <button type="button" className="fdPillBtn" onClick={() => loadIntoForm(s)} style={{ marginTop: 8 }}>
                    {zh ? "\u7de8\u8f2f" : "Edit"}
                  </button>
                </article>
              ))}
              {items.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u670d\u52d9\u3002" : "No services found."}</p> : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
