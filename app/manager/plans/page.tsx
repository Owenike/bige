"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

type PlanType = "subscription" | "entry_pass" | "coach_pack" | "trial";
type FulfillmentKind = "subscription" | "entry_pass" | "none";

type PlanItem = {
  id: string;
  tenantId: string;
  branchId?: string | null;
  code: string;
  name: string;
  description: string | null;
  planType: PlanType;
  fulfillmentKind: FulfillmentKind;
  defaultDurationDays: number | null;
  defaultQuantity: number | null;
  serviceScope: string[];
  allowAutoRenew: boolean;
  isActive: boolean;
  updatedAt: string;
  createdAt?: string;
};

type ServiceItem = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type Payload = {
  ok?: boolean;
  error?: string | { message?: string };
  data?: {
    items?: PlanItem[];
    item?: PlanItem;
    summary?: {
      totalPlans: number;
      activePlans: number;
      inactivePlans: number;
      expiringSoon: number;
      expired: number;
      exhausted: number;
    };
  };
};

type ServiceListPayload = {
  items?: ServiceItem[];
  error?: string;
};

function parseError(payload: Payload | null, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error && typeof payload.error.message === "string") return payload.error.message;
  return fallback;
}

function fmtTimestamp(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function sortCodes(codes: string[]) {
  return [...codes].sort((a, b) => a.localeCompare(b));
}

export default function ManagerPlansPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const t = {
    eyebrow: zh ? "堂次 / 扣課規則" : "ENTITLEMENT RULES",
    title: zh ? "Plans" : "Plans",
    subtitle: zh
      ? "這一頁只負責 plan / entitlement / redemption 規則：方案型態、發放方式、可用次數、有效期與服務適用範圍。"
      : "This page manages plan, entitlement, and redemption rules: plan type, fulfillment kind, quantity, duration, and service scope.",
    back: zh ? "返回後台總覽" : "Back to dashboard",
    total: zh ? "方案總數" : "Total plans",
    active: zh ? "啟用中" : "Active",
    inactive: zh ? "停用中" : "Inactive",
    contracts: zh ? "即將到期 / 已到期 / 用盡" : "Expiring / expired / exhausted",
    create: zh ? "建立 plan 規則" : "Create plan rule",
    createHint: zh
      ? "這裡只建立 entitlement 規則，不處理 package 販售組裝。"
      : "Create entitlement rules here, not package sales configuration.",
    edit: zh ? "編輯 plan 規則" : "Edit plan rule",
    editHint: zh
      ? "只維護穩定欄位：plan type、fulfillment、天數、次數、服務範圍、啟用狀態。"
      : "Only stable fields are managed here: plan type, fulfillment, duration, quantity, service scope, and active status.",
    code: zh ? "方案代碼" : "Plan code",
    name: zh ? "方案名稱" : "Plan name",
    description: zh ? "說明" : "Description",
    planType: zh ? "方案型態" : "Plan type",
    fulfillmentKind: zh ? "發放方式" : "Fulfillment kind",
    duration: zh ? "預設有效期（天）" : "Default duration (days)",
    quantity: zh ? "預設次數 / 堂數" : "Default quantity",
    autoRenew: zh ? "允許自動續約" : "Allow auto renew",
    activePlan: zh ? "啟用方案" : "Plan active",
    serviceScope: zh ? "適用服務" : "Service scope",
    allServices: zh ? "全部服務" : "All services",
    createAction: zh ? "建立規則" : "Create plan",
    updateAction: zh ? "儲存規則" : "Save rule",
    saving: zh ? "儲存中..." : "Saving...",
    refresh: zh ? "重新載入" : "Reload",
    reloading: zh ? "重新載入中..." : "Reloading...",
    list: zh ? "Plan 規則清單" : "Plan rules",
    listHint: zh
      ? "前台與 redemption 只消費這裡的規則結果，不在前台維護扣課規則。"
      : "Frontdesk and redemption consume the result of these rules, but do not maintain them.",
    noSelection: zh ? "請先從右側清單選一筆 plan。" : "Select a plan from the list first.",
    empty: zh ? "目前沒有 plan 規則。" : "No plans yet.",
    editAction: zh ? "載入編輯" : "Edit",
    activeBadge: zh ? "啟用中" : "Active",
    inactiveBadge: zh ? "停用中" : "Inactive",
    updatedAt: zh ? "最後更新" : "Updated",
    createdAt: zh ? "建立時間" : "Created",
    relation: zh ? "服務關聯" : "Service relation",
    status: zh ? "狀態" : "Status",
    outOfScope: zh ? "不在本頁範圍" : "Out of scope for this page",
    outOfScopeHint: zh
      ? "以下責任已明確移交給其他後台頁，不在 plans 頁處理。"
      : "The following responsibilities are handled on other manager pages, not on the plans page.",
    scope1: zh ? "服務主資料：請到 Services。" : "Service master data: use Services.",
    scope2: zh ? "Packages / bundle 組裝：請到 Packages。" : "Packages and bundle composition: use Packages.",
    scope3: zh ? "排班 / block：請到 Coach Slots。" : "Staffing availability and blocks: use Coach Slots.",
    scope4: zh ? "營運與權限政策：請到 Operations & Permissions。" : "Operations and permission policies: use Operations & Permissions.",
    scope5: zh ? "前台排課建立流程：維持在 Frontdesk Bookings。" : "Frontdesk booking creation remains in Frontdesk Bookings.",
    loadFailed: zh ? "載入 plan 規則失敗" : "Load plans failed",
    servicesLoadFailed: zh ? "載入服務清單失敗" : "Load services failed",
    saveFailed: zh ? "儲存 plan 規則失敗" : "Save plan failed",
    updateFailed: zh ? "更新 plan 規則失敗" : "Update plan failed",
    saved: zh ? "方案已儲存" : "Plan saved",
    updated: zh ? "方案已更新" : "Plan updated",
  };

  const [items, setItems] = useState<PlanItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [summary, setSummary] = useState({
    totalPlans: 0,
    activePlans: 0,
    inactivePlans: 0,
    expiringSoon: 0,
    expired: 0,
    exhausted: 0,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [code, setCode] = useState("monthly_standard");
  const [name, setName] = useState("Monthly Standard");
  const [description, setDescription] = useState("");
  const [planType, setPlanType] = useState<PlanType>("subscription");
  const [fulfillmentKind, setFulfillmentKind] = useState<FulfillmentKind>("subscription");
  const [defaultDurationDays, setDefaultDurationDays] = useState("30");
  const [defaultQuantity, setDefaultQuantity] = useState("");
  const [allowAutoRenew, setAllowAutoRenew] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [createServiceScope, setCreateServiceScope] = useState<string[]>([]);

  const [selectedId, setSelectedId] = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [selectedDescription, setSelectedDescription] = useState("");
  const [selectedPlanType, setSelectedPlanType] = useState<PlanType>("subscription");
  const [selectedFulfillmentKind, setSelectedFulfillmentKind] = useState<FulfillmentKind>("subscription");
  const [selectedDurationDays, setSelectedDurationDays] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState("");
  const [selectedAutoRenew, setSelectedAutoRenew] = useState(false);
  const [selectedActive, setSelectedActive] = useState(true);
  const [selectedServiceScope, setSelectedServiceScope] = useState<string[]>([]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const byCode = useMemo(() => {
    const map = new Map<string, PlanItem>();
    for (const item of items) map.set(item.code, item);
    return map;
  }, [items]);

  function bindSelected(item: PlanItem) {
    setSelectedId(item.id);
    setSelectedCode(item.code);
    setSelectedName(item.name);
    setSelectedDescription(item.description || "");
    setSelectedPlanType(item.planType);
    setSelectedFulfillmentKind(item.fulfillmentKind);
    setSelectedDurationDays(item.defaultDurationDays === null ? "" : String(item.defaultDurationDays));
    setSelectedQuantity(item.defaultQuantity === null ? "" : String(item.defaultQuantity));
    setSelectedAutoRenew(item.allowAutoRenew);
    setSelectedActive(item.isActive);
    setSelectedServiceScope(sortCodes(item.serviceScope || []));
  }

  function toggleCode(list: string[], codeValue: string) {
    return list.includes(codeValue)
      ? list.filter((entry) => entry !== codeValue)
      : sortCodes([...list, codeValue]);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [plansRes, servicesRes] = await Promise.all([
        fetch("/api/manager/plans"),
        fetch("/api/manager/services"),
      ]);

      const plansPayload = (await plansRes.json().catch(() => null)) as Payload | null;
      const servicesPayload = (await servicesRes.json().catch(() => null)) as ServiceListPayload | null;

      if (!plansRes.ok || !plansPayload?.data) {
        setItems([]);
        setError(parseError(plansPayload, t.loadFailed));
        return;
      }
      if (!servicesRes.ok) {
        setError(servicesPayload?.error || t.servicesLoadFailed);
        return;
      }

      const nextItems = plansPayload.data.items || [];
      const nextServices = (servicesPayload?.items || []).sort((a, b) => a.name.localeCompare(b.name));
      setItems(nextItems);
      setServices(nextServices);
      setSummary(plansPayload.data.summary || summary);

      if (nextItems.length === 0) {
        setSelectedId("");
        return;
      }
      const nextSelected = nextItems.find((item) => item.id === selectedId) || nextItems[0];
      bindSelected(nextSelected);
    } catch {
      setItems([]);
      setServices([]);
      setError(t.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPlan(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/manager/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name,
        description: description || null,
        planType,
        fulfillmentKind,
        defaultDurationDays: defaultDurationDays ? Number(defaultDurationDays) : null,
        defaultQuantity: defaultQuantity ? Number(defaultQuantity) : null,
        serviceScope: createServiceScope,
        allowAutoRenew,
        isActive,
      }),
    });
    const payload = (await res.json().catch(() => null)) as Payload | null;
    if (!res.ok) {
      setError(parseError(payload, t.saveFailed));
      setSaving(false);
      return;
    }

    setMessage(`${t.saved}: ${code}`);
    const savedItem = payload?.data?.item || null;
    await load();
    if (savedItem) bindSelected(savedItem);
    setSaving(false);
  }

  async function updateSelected(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/manager/plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selectedId,
        name: selectedName,
        description: selectedDescription || null,
        planType: selectedPlanType,
        fulfillmentKind: selectedFulfillmentKind,
        defaultDurationDays: selectedDurationDays ? Number(selectedDurationDays) : null,
        defaultQuantity: selectedQuantity ? Number(selectedQuantity) : null,
        serviceScope: selectedServiceScope,
        allowAutoRenew: selectedAutoRenew,
        isActive: selectedActive,
      }),
    });
    const payload = (await res.json().catch(() => null)) as Payload | null;
    if (!res.ok) {
      setError(parseError(payload, t.updateFailed));
      setSaving(false);
      return;
    }

    setMessage(`${t.updated}: ${selectedCode}`);
    const updatedItem = payload?.data?.item || null;
    await load();
    if (updatedItem) bindSelected(updatedItem);
    setSaving(false);
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
            <p className="fdGlassText" data-plans-scope>
              {t.subtitle}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{t.back}</a>
        </p>

        {error ? (
          <div className="error" style={{ marginBottom: 12 }} data-plans-error>
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="ok" style={{ marginBottom: 12 }} data-plans-message>
            {message}
          </div>
        ) : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{t.total}</h3>
            <p className="h2" style={{ marginTop: 8 }} data-plans-total>
              {summary.totalPlans}
            </p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{t.active}</h3>
            <p className="h2" style={{ marginTop: 8 }} data-plans-active-count>
              {summary.activePlans}
            </p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{t.contracts}</h3>
            <p className="sub" style={{ marginTop: 8 }}>
              {summary.expiringSoon} / {summary.expired} / {summary.exhausted}
            </p>
          </article>
        </section>

        <section className="fdTwoCol">
          <form onSubmit={createPlan} className="fdGlassSubPanel" style={{ padding: 14 }} data-create-plan-form>
            <h2 className="sectionTitle">{t.create}</h2>
            <p className="fdGlassText" style={{ marginBottom: 10 }}>
              {t.createHint}
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t.code} required data-plan-create-code />
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} required data-plan-create-name />
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.description} data-plan-create-description />
              <select className="input" value={planType} onChange={(e) => setPlanType(e.target.value as PlanType)} data-plan-create-type>
                <option value="subscription">subscription</option>
                <option value="entry_pass">entry_pass</option>
                <option value="coach_pack">coach_pack</option>
                <option value="trial">trial</option>
              </select>
              <select className="input" value={fulfillmentKind} onChange={(e) => setFulfillmentKind(e.target.value as FulfillmentKind)} data-plan-create-fulfillment>
                <option value="subscription">subscription</option>
                <option value="entry_pass">entry_pass</option>
                <option value="none">none</option>
              </select>
              <input
                className="input"
                type="number"
                min="1"
                value={defaultDurationDays}
                onChange={(e) => setDefaultDurationDays(e.target.value)}
                placeholder={t.duration}
                data-plan-create-duration
              />
              <input
                className="input"
                type="number"
                min="0"
                value={defaultQuantity}
                onChange={(e) => setDefaultQuantity(e.target.value)}
                placeholder={t.quantity}
                data-plan-create-quantity
              />
              <div className="fdGlassText" data-plan-create-services>
                <div style={{ marginBottom: 6 }}>{t.serviceScope}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {services.map((service) => (
                    <label className="sub" key={service.id}>
                      <input
                        type="checkbox"
                        checked={createServiceScope.includes(service.code)}
                        onChange={() => setCreateServiceScope((current) => toggleCode(current, service.code))}
                        data-plan-create-service-option={service.code}
                      />{" "}
                      {service.name} ({service.code})
                    </label>
                  ))}
                  {services.length === 0 ? <div className="sub">{t.allServices}</div> : null}
                </div>
              </div>
              <label className="sub">
                <input type="checkbox" checked={allowAutoRenew} onChange={(e) => setAllowAutoRenew(e.target.checked)} data-plan-create-auto-renew />{" "}
                {t.autoRenew}
              </label>
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} data-plan-create-active />{" "}
                {t.activePlan}
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving} data-plan-create>
                {saving ? t.saving : byCode.has(code) ? t.updateAction : t.createAction}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? t.reloading : t.refresh}
              </button>
            </div>
          </form>

          <form onSubmit={updateSelected} className="fdGlassSubPanel" style={{ padding: 14 }} data-edit-plan-form>
            <h2 className="sectionTitle">{t.edit}</h2>
            <p className="fdGlassText" style={{ marginBottom: 10 }}>
              {t.editHint}
            </p>
            {selectedItem ? (
              <div style={{ display: "grid", gap: 8 }}>
                <input className="input" value={selectedCode} readOnly data-selected-plan-code />
                <input className="input" value={selectedName} onChange={(e) => setSelectedName(e.target.value)} required data-selected-plan-name />
                <input className="input" value={selectedDescription} onChange={(e) => setSelectedDescription(e.target.value)} data-selected-plan-description />
                <select className="input" value={selectedPlanType} onChange={(e) => setSelectedPlanType(e.target.value as PlanType)} data-selected-plan-type>
                  <option value="subscription">subscription</option>
                  <option value="entry_pass">entry_pass</option>
                  <option value="coach_pack">coach_pack</option>
                  <option value="trial">trial</option>
                </select>
                <select className="input" value={selectedFulfillmentKind} onChange={(e) => setSelectedFulfillmentKind(e.target.value as FulfillmentKind)} data-selected-plan-fulfillment>
                  <option value="subscription">subscription</option>
                  <option value="entry_pass">entry_pass</option>
                  <option value="none">none</option>
                </select>
                <input className="input" type="number" min="1" value={selectedDurationDays} onChange={(e) => setSelectedDurationDays(e.target.value)} data-selected-plan-duration />
                <input className="input" type="number" min="0" value={selectedQuantity} onChange={(e) => setSelectedQuantity(e.target.value)} data-selected-plan-quantity />
                <div className="fdGlassText" data-selected-plan-services>
                  <div style={{ marginBottom: 6 }}>{t.serviceScope}</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {services.map((service) => (
                      <label className="sub" key={service.id}>
                        <input
                          type="checkbox"
                          checked={selectedServiceScope.includes(service.code)}
                          onChange={() => setSelectedServiceScope((current) => toggleCode(current, service.code))}
                          data-selected-plan-service-option={service.code}
                        />{" "}
                        {service.name} ({service.code})
                      </label>
                    ))}
                  </div>
                </div>
                <label className="sub">
                  <input type="checkbox" checked={selectedAutoRenew} onChange={(e) => setSelectedAutoRenew(e.target.checked)} data-selected-plan-auto-renew />{" "}
                  {t.autoRenew}
                </label>
                <label className="sub">
                  <input type="checkbox" checked={selectedActive} onChange={(e) => setSelectedActive(e.target.checked)} data-selected-plan-active />{" "}
                  {t.activePlan}
                </label>
                <div className="fdGlassText">
                  <div data-selected-plan-created-at>
                    {t.createdAt}: {fmtTimestamp(selectedItem.createdAt)}
                  </div>
                  <div data-selected-plan-updated-at>
                    {t.updatedAt}: {fmtTimestamp(selectedItem.updatedAt)}
                  </div>
                </div>
                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving} data-plan-save>
                  {saving ? t.saving : t.updateAction}
                </button>
              </div>
            ) : (
              <p className="fdGlassText">{t.noSelection}</p>
            )}
          </form>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{t.list}</h2>
          <p className="fdGlassText" style={{ marginBottom: 10 }}>
            {t.listHint}
          </p>
          <div className="fdActionGrid" data-plans-list>
            {items.map((item) => (
              <article key={item.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }} data-plan-card data-plan-id={item.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{item.name}</h3>
                  <span className="pill" data-plan-active-badge={item.isActive ? "active" : "inactive"}>
                    {item.isActive ? t.activeBadge : t.inactiveBadge}
                  </span>
                </div>
                <p className="sub" style={{ marginTop: 8 }} data-plan-code-text>{item.code}</p>
                <p className="sub" style={{ marginTop: 2 }}>{item.planType} / {item.fulfillmentKind}</p>
                <p className="sub" style={{ marginTop: 2 }}>
                  {t.duration} / {t.quantity}: {item.defaultDurationDays ?? "-"} / {item.defaultQuantity ?? "-"}
                </p>
                <p className="sub" style={{ marginTop: 2 }} data-plan-service-scope>
                  {t.relation}: {item.serviceScope.length ? item.serviceScope.join(", ") : t.allServices}
                </p>
                <p className="sub" style={{ marginTop: 2 }}>{t.updatedAt}: {fmtTimestamp(item.updatedAt)}</p>
                <button type="button" className="fdPillBtn" style={{ marginTop: 8 }} onClick={() => bindSelected(item)} data-plan-edit>
                  {t.editAction}
                </button>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">{loading ? t.reloading : t.empty}</p> : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-plan-out-of-scope>
          <h2 className="sectionTitle">{t.outOfScope}</h2>
          <p className="fdGlassText" style={{ marginBottom: 10 }}>
            {t.outOfScopeHint}
          </p>
          <ul className="fdGlassText" style={{ margin: 0, paddingLeft: 18 }}>
            <li><a href="/manager/services">{t.scope1}</a></li>
            <li><a href="/manager/packages">{t.scope2}</a></li>
            <li><a href="/manager/coach-slots">{t.scope3}</a></li>
            <li><a href="/manager/settings/operations">{t.scope4}</a></li>
            <li>{t.scope5}</li>
          </ul>
        </section>
      </section>
    </main>
  );
}
