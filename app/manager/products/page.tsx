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

interface ErrorPayload {
  error?: string;
}

interface ProductListPayload extends ErrorPayload {
  items?: PurchasableProduct[];
}

interface ProductMutatePayload extends ErrorPayload {
  product?: PurchasableProduct;
}

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export default function ManagerProductsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [items, setItems] = useState<PurchasableProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickBusyCode, setQuickBusyCode] = useState<string | null>(null);

  const [code, setCode] = useState("single_pass");
  const [title, setTitle] = useState("Single Pass");
  const [itemType, setItemType] = useState<PurchasableProduct["itemType"]>("entry_pass");
  const [unitPrice, setUnitPrice] = useState("300");
  const [quantity, setQuantity] = useState("1");
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState("10");

  const [selectedCode, setSelectedCode] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editItemType, setEditItemType] = useState<PurchasableProduct["itemType"]>("entry_pass");
  const [editUnitPrice, setEditUnitPrice] = useState("0");
  const [editQuantity, setEditQuantity] = useState("1");
  const [editSortOrder, setEditSortOrder] = useState("0");
  const [editIsActive, setEditIsActive] = useState(true);

  function itemTypeLabel(value: PurchasableProduct["itemType"]) {
    if (!zh) return value;
    if (value === "entry_pass") return "入場票";
    if (value === "subscription") return "會員方案";
    if (value === "product") return "一般商品";
    return value;
  }

  function bindEditor(p: PurchasableProduct) {
    setSelectedCode(p.code);
    setEditTitle(p.title);
    setEditItemType(p.itemType);
    setEditUnitPrice(String(p.unitPrice ?? 0));
    setEditQuantity(String(p.quantity ?? 1));
    setEditSortOrder(String(p.sortOrder ?? 0));
    setEditIsActive(p.isActive !== false);
  }

  function patchLocal(p: PurchasableProduct) {
    setItems((prev) => prev.map((v) => (v.code === p.code ? p : v)));
  }

  const codeToExisting = useMemo(() => {
    const map = new Map<string, PurchasableProduct>();
    for (const p of items) map.set(p.code, p);
    return map;
  }, [items]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/products");
      const payload = (await parseJsonSafe<ProductListPayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "載入商品失敗" : "Load products failed"));
        setItems([]);
        setLoading(false);
        return;
      }
      const rows = payload.items || [];
      setItems(rows);
      if (rows.length > 0) {
        const selected = rows.find((v) => v.code === selectedCode) || rows[0];
        bindEditor(selected);
      } else {
        setSelectedCode("");
      }
    } catch {
      setError(zh ? "載入商品失敗" : "Load products failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const payload = (await parseJsonSafe<ProductMutatePayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "儲存失敗" : "Save failed"));
        setSaving(false);
        return;
      }

      setMessage(`${zh ? "已儲存" : "Saved"}: ${payload.product?.code || code}`);
      await reload();
    } catch {
      setError(zh ? "儲存失敗" : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!selectedCode) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: selectedCode,
          title: editTitle,
          itemType: editItemType,
          unitPrice: Number(editUnitPrice),
          quantity: Number(editQuantity),
          sortOrder: Number(editSortOrder),
          isActive: editIsActive,
        }),
      });
      const payload = (await parseJsonSafe<ProductMutatePayload>(res)) || {};
      if (!res.ok || !payload.product) {
        setError(payload.error || (zh ? "更新失敗" : "Update failed"));
        setSaving(false);
        return;
      }
      patchLocal(payload.product);
      bindEditor(payload.product);
      setMessage(`${zh ? "已更新商品" : "Product updated"}: ${payload.product.code}`);
    } catch {
      setError(zh ? "更新失敗" : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function quickToggle(item: PurchasableProduct) {
    setQuickBusyCode(item.code);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: item.code,
          isActive: item.isActive === false,
        }),
      });
      const payload = (await parseJsonSafe<ProductMutatePayload>(res)) || {};
      if (!res.ok || !payload.product) {
        setError(payload.error || (zh ? "切換狀態失敗" : "Toggle failed"));
        setQuickBusyCode(null);
        return;
      }
      patchLocal(payload.product);
      if (payload.product.code === selectedCode) bindEditor(payload.product);
      setMessage(payload.product.isActive ? (zh ? "商品已啟用" : "Product activated") : zh ? "商品已停用" : "Product deactivated");
    } catch {
      setError(zh ? "切換狀態失敗" : "Toggle failed");
    } finally {
      setQuickBusyCode(null);
    }
  }

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((v) => v.isActive !== false).length;
    const subscriptions = items.filter((v) => v.itemType === "subscription").length;
    const passes = items.filter((v) => v.itemType === "entry_pass").length;
    return { total, active, inactive: total - active, subscriptions, passes };
  }, [items]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "型錄" : "CATALOG"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "商品管理" : "Products"}
            </h1>
            <p className="fdGlassText">
              {zh ? "管理可售商品、會籍方案與入場票，並可即時啟停。" : "Manage products, memberships, and passes with live enable/disable control."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "回儀表板" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "商品數" : "Total Products"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.total}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "啟用中" : "Active"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.active}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "會員方案 / 入場票" : "Subs / Passes"}</h3>
            <p className="sub" style={{ marginTop: 8 }}>{stats.subscriptions} / {stats.passes}</p>
          </article>
        </section>

        <section className="fdTwoCol">
          <form onSubmit={upsertProduct} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "新增 / 依代碼覆蓋" : "Create / Upsert by Code"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={zh ? "商品代碼" : "code"} className="input" required />
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={zh ? "名稱" : "title"} className="input" required />
              <select value={itemType} onChange={(e) => setItemType(e.target.value as PurchasableProduct["itemType"])} className="input">
                <option value="entry_pass">{zh ? "入場票" : "entry_pass"}</option>
                <option value="subscription">{zh ? "會員方案" : "subscription"}</option>
                <option value="product">{zh ? "一般商品" : "product"}</option>
              </select>
              <input type="number" min="0" step="1" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder={zh ? "單價" : "unitPrice"} className="input" />
              <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={zh ? "數量" : "quantity"} className="input" />
              <input type="number" step="1" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder={zh ? "排序" : "sortOrder"} className="input" />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {zh ? "啟用" : "isActive"}
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? (zh ? "儲存中..." : "Saving...") : codeToExisting.has(code) ? (zh ? "更新" : "Update") : zh ? "建立" : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void reload()} disabled={loading}>
                {loading ? (zh ? "載入中..." : "Reloading...") : zh ? "重新載入" : "Reload"}
              </button>
            </div>
          </form>

          <form onSubmit={saveEdit} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "編輯商品" : "Edit Product"}</h2>
            {!selectedCode ? (
              <p className="fdGlassText">{zh ? "請先從下方清單選擇商品。" : "Select one product from the list below first."}</p>
            ) : (
              <>
                <div style={{ display: "grid", gap: 8 }}>
                  <input value={selectedCode} readOnly className="input" />
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder={zh ? "名稱" : "title"} className="input" required />
                  <select value={editItemType} onChange={(e) => setEditItemType(e.target.value as PurchasableProduct["itemType"])} className="input">
                    <option value="entry_pass">{zh ? "入場票" : "entry_pass"}</option>
                    <option value="subscription">{zh ? "會員方案" : "subscription"}</option>
                    <option value="product">{zh ? "一般商品" : "product"}</option>
                  </select>
                  <input type="number" min="0" step="1" value={editUnitPrice} onChange={(e) => setEditUnitPrice(e.target.value)} placeholder={zh ? "單價" : "unitPrice"} className="input" />
                  <input type="number" min="1" step="1" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} placeholder={zh ? "數量" : "quantity"} className="input" />
                  <input type="number" step="1" value={editSortOrder} onChange={(e) => setEditSortOrder(e.target.value)} placeholder={zh ? "排序" : "sortOrder"} className="input" />
                  <label className="sub">
                    <input type="checkbox" checked={editIsActive} onChange={(e) => setEditIsActive(e.target.checked)} /> {zh ? "啟用" : "isActive"}
                  </label>
                </div>
                <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>
                  {saving ? (zh ? "儲存中..." : "Saving...") : zh ? "儲存修改" : "Save changes"}
                </button>
              </>
            )}
          </form>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "商品清單" : "Product List"}</h2>
          <div className="fdActionGrid">
            {items.map((p) => (
              <article key={p.code} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{p.title}</h3>
                <p className="sub" style={{ marginTop: 8 }}>{p.code} | {itemTypeLabel(p.itemType)}</p>
                <p className="sub" style={{ marginTop: 4 }}>
                  NT${p.unitPrice} | {zh ? "數量" : "qty"} {p.quantity} | {zh ? "啟用" : "active"} {p.isActive === false ? "0" : "1"} | {zh ? "排序" : "sort"} {p.sortOrder ?? 0}
                </p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button type="button" className="fdPillBtn" onClick={() => bindEditor(p)}>
                    {zh ? "載入編輯" : "Edit"}
                  </button>
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() => void quickToggle(p)}
                    disabled={quickBusyCode === p.code}
                  >
                    {quickBusyCode === p.code ? (zh ? "處理中..." : "Working...") : p.isActive === false ? (zh ? "啟用" : "Enable") : zh ? "停用" : "Disable"}
                  </button>
                </div>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">{zh ? "找不到商品。" : "No products found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
