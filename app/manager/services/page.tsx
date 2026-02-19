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

interface ErrorPayload {
  error?: string;
}

interface ServiceListPayload extends ErrorPayload {
  items?: ServiceItem[];
}

interface ServiceMutatePayload extends ErrorPayload {
  service?: ServiceItem;
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

export default function ManagerServicesPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickBusyCode, setQuickBusyCode] = useState<string | null>(null);

  const [code, setCode] = useState("personal_training");
  const [name, setName] = useState("Personal Training");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [capacity, setCapacity] = useState("1");
  const [isActive, setIsActive] = useState(true);

  const [selectedCode, setSelectedCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editDurationMinutes, setEditDurationMinutes] = useState("60");
  const [editCapacity, setEditCapacity] = useState("1");
  const [editIsActive, setEditIsActive] = useState(true);

  function bindEditor(s: ServiceItem) {
    setSelectedCode(s.code);
    setEditName(s.name);
    setEditDurationMinutes(String(s.durationMinutes));
    setEditCapacity(String(s.capacity));
    setEditIsActive(s.isActive);
  }

  function patchLocal(s: ServiceItem) {
    setItems((prev) => prev.map((v) => (v.code === s.code ? s : v)));
  }

  const codeToExisting = useMemo(() => {
    const map = new Map<string, ServiceItem>();
    for (const s of items) map.set(s.code, s);
    return map;
  }, [items]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/services");
      const payload = (await parseJsonSafe<ServiceListPayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "載入服務失敗" : "Load services failed"));
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
      setError(zh ? "載入服務失敗" : "Load services failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const payload = (await parseJsonSafe<ServiceMutatePayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "儲存失敗" : "Save failed"));
        setSaving(false);
        return;
      }
      setMessage(`${zh ? "已儲存" : "Saved"}: ${payload.service?.code || code}`);
      await load();
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
      const res = await fetch("/api/manager/services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: selectedCode,
          name: editName,
          durationMinutes: Number(editDurationMinutes),
          capacity: Number(editCapacity),
          isActive: editIsActive,
        }),
      });
      const payload = (await parseJsonSafe<ServiceMutatePayload>(res)) || {};
      if (!res.ok || !payload.service) {
        setError(payload.error || (zh ? "更新失敗" : "Update failed"));
        setSaving(false);
        return;
      }
      patchLocal(payload.service);
      bindEditor(payload.service);
      setMessage(`${zh ? "已更新服務" : "Service updated"}: ${payload.service.code}`);
    } catch {
      setError(zh ? "更新失敗" : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function quickToggle(item: ServiceItem) {
    setQuickBusyCode(item.code);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: item.code,
          isActive: !item.isActive,
        }),
      });
      const payload = (await parseJsonSafe<ServiceMutatePayload>(res)) || {};
      if (!res.ok || !payload.service) {
        setError(payload.error || (zh ? "切換狀態失敗" : "Toggle failed"));
        setQuickBusyCode(null);
        return;
      }
      patchLocal(payload.service);
      if (payload.service.code === selectedCode) bindEditor(payload.service);
      setMessage(payload.service.isActive ? (zh ? "服務已啟用" : "Service activated") : zh ? "服務已停用" : "Service deactivated");
    } catch {
      setError(zh ? "切換狀態失敗" : "Toggle failed");
    } finally {
      setQuickBusyCode(null);
    }
  }

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((v) => v.isActive).length;
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
            <div className="fdEyebrow">{zh ? "課務模板" : "COURSE TEMPLATES"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "服務管理" : "Services"}
            </h1>
            <p className="fdGlassText">
              {zh ? "建立、調整與啟停可預約服務模板。" : "Create, update, and toggle bookable service templates."}
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
            <h3 className="fdActionTitle">{zh ? "服務數" : "Total Services"}</h3>
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
          <form onSubmit={upsert} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "新增 / 依代碼覆蓋" : "Create / Upsert by Code"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={zh ? "服務代碼" : "code"} className="input" required />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={zh ? "名稱" : "name"} className="input" required />
              <input type="number" min="1" step="1" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} placeholder={zh ? "時長（分鐘）" : "durationMinutes"} className="input" required />
              <input type="number" min="1" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder={zh ? "人數上限" : "capacity"} className="input" required />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {zh ? "啟用" : "isActive"}
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? (zh ? "儲存中..." : "Saving...") : codeToExisting.has(code) ? (zh ? "更新" : "Update") : zh ? "建立" : "Create"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? (zh ? "載入中..." : "Reloading...") : zh ? "重新載入" : "Reload"}
              </button>
            </div>
          </form>

          <form onSubmit={saveEdit} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "編輯服務" : "Edit Service"}</h2>
            {!selectedCode ? (
              <p className="fdGlassText">{zh ? "請先從下方清單選擇服務。" : "Select one service from the list below first."}</p>
            ) : (
              <>
                <div style={{ display: "grid", gap: 8 }}>
                  <input value={selectedCode} readOnly className="input" />
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={zh ? "名稱" : "name"} className="input" required />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editDurationMinutes}
                    onChange={(e) => setEditDurationMinutes(e.target.value)}
                    placeholder={zh ? "時長（分鐘）" : "durationMinutes"}
                    className="input"
                    required
                  />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editCapacity}
                    onChange={(e) => setEditCapacity(e.target.value)}
                    placeholder={zh ? "人數上限" : "capacity"}
                    className="input"
                    required
                  />
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
          <h2 className="sectionTitle">{zh ? "服務清單" : "Service List"}</h2>
          <div className="fdActionGrid">
            {items.map((s) => (
              <article key={s.code} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{s.name}</h3>
                <p className="sub" style={{ marginTop: 6 }}>{s.code}</p>
                <p className="sub" style={{ marginTop: 2 }}>
                  {s.durationMinutes}m | {zh ? "容量" : "cap"} {s.capacity} | {zh ? "啟用" : "active"} {s.isActive ? "1" : "0"}
                </p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button type="button" className="fdPillBtn" onClick={() => bindEditor(s)}>
                    {zh ? "載入編輯" : "Edit"}
                  </button>
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() => void quickToggle(s)}
                    disabled={quickBusyCode === s.code}
                  >
                    {quickBusyCode === s.code ? (zh ? "處理中..." : "Working...") : s.isActive ? (zh ? "停用" : "Disable") : zh ? "啟用" : "Enable"}
                  </button>
                </div>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">{zh ? "找不到服務。" : "No services found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
