"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface BranchItem {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

interface ErrorPayload {
  error?: string;
}

interface BranchListPayload extends ErrorPayload {
  items?: BranchItem[];
}

interface BranchMutatePayload extends ErrorPayload {
  branch?: BranchItem;
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

export default function ManagerBranchesPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [items, setItems] = useState<BranchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [selectedId, setSelectedId] = useState("");
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  function bindEditor(item: BranchItem) {
    setSelectedId(item.id);
    setEditName(item.name);
    setEditCode(item.code || "");
    setEditAddress(item.address || "");
    setEditIsActive(item.is_active);
  }

  function patchLocal(item: BranchItem) {
    setItems((prev) => prev.map((v) => (v.id === item.id ? item : v)));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/branches");
      const payload = (await parseJsonSafe<BranchListPayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "載入分館失敗" : "Load branches failed"));
        setItems([]);
        setLoading(false);
        return;
      }
      const rows = payload.items || [];
      setItems(rows);
      if (rows.length > 0) {
        const selected = rows.find((v) => v.id === selectedId) || rows[0];
        bindEditor(selected);
      } else {
        setSelectedId("");
      }
    } catch {
      setError(zh ? "載入分館失敗" : "Load branches failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const payload = (await parseJsonSafe<BranchMutatePayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "建立失敗" : "Create failed"));
        setSaving(false);
        return;
      }
      setMessage(`${zh ? "已建立" : "Created"}: ${payload.branch?.name || name}`);
      setName("");
      setCode("");
      setAddress("");
      setIsActive(true);
      await load();
    } catch {
      setError(zh ? "建立失敗" : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedId,
          name: editName,
          code: editCode || null,
          address: editAddress || null,
          isActive: editIsActive,
        }),
      });
      const payload = (await parseJsonSafe<BranchMutatePayload>(res)) || {};
      if (!res.ok || !payload.branch) {
        setError(payload.error || (zh ? "更新失敗" : "Update failed"));
        setSaving(false);
        return;
      }
      patchLocal(payload.branch);
      bindEditor(payload.branch);
      setMessage(`${zh ? "已更新分館" : "Branch updated"}: ${payload.branch.name}`);
    } catch {
      setError(zh ? "更新失敗" : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function quickToggle(item: BranchItem) {
    setQuickBusyId(item.id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          isActive: !item.is_active,
        }),
      });
      const payload = (await parseJsonSafe<BranchMutatePayload>(res)) || {};
      if (!res.ok || !payload.branch) {
        setError(payload.error || (zh ? "切換狀態失敗" : "Toggle failed"));
        setQuickBusyId(null);
        return;
      }
      patchLocal(payload.branch);
      if (payload.branch.id === selectedId) bindEditor(payload.branch);
      setMessage(payload.branch.is_active ? (zh ? "分館已啟用" : "Branch activated") : zh ? "分館已停用" : "Branch deactivated");
    } catch {
      setError(zh ? "切換狀態失敗" : "Toggle failed");
    } finally {
      setQuickBusyId(null);
    }
  }

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((v) => v.is_active).length;
    return {
      total,
      active,
      inactive: total - active,
    };
  }, [items]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "組織設定" : "ORG SETTINGS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "分館管理" : "Branches"}
            </h1>
            <p className="fdGlassText">
              {zh ? "建立、編輯與啟停分館，供櫃檯、教練與會員流程使用。" : "Create, edit, and activate/deactivate branches used by operations."}
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
            <h3 className="fdActionTitle">{zh ? "分館數" : "Total Branches"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.total}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "啟用中" : "Active"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.active}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "停用中" : "Inactive"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.inactive}</p>
          </article>
        </section>

        <section className="fdTwoCol">
          <form onSubmit={create} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "建立分館" : "Create Branch"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={zh ? "分館名稱" : "name"} className="input" required />
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={zh ? "分館代碼（選填）" : "code (optional)"} className="input" />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={zh ? "地址（選填）" : "address (optional)"} className="input" />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {zh ? "啟用" : "isActive"}
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? (zh ? "建立中..." : "Creating...") : zh ? "建立" : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? (zh ? "重新載入..." : "Reloading...") : zh ? "重新載入" : "Reload"}
              </button>
            </div>
          </form>

          <form onSubmit={saveEdit} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "編輯分館" : "Edit Branch"}</h2>
            {!selectedId ? (
              <p className="fdGlassText">{zh ? "請先從下方清單選擇分館。" : "Select one branch from the list below first."}</p>
            ) : (
              <>
                <div style={{ display: "grid", gap: 8 }}>
                  <input value={selectedId} readOnly className="input" />
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={zh ? "分館名稱" : "name"} className="input" required />
                  <input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder={zh ? "分館代碼（選填）" : "code (optional)"} className="input" />
                  <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder={zh ? "地址（選填）" : "address (optional)"} className="input" />
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
          <h2 className="sectionTitle">{zh ? "分館清單" : "Branch List"}</h2>
          <div className="fdActionGrid">
            {items.map((b) => (
              <article key={b.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{b.name}</h3>
                <p className="sub" style={{ marginTop: 6 }}>{zh ? "代碼" : "code"}: {b.code || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "地址" : "address"}: {b.address || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "啟用" : "active"}: {b.is_active ? "1" : "0"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "ID" : "id"}: {b.id}</p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button type="button" className="fdPillBtn" onClick={() => bindEditor(b)}>
                    {zh ? "載入編輯" : "Edit"}
                  </button>
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() => void quickToggle(b)}
                    disabled={quickBusyId === b.id}
                  >
                    {quickBusyId === b.id ? (zh ? "處理中..." : "Working...") : b.is_active ? (zh ? "停用" : "Disable") : zh ? "啟用" : "Enable"}
                  </button>
                </div>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">{zh ? "找不到分館。" : "No branches found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
