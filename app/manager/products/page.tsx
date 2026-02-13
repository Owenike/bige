"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

interface PurchasableProduct {
  id?: string;
  code: string;
  title: string;
  itemType: "subscription" | "entry_pass" | "product";
  unitPrice: number;
  quantity: number;
  isActive?: boolean;
  sortOrder?: number;
}

export default function ManagerProductsPage() {
  const [items, setItems] = useState<PurchasableProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState("single_pass");
  const [title, setTitle] = useState("Single Pass");
  const [itemType, setItemType] = useState<PurchasableProduct["itemType"]>("entry_pass");
  const [unitPrice, setUnitPrice] = useState("300");
  const [quantity, setQuantity] = useState("1");
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState("10");

  const codeToExisting = useMemo(() => {
    const map = new Map<string, PurchasableProduct>();
    for (const p of items) map.set(p.code, p);
    return map;
  }, [items]);

  async function reload() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/manager/products");
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load products failed");
      setLoading(false);
      return;
    }
    setItems((payload.items || []) as PurchasableProduct[]);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function upsertProduct(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/manager/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          title,
          itemType,
          unitPrice: Number(unitPrice),
          quantity: Number(quantity),
          isActive,
          sortOrder: Number(sortOrder),
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || "Save failed");
        return;
      }

      setMessage(`Saved: ${payload.product?.code || code}`);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  function loadIntoForm(p: PurchasableProduct) {
    setCode(p.code);
    setTitle(p.title);
    setItemType(p.itemType);
    setUnitPrice(String(p.unitPrice ?? 0));
    setQuantity(String(p.quantity ?? 1));
    setIsActive(p.isActive !== false);
    setSortOrder(String(p.sortOrder ?? 0));
    setMessage(null);
    setError(null);
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">CATALOG</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Products
            </h1>
            <p className="fdGlassText">Manage sellable products, subscriptions, and entry passes for all frontdesk channels.</p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={upsertProduct} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Upsert Product</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" className="input" required />
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="title" className="input" required />
              <select value={itemType} onChange={(e) => setItemType(e.target.value as PurchasableProduct["itemType"])} className="input">
                <option value="entry_pass">entry_pass</option>
                <option value="subscription">subscription</option>
                <option value="product">product</option>
              </select>
              <input type="number" min="0" step="1" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="unitPrice" className="input" />
              <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="quantity" className="input" />
              <input type="number" step="1" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="sortOrder" className="input" />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> isActive
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? "Saving..." : codeToExisting.has(code) ? "Update" : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void reload()} disabled={loading}>
                {loading ? "Reloading..." : "Reload"}
              </button>
            </div>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Product List</h2>
            <div className="fdActionGrid">
              {items.map((p) => (
                <article key={p.code} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{p.title}</h3>
                  <p className="sub" style={{ marginTop: 8 }}>{p.code} | {p.itemType}</p>
                  <p className="sub" style={{ marginTop: 4 }}>NT${p.unitPrice} | qty {p.quantity} | active {p.isActive === false ? "0" : "1"} | sort {p.sortOrder ?? 0}</p>
                  <button type="button" className="fdPillBtn" onClick={() => loadIntoForm(p)} style={{ marginTop: 8 }}>
                    Edit
                  </button>
                </article>
              ))}
              {items.length === 0 ? <p className="fdGlassText">No products found.</p> : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
