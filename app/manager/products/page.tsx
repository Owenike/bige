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

  const [code, setCode] = useState("single_pass");
  const [title, setTitle] = useState("單次票");
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

  useEffect(() => {
    async function load() {
      setError(null);
      const res = await fetch("/api/manager/products");
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || "Load products failed");
        return;
      }
      setItems((payload.items || []) as PurchasableProduct[]);
    }

    void load();
  }, []);

  async function reload() {
    setError(null);
    const res = await fetch("/api/manager/products");
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load products failed");
      return;
    }
    setItems((payload.items || []) as PurchasableProduct[]);
  }

  async function upsertProduct(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

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
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Products</h1>
        <p>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
        {message ? <p style={{ color: "green" }}>{message}</p> : null}

        <section style={{ marginTop: 16 }}>
          <h2>Upsert Product</h2>
          <form onSubmit={upsertProduct}>
            <p>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" required />
            </p>
            <p>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="title" required />
            </p>
            <p>
              <select value={itemType} onChange={(e) => setItemType(e.target.value as any)}>
                <option value="entry_pass">entry_pass</option>
                <option value="subscription">subscription</option>
                <option value="product">product</option>
              </select>
            </p>
            <p>
              <input type="number" min="0" step="1" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="unitPrice" />
            </p>
            <p>
              <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="quantity" />
            </p>
            <p>
              <input type="number" step="1" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="sortOrder" />
            </p>
            <p>
              <label>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> isActive
              </label>
            </p>
            <button type="submit">{codeToExisting.has(code) ? "Update" : "Create"}</button>
            <button type="button" onClick={() => void reload()} style={{ marginLeft: 8 }}>
              Reload
            </button>
          </form>
        </section>

        <ul>
          {items.map((p) => (
            <li key={p.code}>
              <button type="button" onClick={() => loadIntoForm(p)} style={{ marginRight: 8 }}>
                Edit
              </button>
              {p.code} | {p.title} | {p.itemType} | NT${p.unitPrice} | active {p.isActive === false ? "0" : "1"} | sort{" "}
              {p.sortOrder ?? 0}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
