"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

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
  const { locale } = useI18n();
  const zh = locale !== "en";
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

  function itemTypeLabel(value: PurchasableProduct["itemType"]) {
    if (!zh) return value;
    if (value === "entry_pass") return "\u5165\u5834\u7968";
    if (value === "subscription") return "\u6703\u54e1\u65b9\u6848";
    if (value === "product") return "\u4e00\u822c\u5546\u54c1";
    return value;
  }

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
      setError(payload?.error || (zh ? "\u8f09\u5165\u5546\u54c1\u5931\u6557" : "Load products failed"));
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
        setError(payload?.error || (zh ? "\u5132\u5b58\u5931\u6557" : "Save failed"));
        return;
      }

      setMessage(`${zh ? "\u5df2\u5132\u5b58" : "Saved"}: ${payload.product?.code || code}`);
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
            <div className="fdEyebrow">{zh ? "\u578b\u9304" : "CATALOG"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u5546\u54c1\u7ba1\u7406" : "Products"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u7ba1\u7406\u53ef\u552e\u5546\u54c1\u3001\u6703\u54e1\u65b9\u6848\u8207\u5165\u5834\u7968\u5238\u3002"
                : "Manage sellable products, subscriptions, and entry passes for all frontdesk channels."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "\u56de\u5100\u8868\u677f" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={upsertProduct} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u65b0\u589e/\u66f4\u65b0\u5546\u54c1" : "Upsert Product"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={zh ? "\u5546\u54c1\u4ee3\u78bc" : "code"} className="input" required />
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={zh ? "\u540d\u7a31" : "title"} className="input" required />
              <select value={itemType} onChange={(e) => setItemType(e.target.value as PurchasableProduct["itemType"])} className="input">
                <option value="entry_pass">{zh ? "\u5165\u5834\u7968" : "entry_pass"}</option>
                <option value="subscription">{zh ? "\u6703\u54e1\u65b9\u6848" : "subscription"}</option>
                <option value="product">{zh ? "\u4e00\u822c\u5546\u54c1" : "product"}</option>
              </select>
              <input type="number" min="0" step="1" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder={zh ? "\u55ae\u50f9" : "unitPrice"} className="input" />
              <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={zh ? "\u6578\u91cf" : "quantity"} className="input" />
              <input type="number" step="1" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder={zh ? "\u6392\u5e8f" : "sortOrder"} className="input" />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {zh ? "\u555f\u7528" : "isActive"}
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? (zh ? "\u5132\u5b58\u4e2d..." : "Saving...") : codeToExisting.has(code) ? (zh ? "\u66f4\u65b0" : "Update") : zh ? "\u5efa\u7acb" : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void reload()} disabled={loading}>
                {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Reloading...") : zh ? "\u91cd\u65b0\u8f09\u5165" : "Reload"}
              </button>
            </div>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u5546\u54c1\u6e05\u55ae" : "Product List"}</h2>
            <div className="fdActionGrid">
              {items.map((p) => (
                <article key={p.code} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{p.title}</h3>
                  <p className="sub" style={{ marginTop: 8 }}>{p.code} | {itemTypeLabel(p.itemType)}</p>
                  <p className="sub" style={{ marginTop: 4 }}>
                    NT${p.unitPrice} | {zh ? "\u6578\u91cf" : "qty"} {p.quantity} | {zh ? "\u555f\u7528" : "active"}{" "}
                    {p.isActive === false ? "0" : "1"} | {zh ? "\u6392\u5e8f" : "sort"} {p.sortOrder ?? 0}
                  </p>
                  <button type="button" className="fdPillBtn" onClick={() => loadIntoForm(p)} style={{ marginTop: 8 }}>
                    {zh ? "\u7de8\u8f2f" : "Edit"}
                  </button>
                </article>
              ))}
              {items.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u5546\u54c1\u3002" : "No products found."}</p> : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
