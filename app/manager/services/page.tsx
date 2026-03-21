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
  createdAt?: string | null;
  updatedAt?: string | null;
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

function fmtTimestamp(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function ManagerServicesPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const t = {
    eyebrow: zh ? "服務主資料" : "SERVICE MASTER DATA",
    title: zh ? "服務管理" : "Services",
    subtitle: zh
      ? "這一頁只管理服務主資料：名稱、代碼、時長、容量與啟用狀態。堂次 / 扣課規則、排班與營運政策應在其他後台頁處理。"
      : "This page only manages service master data: name, code, duration, capacity, and active status. Plans, redemption rules, staffing, and operations policies belong elsewhere.",
    back: zh ? "返回後台總覽" : "Back to dashboard",
    total: zh ? "服務總數" : "Total services",
    active: zh ? "啟用中" : "Active",
    inactive: zh ? "停用中" : "Inactive",
    create: zh ? "建立服務" : "Create service",
    createHint: zh
      ? "只建立服務主資料，不在這裡定義扣課規則。"
      : "Create service master data only. Do not define plan or redemption rules here.",
    edit: zh ? "編輯服務主資料" : "Edit service master data",
    editHint: zh
      ? "目前只維護穩定可寫欄位：名稱、時長、容量與啟用狀態。"
      : "Only stable writable fields are managed here: name, duration, capacity, and active status.",
    code: zh ? "服務代碼" : "Service code",
    name: zh ? "服務名稱" : "Service name",
    duration: zh ? "時長（分鐘）" : "Duration (minutes)",
    capacity: zh ? "容量 / 人數" : "Capacity",
    serviceActive: zh ? "啟用服務" : "Service active",
    createAction: zh ? "建立服務" : "Create service",
    updateAction: zh ? "儲存主資料" : "Save master data",
    saving: zh ? "儲存中..." : "Saving...",
    refresh: zh ? "重新載入" : "Reload",
    reloading: zh ? "重新載入中..." : "Reloading...",
    list: zh ? "服務清單" : "Service list",
    listHint: zh
      ? "前台排課只讀取這裡的可用服務結果，不在前台維護主資料。"
      : "Frontdesk booking consumes available services from here, but does not maintain service master data.",
    empty: zh ? "目前沒有服務資料。" : "No services found.",
    editAction: zh ? "載入編輯" : "Edit",
    disable: zh ? "停用" : "Disable",
    enable: zh ? "啟用" : "Enable",
    working: zh ? "處理中..." : "Working...",
    noSelection: zh ? "請先從右側清單選取一項服務。" : "Select a service from the list first.",
    activeBadge: zh ? "啟用中" : "Active",
    inactiveBadge: zh ? "停用中" : "Inactive",
    selected: zh ? "已選取服務" : "Selected service",
    updatedAt: zh ? "最後更新" : "Updated",
    createdAt: zh ? "建立時間" : "Created",
    outOfScope: zh ? "不在本頁範圍" : "Out of scope for this page",
    outOfScopeHint: zh
      ? "以下責任已正式移交到其他後台頁，不在服務主資料頁直接維護。"
      : "The following responsibilities are intentionally handled on other manager pages, not on the service master data page.",
    scope1: zh ? "堂次 / 扣課規則：請到 Plans / Packages。" : "Plans and redemption rules: use Plans / Packages.",
    scope2: zh ? "排班 / block：請到 Coach Slots。" : "Staffing availability and blocks: use Coach Slots.",
    scope3: zh ? "營運與權限政策：請到 Operations & Permissions。" : "Operations and permission policies: use Operations & Permissions.",
    scope4: zh ? "前台排課建立流程：維持在 Frontdesk Bookings。" : "Frontdesk booking creation remains in Frontdesk Bookings.",
    saved: zh ? "服務已儲存" : "Service saved",
    updated: zh ? "服務已更新" : "Service updated",
    activated: zh ? "服務已啟用" : "Service activated",
    deactivated: zh ? "服務已停用" : "Service deactivated",
    loadFailed: zh ? "載入服務資料失敗" : "Load services failed",
    saveFailed: zh ? "儲存服務資料失敗" : "Save failed",
    updateFailed: zh ? "更新服務資料失敗" : "Update failed",
    toggleFailed: zh ? "切換服務狀態失敗" : "Toggle failed",
  };

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

  const selectedItem = useMemo(
    () => items.find((item) => item.code === selectedCode) ?? null,
    [items, selectedCode],
  );

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((item) => item.isActive).length;
    return { total, active, inactive: total - active };
  }, [items]);

  function bindEditor(service: ServiceItem) {
    setSelectedCode(service.code);
    setEditName(service.name);
    setEditDurationMinutes(String(service.durationMinutes));
    setEditCapacity(String(service.capacity));
    setEditIsActive(service.isActive);
  }

  function patchLocal(service: ServiceItem) {
    setItems((prev) => prev.map((item) => (item.code === service.code ? service : item)));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/services");
      const payload = (await parseJsonSafe<ServiceListPayload>(res)) || {};
      if (!res.ok) {
        setItems([]);
        setError(payload.error || t.loadFailed);
        return;
      }
      const nextItems = payload.items || [];
      setItems(nextItems);
      if (nextItems.length === 0) {
        setSelectedCode("");
        return;
      }
      const nextSelected = nextItems.find((item) => item.code === selectedCode) || nextItems[0];
      bindEditor(nextSelected);
    } catch {
      setItems([]);
      setError(t.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createService(event: FormEvent) {
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
      if (!res.ok || !payload.service) {
        setError(payload.error || t.saveFailed);
        return;
      }
      setMessage(`${t.saved}: ${payload.service.code}`);
      await load();
      bindEditor(payload.service);
    } catch {
      setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function updateService(event: FormEvent) {
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
        setError(payload.error || t.updateFailed);
        return;
      }
      patchLocal(payload.service);
      bindEditor(payload.service);
      setMessage(`${t.updated}: ${payload.service.code}`);
    } catch {
      setError(t.updateFailed);
    } finally {
      setSaving(false);
    }
  }

  async function quickToggle(service: ServiceItem) {
    setQuickBusyCode(service.code);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: service.code,
          isActive: !service.isActive,
        }),
      });
      const payload = (await parseJsonSafe<ServiceMutatePayload>(res)) || {};
      if (!res.ok || !payload.service) {
        setError(payload.error || t.toggleFailed);
        return;
      }
      patchLocal(payload.service);
      if (payload.service.code === selectedCode) bindEditor(payload.service);
      setMessage(payload.service.isActive ? t.activated : t.deactivated);
    } catch {
      setError(t.toggleFailed);
    } finally {
      setQuickBusyCode(null);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{t.eyebrow}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {t.title}
            </h1>
            <p className="fdGlassText" data-services-scope>
              {t.subtitle}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{t.back}</a>
        </p>

        {error ? (
          <div className="error" style={{ marginBottom: 12 }} data-services-error>
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="ok" style={{ marginBottom: 12 }} data-services-message>
            {message}
          </div>
        ) : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{t.total}</h3>
            <p className="h2" style={{ marginTop: 8 }} data-services-total>
              {stats.total}
            </p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{t.active}</h3>
            <p className="h2" style={{ marginTop: 8 }} data-services-active-count>
              {stats.active}
            </p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{t.inactive}</h3>
            <p className="h2" style={{ marginTop: 8 }} data-services-inactive-count>
              {stats.inactive}
            </p>
          </article>
        </section>

        <section className="fdTwoCol">
          <form onSubmit={createService} className="fdGlassSubPanel" style={{ padding: 14 }} data-create-service-form>
            <h2 className="sectionTitle">{t.create}</h2>
            <p className="fdGlassText" style={{ marginBottom: 10 }}>
              {t.createHint}
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={t.code}
                className="input"
                required
                data-service-create-code
              />
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.name}
                className="input"
                required
                data-service-create-name
              />
              <input
                type="number"
                min="1"
                step="1"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
                placeholder={t.duration}
                className="input"
                required
                data-service-create-duration
              />
              <input
                type="number"
                min="1"
                step="1"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                placeholder={t.capacity}
                className="input"
                required
                data-service-create-capacity
              />
              <label className="sub">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  data-service-create-active
                />{" "}
                {t.serviceActive}
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button
                type="submit"
                className="fdPillBtn fdPillBtnPrimary"
                disabled={saving}
                data-service-create
              >
                {saving ? t.saving : t.createAction}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? t.reloading : t.refresh}
              </button>
            </div>
          </form>

          <form onSubmit={updateService} className="fdGlassSubPanel" style={{ padding: 14 }} data-edit-service-form>
            <h2 className="sectionTitle">{t.edit}</h2>
            <p className="fdGlassText" style={{ marginBottom: 10 }}>
              {t.editHint}
            </p>
            {!selectedItem ? (
              <p className="fdGlassText">{t.noSelection}</p>
            ) : (
              <>
                <div style={{ display: "grid", gap: 8 }}>
                  <input value={selectedCode} readOnly className="input" data-selected-service-code />
                  <input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    placeholder={t.name}
                    className="input"
                    required
                    data-selected-service-name
                  />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editDurationMinutes}
                    onChange={(event) => setEditDurationMinutes(event.target.value)}
                    placeholder={t.duration}
                    className="input"
                    required
                    data-selected-service-duration
                  />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editCapacity}
                    onChange={(event) => setEditCapacity(event.target.value)}
                    placeholder={t.capacity}
                    className="input"
                    required
                    data-selected-service-capacity
                  />
                  <label className="sub">
                    <input
                      type="checkbox"
                      checked={editIsActive}
                      onChange={(event) => setEditIsActive(event.target.checked)}
                      data-selected-service-active
                    />{" "}
                    {t.serviceActive}
                  </label>
                </div>
                <div className="fdGlassText" style={{ marginTop: 12 }}>
                  <div data-selected-service-created-at>
                    {t.createdAt}: {fmtTimestamp(selectedItem.createdAt)}
                  </div>
                  <div data-selected-service-updated-at>
                    {t.updatedAt}: {fmtTimestamp(selectedItem.updatedAt)}
                  </div>
                </div>
                <button
                  type="submit"
                  className="fdPillBtn fdPillBtnPrimary"
                  style={{ marginTop: 10 }}
                  disabled={saving}
                  data-service-save
                >
                  {saving ? t.saving : t.updateAction}
                </button>
              </>
            )}
          </form>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{t.list}</h2>
          <p className="fdGlassText" style={{ marginBottom: 10 }}>
            {t.listHint}
          </p>
          {loading ? (
            <p className="fdGlassText" data-services-loading>
              {t.reloading}
            </p>
          ) : null}
          <div className="fdActionGrid" data-services-list>
            {items.map((service) => (
              <article
                key={service.code}
                className="fdGlassSubPanel fdActionCard"
                style={{ padding: 12 }}
                data-service-card
                data-service-code={service.code}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>
                    {service.name}
                  </h3>
                  <span
                    className="pill"
                    data-service-active-badge={service.isActive ? "active" : "inactive"}
                  >
                    {service.isActive ? t.activeBadge : t.inactiveBadge}
                  </span>
                </div>
                <p className="sub" style={{ marginTop: 6 }} data-service-code-text>
                  {service.code}
                </p>
                <p className="sub" style={{ marginTop: 2 }} data-service-summary>
                  {service.durationMinutes}m | {t.capacity} {service.capacity}
                </p>
                <p className="sub" style={{ marginTop: 2 }}>
                  {t.updatedAt}: {fmtTimestamp(service.updatedAt)}
                </p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() => bindEditor(service)}
                    data-service-edit
                  >
                    {t.editAction}
                  </button>
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() => void quickToggle(service)}
                    disabled={quickBusyCode === service.code}
                    data-service-toggle
                  >
                    {quickBusyCode === service.code
                      ? t.working
                      : service.isActive
                        ? t.disable
                        : t.enable}
                  </button>
                </div>
              </article>
            ))}
            {!loading && items.length === 0 ? <p className="fdGlassText">{t.empty}</p> : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-service-out-of-scope>
          <h2 className="sectionTitle">{t.outOfScope}</h2>
          <p className="fdGlassText" style={{ marginBottom: 10 }}>
            {t.outOfScopeHint}
          </p>
          <ul className="fdGlassText" style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <a href="/manager/plans">{t.scope1}</a>
            </li>
            <li>
              <a href="/manager/coach-slots">{t.scope2}</a>
            </li>
            <li>
              <a href="/manager/settings/operations">{t.scope3}</a>
            </li>
            <li>{t.scope4}</li>
          </ul>
        </section>
      </section>
    </main>
  );
}
