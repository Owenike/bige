"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

type PlanType = "subscription" | "entry_pass" | "coach_pack" | "trial";
type FulfillmentKind = "subscription" | "entry_pass" | "none";

type PlanItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  planType: PlanType;
  fulfillmentKind: FulfillmentKind;
  defaultDurationDays: number | null;
  defaultQuantity: number | null;
  allowAutoRenew: boolean;
  isActive: boolean;
  updatedAt: string;
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

function parseError(payload: Payload | null, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error && typeof payload.error.message === "string") return payload.error.message;
  return fallback;
}

export default function ManagerPlansPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [items, setItems] = useState<PlanItem[]>([]);
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

  const [selectedId, setSelectedId] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [selectedDescription, setSelectedDescription] = useState("");
  const [selectedPlanType, setSelectedPlanType] = useState<PlanType>("subscription");
  const [selectedFulfillmentKind, setSelectedFulfillmentKind] = useState<FulfillmentKind>("subscription");
  const [selectedDurationDays, setSelectedDurationDays] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState("");
  const [selectedAutoRenew, setSelectedAutoRenew] = useState(false);
  const [selectedActive, setSelectedActive] = useState(true);

  const byCode = useMemo(() => {
    const map = new Map<string, PlanItem>();
    for (const item of items) map.set(item.code, item);
    return map;
  }, [items]);

  function bindSelected(item: PlanItem) {
    setSelectedId(item.id);
    setSelectedName(item.name);
    setSelectedDescription(item.description || "");
    setSelectedPlanType(item.planType);
    setSelectedFulfillmentKind(item.fulfillmentKind);
    setSelectedDurationDays(item.defaultDurationDays === null ? "" : String(item.defaultDurationDays));
    setSelectedQuantity(item.defaultQuantity === null ? "" : String(item.defaultQuantity));
    setSelectedAutoRenew(item.allowAutoRenew);
    setSelectedActive(item.isActive);
  }

  async function load() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/manager/plans");
    const payload = (await res.json().catch(() => null)) as Payload | null;
    if (!res.ok || !payload?.data) {
      setError(parseError(payload, zh ? "載入方案失敗" : "Load plans failed"));
      setLoading(false);
      return;
    }
    const nextItems = payload.data.items || [];
    setItems(nextItems);
    setSummary(payload.data.summary || summary);
    if (nextItems.length > 0 && !selectedId) {
      bindSelected(nextItems[0]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createOrUpsert(event: FormEvent) {
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
        allowAutoRenew,
        isActive,
      }),
    });
    const payload = (await res.json().catch(() => null)) as Payload | null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "儲存方案失敗" : "Save plan failed"));
      setSaving(false);
      return;
    }
    setMessage(zh ? "方案已儲存" : "Plan saved");
    await load();
    const latest = byCode.get(code);
    if (latest) bindSelected(latest);
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
        allowAutoRenew: selectedAutoRenew,
        isActive: selectedActive,
      }),
    });
    const payload = (await res.json().catch(() => null)) as Payload | null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "更新方案失敗" : "Update plan failed"));
      setSaving(false);
      return;
    }
    setMessage(zh ? "方案已更新" : "Plan updated");
    await load();
    setSaving(false);
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "會員方案" : "MEMBER PLANS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "方案 / 合約生命週期" : "Plan Lifecycle"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "管理方案目錄、權益發放規則與到期使用狀態，並與訂單付款流程保持一致。"
                : "Manage catalog, entitlement grant rules, and expiry lifecycle while keeping order/payment flow intact."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "返回管理儀表板" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "方案總數" : "Total Plans"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{summary.totalPlans}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "啟用中" : "Active"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{summary.activePlans}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "14 天到期 / 已到期 / 用盡" : "Expiring / Expired / Exhausted"}</h3>
            <p className="sub" style={{ marginTop: 8 }}>{summary.expiringSoon} / {summary.expired} / {summary.exhausted}</p>
          </article>
        </section>

        <section className="fdTwoCol">
          <form onSubmit={createOrUpsert} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "建立方案" : "Create Plan"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" required />
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={zh ? "方案名稱" : "plan name"} required />
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={zh ? "說明" : "description"} />
              <select className="input" value={planType} onChange={(e) => setPlanType(e.target.value as PlanType)}>
                <option value="subscription">{zh ? "月費 / 訂閱" : "subscription"}</option>
                <option value="entry_pass">{zh ? "次數票" : "entry_pass"}</option>
                <option value="coach_pack">{zh ? "教練課堂數包" : "coach_pack"}</option>
                <option value="trial">{zh ? "體驗方案" : "trial"}</option>
              </select>
              <select className="input" value={fulfillmentKind} onChange={(e) => setFulfillmentKind(e.target.value as FulfillmentKind)}>
                <option value="subscription">{zh ? "發放到會籍" : "subscription grant"}</option>
                <option value="entry_pass">{zh ? "發放到票券堂數" : "entry pass grant"}</option>
                <option value="none">{zh ? "僅記錄合約" : "contract only"}</option>
              </select>
              <input
                className="input"
                type="number"
                min="1"
                value={defaultDurationDays}
                onChange={(e) => setDefaultDurationDays(e.target.value)}
                placeholder={zh ? "預設天數 (可空)" : "default duration days (optional)"}
              />
              <input
                className="input"
                type="number"
                min="0"
                value={defaultQuantity}
                onChange={(e) => setDefaultQuantity(e.target.value)}
                placeholder={zh ? "預設次數/堂數 (可空)" : "default quantity (optional)"}
              />
              <label className="sub">
                <input type="checkbox" checked={allowAutoRenew} onChange={(e) => setAllowAutoRenew(e.target.checked)} />{" "}
                {zh ? "允許自動續約" : "allow auto renew"}
              </label>
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />{" "}
                {zh ? "啟用方案" : "plan active"}
              </label>
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>
              {saving ? (zh ? "儲存中..." : "Saving...") : byCode.has(code) ? (zh ? "覆蓋更新" : "Upsert") : zh ? "建立方案" : "Create Plan"}
            </button>
          </form>

          <form onSubmit={updateSelected} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "編輯方案" : "Edit Plan"}</h2>
            {selectedId ? (
              <div style={{ display: "grid", gap: 8 }}>
                <input className="input" value={selectedId} readOnly />
                <input className="input" value={selectedName} onChange={(e) => setSelectedName(e.target.value)} required />
                <input className="input" value={selectedDescription} onChange={(e) => setSelectedDescription(e.target.value)} />
                <select className="input" value={selectedPlanType} onChange={(e) => setSelectedPlanType(e.target.value as PlanType)}>
                  <option value="subscription">{zh ? "月費 / 訂閱" : "subscription"}</option>
                  <option value="entry_pass">{zh ? "次數票" : "entry_pass"}</option>
                  <option value="coach_pack">{zh ? "教練課堂數包" : "coach_pack"}</option>
                  <option value="trial">{zh ? "體驗方案" : "trial"}</option>
                </select>
                <select className="input" value={selectedFulfillmentKind} onChange={(e) => setSelectedFulfillmentKind(e.target.value as FulfillmentKind)}>
                  <option value="subscription">{zh ? "發放到會籍" : "subscription grant"}</option>
                  <option value="entry_pass">{zh ? "發放到票券堂數" : "entry pass grant"}</option>
                  <option value="none">{zh ? "僅記錄合約" : "contract only"}</option>
                </select>
                <input className="input" type="number" min="1" value={selectedDurationDays} onChange={(e) => setSelectedDurationDays(e.target.value)} />
                <input className="input" type="number" min="0" value={selectedQuantity} onChange={(e) => setSelectedQuantity(e.target.value)} />
                <label className="sub">
                  <input type="checkbox" checked={selectedAutoRenew} onChange={(e) => setSelectedAutoRenew(e.target.checked)} />{" "}
                  {zh ? "允許自動續約" : "allow auto renew"}
                </label>
                <label className="sub">
                  <input type="checkbox" checked={selectedActive} onChange={(e) => setSelectedActive(e.target.checked)} />{" "}
                  {zh ? "啟用方案" : "plan active"}
                </label>
                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                  {saving ? (zh ? "更新中..." : "Updating...") : zh ? "儲存變更" : "Save Changes"}
                </button>
              </div>
            ) : (
              <p className="fdGlassText">{zh ? "請先從下方清單選擇方案。" : "Select a plan from list below first."}</p>
            )}
          </form>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "方案清單" : "Plans"}</h2>
          <div className="fdActionGrid">
            {items.map((item) => (
              <article key={item.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{item.name}</h3>
                <p className="sub" style={{ marginTop: 8 }}>{item.code}</p>
                <p className="sub" style={{ marginTop: 2 }}>{item.planType} / {item.fulfillmentKind}</p>
                <p className="sub" style={{ marginTop: 2 }}>
                  {zh ? "天數 / 數量" : "days / quantity"}: {item.defaultDurationDays ?? "-"} / {item.defaultQuantity ?? "-"}
                </p>
                <p className="sub" style={{ marginTop: 2 }}>
                  {zh ? "狀態" : "status"}: {item.isActive ? (zh ? "啟用" : "active") : (zh ? "停用" : "inactive")}
                </p>
                <button type="button" className="fdPillBtn" style={{ marginTop: 8 }} onClick={() => bindSelected(item)}>
                  {zh ? "載入編輯" : "Edit"}
                </button>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">{loading ? (zh ? "載入中..." : "Loading...") : zh ? "目前沒有方案。" : "No plans yet."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}

