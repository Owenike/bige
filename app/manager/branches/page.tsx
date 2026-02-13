"use client";

import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface BranchItem {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
}

export default function ManagerBranchesPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
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
      setError(payload?.error || (zh ? "\u8f09\u5165\u5206\u9928\u5931\u6557" : "Load branches failed"));
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
        setError(payload?.error || (zh ? "\u5efa\u7acb\u5931\u6557" : "Create failed"));
        return;
      }
      setMessage(`${zh ? "\u5df2\u5efa\u7acb" : "Created"}: ${payload.branch?.name || name}`);
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
            <div className="fdEyebrow">{zh ? "\u7d44\u7e54\u8a2d\u5b9a" : "ORG SETTINGS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u5206\u9928\u7ba1\u7406" : "Branches"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u5efa\u7acb\u8207\u7dad\u8b77\u5206\u9928\u8cc7\u6599\uff0c\u4f9b\u6ac3\u6aaf\u3001\u6559\u7df4\u8207\u6703\u54e1\u6d41\u7a0b\u4f7f\u7528\u3002"
                : "Create and maintain active branch records used by frontdesk, coach, and membership workflows."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "\u56de\u5100\u8868\u677f" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={create} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u5efa\u7acb\u5206\u9928" : "Create Branch"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={zh ? "\u5206\u9928\u540d\u7a31" : "name"} className="input" required />
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={zh ? "\u5206\u9928\u4ee3\u78bc\uff08\u9078\u586b\uff09" : "code (optional)"} className="input" />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={zh ? "\u5730\u5740\uff08\u9078\u586b\uff09" : "address (optional)"} className="input" />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {zh ? "\u555f\u7528" : "isActive"}
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? (zh ? "\u5efa\u7acb\u4e2d..." : "Creating...") : zh ? "\u5efa\u7acb" : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? (zh ? "\u91cd\u65b0\u8f09\u5165..." : "Reloading...") : zh ? "\u91cd\u65b0\u8f09\u5165" : "Reload"}
              </button>
            </div>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u5206\u9928\u6e05\u55ae" : "Branch List"}</h2>
            <div className="fdActionGrid">
              {items.map((b) => (
                <article key={b.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{b.name}</h3>
                  <p className="sub" style={{ marginTop: 6 }}>{zh ? "\u4ee3\u78bc" : "code"}: {b.code || "-"}</p>
                  <p className="sub" style={{ marginTop: 2 }}>{zh ? "\u5730\u5740" : "address"}: {b.address || "-"}</p>
                  <p className="sub" style={{ marginTop: 2 }}>{zh ? "\u555f\u7528" : "active"}: {b.is_active ? "1" : "0"}</p>
                  <p className="sub" style={{ marginTop: 2 }}>{zh ? "ID" : "id"}: {b.id}</p>
                </article>
              ))}
              {items.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u5206\u9928\u3002" : "No branches found."}</p> : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
