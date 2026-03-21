"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ManagerPackageTemplateItem, ManagerPackagesResponse } from "../../../types/booking-commerce";
import { useI18n } from "../../i18n-provider";

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string } | string;
  message?: string;
};

type ServiceItem = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type ServiceListPayload = {
  items?: ServiceItem[];
  error?: string;
};

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as ApiEnvelope<unknown>;
  if (typeof body.error === "string" && body.error) return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") return body.error.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

async function requestJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | T | null;
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, "Request failed"));
  }
  if (payload && typeof payload === "object" && "data" in payload && payload.data) {
    return payload.data as T;
  }
  return payload as T;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function sortCodes(codes: string[]) {
  return [...codes].sort((a, b) => a.localeCompare(b));
}

export default function ManagerPackagesPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const t = {
    eyebrow: zh ? "販售配置 / 套裝模板" : "PACKAGE CONFIGURATION",
    title: zh ? "Packages" : "Packages",
    subtitle: zh
      ? "這一頁只處理 package template / bundle 銷售層：方案代碼、售價、包含堂數、有效期、適用服務與啟用狀態。"
      : "This page manages package templates and sale-layer bundle configuration: code, price, included sessions, validity, service scope, and active status.",
    back: zh ? "返回後台總覽" : "Back to dashboard",
    total: zh ? "模板總數" : "Total templates",
    active: zh ? "上架中" : "Active",
    inactive: zh ? "下架中" : "Inactive",
    create: zh ? "建立 package template" : "Create package template",
    createHint: zh
      ? "這裡只配置銷售模板，不處理 plans 規則本體與已發行會員 package。"
      : "Configure sale templates here. Do not manage core plan rules or issued member packages on this page.",
    edit: zh ? "編輯 package template" : "Edit package template",
    editHint: zh
      ? "只維護穩定欄位：名稱、說明、模板型態、堂數、有效期、售價、服務範圍與啟用狀態。"
      : "Only stable fields are managed here: name, description, template type, sessions, validity, price, service scope, and active status.",
    code: zh ? "模板代碼" : "Template code",
    name: zh ? "模板名稱" : "Template name",
    description: zh ? "說明" : "Description",
    planType: zh ? "模板型態" : "Template type",
    totalSessions: zh ? "包含堂數" : "Included sessions",
    validDays: zh ? "有效期（天）" : "Valid days",
    priceAmount: zh ? "售價" : "Price amount",
    serviceScope: zh ? "適用服務" : "Service scope",
    activeTemplate: zh ? "上架模板" : "Template active",
    createAction: zh ? "建立模板" : "Create template",
    updateAction: zh ? "儲存模板" : "Save template",
    saving: zh ? "儲存中..." : "Saving...",
    refresh: zh ? "重新載入" : "Reload",
    reloading: zh ? "重新載入中..." : "Reloading...",
    list: zh ? "Package 模板清單" : "Package templates",
    listHint: zh
      ? "前台與購買流程只讀取這裡的模板結果，不在前台維護 bundle 配置。"
      : "Frontdesk and sales flows consume these template results, but do not maintain package configuration there.",
    noSelection: zh ? "請先從右側清單選一個 package template。" : "Select a package template from the list first.",
    empty: zh ? "目前沒有 package template。" : "No package templates yet.",
    editAction: zh ? "載入編輯" : "Edit",
    activeBadge: zh ? "上架中" : "Active",
    inactiveBadge: zh ? "下架中" : "Inactive",
    updatedAt: zh ? "最後更新" : "Updated",
    createdAt: zh ? "建立時間" : "Created",
    relation: zh ? "關聯到的 plan 規則層" : "Plan-layer relation",
    scopeLabel: zh ? "服務範圍" : "Service scope",
    allServices: zh ? "全部服務" : "All services",
    loadFailed: zh ? "載入 package template 失敗" : "Load package templates failed",
    saveFailed: zh ? "儲存 package template 失敗" : "Save package template failed",
    updateFailed: zh ? "更新 package template 失敗" : "Update package template failed",
    templateSaved: zh ? "模板已儲存" : "Template saved",
    templateUpdated: zh ? "模板已更新" : "Template updated",
    outOfScope: zh ? "不在本頁範圍" : "Out of scope for this page",
    outOfScopeHint: zh
      ? "以下責任已明確移交給其他頁面，不在 package template 頁處理。"
      : "The following responsibilities are handled on other pages, not on the package template page.",
    scope1: zh ? "plans 規則本體：請到 Plans。" : "Core entitlement rules: use Plans.",
    scope2: zh ? "服務主資料：請到 Services。" : "Service master data: use Services.",
    scope3: zh ? "排班 / block：請到 Coach Slots。" : "Staffing availability and blocks: use Coach Slots.",
    scope4: zh ? "營運與權限政策：請到 Operations & Permissions。" : "Operations and permission policies: use Operations & Permissions.",
    scope5: zh ? "已發行會員 packages：不在本頁維護。" : "Issued member packages are not maintained on this page.",
    entryPass: zh ? "單次 / 票券模板" : "Entry pass template",
    coachPack: zh ? "教練 / 課程包模板" : "Coach pack template",
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ManagerPackageTemplateItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const [form, setForm] = useState({
    code: "massage_pack_6",
    name: "Recovery Pack 6",
    description: "Six recovery sessions for repeat care.",
    planType: "coach_pack" as "entry_pass" | "coach_pack",
    totalSessions: "6",
    validDays: "90",
    priceAmount: "7800",
    serviceScope: [] as string[],
    isActive: true,
  });

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedId) || null,
    [selectedId, templates],
  );

  const stats = useMemo(() => {
    const total = templates.length;
    const active = templates.filter((item) => item.isActive).length;
    return { total, active, inactive: total - active };
  }, [templates]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [payload, servicesPayload] = await Promise.all([
        requestJson<ManagerPackagesResponse>("/api/manager/packages"),
        requestJson<ServiceListPayload>("/api/manager/services"),
      ]);
      setTemplates(payload.templates || []);
      setServices((servicesPayload.items || []).sort((a, b) => a.name.localeCompare(b.name)));

      const nextSelected = (payload.templates || []).find((item) => item.id === selectedId) || payload.templates?.[0] || null;
      if (nextSelected) {
        setSelectedId(nextSelected.id);
        setForm({
          code: nextSelected.code,
          name: nextSelected.name,
          description: nextSelected.description || "",
          planType: nextSelected.planType,
          totalSessions: String(nextSelected.totalSessions),
          validDays: nextSelected.validDays === null ? "" : String(nextSelected.validDays),
          priceAmount: String(nextSelected.priceAmount),
          serviceScope: sortCodes(nextSelected.serviceScope),
          isActive: nextSelected.isActive,
        });
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function bindTemplate(item: ManagerPackageTemplateItem) {
    setSelectedId(item.id);
    setForm({
      code: item.code,
      name: item.name,
      description: item.description || "",
      planType: item.planType,
      totalSessions: String(item.totalSessions),
      validDays: item.validDays === null ? "" : String(item.validDays),
      priceAmount: String(item.priceAmount),
      serviceScope: sortCodes(item.serviceScope),
      isActive: item.isActive,
    });
  }

  function toggleServiceScope(code: string) {
    setForm((current) => ({
      ...current,
      serviceScope: current.serviceScope.includes(code)
        ? current.serviceScope.filter((item) => item !== code)
        : sortCodes([...current.serviceScope, code]),
    }));
  }

  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await requestJson("/api/manager/packages", {
        method: "POST",
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          description: form.description || null,
          planType: form.planType,
          totalSessions: Number(form.totalSessions),
          validDays: form.validDays ? Number(form.validDays) : null,
          priceAmount: Number(form.priceAmount),
          serviceScope: form.serviceScope,
          isActive: form.isActive,
        }),
      });
      setMessage(`${t.templateSaved}: ${form.code}`);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function updateTemplate(event: FormEvent) {
    event.preventDefault();
    if (!selectedTemplate) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await requestJson("/api/manager/packages", {
        method: "PATCH",
        body: JSON.stringify({
          id: selectedTemplate.id,
          name: form.name,
          description: form.description || null,
          totalSessions: Number(form.totalSessions),
          validDays: form.validDays ? Number(form.validDays) : null,
          priceAmount: Number(form.priceAmount),
          serviceScope: form.serviceScope,
          isActive: form.isActive,
        }),
      });
      setMessage(`${t.templateUpdated}: ${selectedTemplate.code}`);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t.updateFailed);
    } finally {
      setSaving(false);
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
            <p className="fdGlassText" data-packages-scope>
              {t.subtitle}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{t.back}</a>
        </p>

        {error ? (
          <div className="error" style={{ marginBottom: 12 }} data-packages-error>
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="ok" style={{ marginBottom: 12 }} data-packages-message>
            {message}
          </div>
        ) : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{t.total}</h3>
            <p className="h2" style={{ marginTop: 8 }} data-packages-total>{stats.total}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{t.active}</h3>
            <p className="h2" style={{ marginTop: 8 }} data-packages-active-count>{stats.active}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{t.inactive}</h3>
            <p className="h2" style={{ marginTop: 8 }} data-packages-inactive-count>{stats.inactive}</p>
          </article>
        </section>

        <section className="fdTwoCol">
          <form onSubmit={createTemplate} className="fdGlassSubPanel" style={{ padding: 14 }} data-create-package-form>
            <h2 className="sectionTitle">{t.create}</h2>
            <p className="fdGlassText" style={{ marginBottom: 10 }}>{t.createHint}</p>
            <div style={{ display: "grid", gap: 8 }}>
              <input className="input" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} placeholder={t.code} required data-package-create-code />
              <input className="input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={t.name} required data-package-create-name />
              <input className="input" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t.description} data-package-create-description />
              <select className="input" value={form.planType} onChange={(event) => setForm((current) => ({ ...current, planType: event.target.value as "entry_pass" | "coach_pack" }))} data-package-create-type>
                <option value="coach_pack">{t.coachPack}</option>
                <option value="entry_pass">{t.entryPass}</option>
              </select>
              <input className="input" type="number" min="1" value={form.totalSessions} onChange={(event) => setForm((current) => ({ ...current, totalSessions: event.target.value }))} placeholder={t.totalSessions} data-package-create-total />
              <input className="input" type="number" min="1" value={form.validDays} onChange={(event) => setForm((current) => ({ ...current, validDays: event.target.value }))} placeholder={t.validDays} data-package-create-validity />
              <input className="input" type="number" min="0" value={form.priceAmount} onChange={(event) => setForm((current) => ({ ...current, priceAmount: event.target.value }))} placeholder={t.priceAmount} data-package-create-price />
              <div className="fdGlassText" data-package-create-services>
                <div style={{ marginBottom: 6 }}>{t.serviceScope}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {services.map((service) => (
                    <label className="sub" key={service.id}>
                      <input
                        type="checkbox"
                        checked={form.serviceScope.includes(service.code)}
                        onChange={() => toggleServiceScope(service.code)}
                        data-package-create-service-option={service.code}
                      />{" "}
                      {service.name} ({service.code})
                    </label>
                  ))}
                  {services.length === 0 ? <div className="sub">{t.allServices}</div> : null}
                </div>
              </div>
              <label className="sub">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} data-package-create-active />{" "}
                {t.activeTemplate}
              </label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 0 }} disabled={saving} data-package-create>
                {saving ? t.saving : t.createAction}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? t.reloading : t.refresh}
              </button>
            </div>
          </form>

          <form onSubmit={updateTemplate} className="fdGlassSubPanel" style={{ padding: 14 }} data-edit-package-form>
            <h2 className="sectionTitle">{t.edit}</h2>
            <p className="fdGlassText" style={{ marginBottom: 10 }}>{t.editHint}</p>
            {!selectedTemplate ? (
              <p className="fdGlassText">{t.noSelection}</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <input className="input" value={selectedTemplate.code} readOnly data-selected-package-code />
                <input className="input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required data-selected-package-name />
                <input className="input" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} data-selected-package-description />
                <input className="input" value={form.planType === "coach_pack" ? t.coachPack : t.entryPass} readOnly data-selected-package-plan-type />
                <input className="input" type="number" min="1" value={form.totalSessions} onChange={(event) => setForm((current) => ({ ...current, totalSessions: event.target.value }))} data-selected-package-total />
                <input className="input" type="number" min="1" value={form.validDays} onChange={(event) => setForm((current) => ({ ...current, validDays: event.target.value }))} data-selected-package-validity />
                <input className="input" type="number" min="0" value={form.priceAmount} onChange={(event) => setForm((current) => ({ ...current, priceAmount: event.target.value }))} data-selected-package-price />
                <div className="fdGlassText" data-selected-package-services>
                  <div style={{ marginBottom: 6 }}>{t.serviceScope}</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {services.map((service) => (
                      <label className="sub" key={service.id}>
                        <input
                          type="checkbox"
                          checked={form.serviceScope.includes(service.code)}
                          onChange={() => toggleServiceScope(service.code)}
                          data-selected-package-service-option={service.code}
                        />{" "}
                        {service.name} ({service.code})
                      </label>
                    ))}
                  </div>
                </div>
                <label className="sub">
                  <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} data-selected-package-active />{" "}
                  {t.activeTemplate}
                </label>
                <div className="fdGlassText">
                  <div data-selected-package-created-at>{t.createdAt}: {formatDateTime(selectedTemplate.createdAt)}</div>
                  <div data-selected-package-updated-at>{t.updatedAt}: {formatDateTime(selectedTemplate.updatedAt)}</div>
                </div>
                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving} data-package-save>
                  {saving ? t.saving : t.updateAction}
                </button>
              </div>
            )}
          </form>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{t.list}</h2>
          <p className="fdGlassText" style={{ marginBottom: 10 }}>{t.listHint}</p>
          <div className="fdActionGrid" data-packages-list>
            {templates.map((item) => (
              <article
                key={item.id}
                className="fdGlassSubPanel fdActionCard"
                style={{ padding: 12 }}
                data-package-card
                data-package-id={item.id}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{item.name}</h3>
                  <span className="pill" data-package-active-badge={item.isActive ? "active" : "inactive"}>
                    {item.isActive ? t.activeBadge : t.inactiveBadge}
                  </span>
                </div>
                <p className="sub" style={{ marginTop: 4 }} data-package-code-text>{item.code}</p>
                <p className="sub" style={{ marginTop: 4 }}>
                  {item.totalSessions} sessions | {item.validDays ?? "-"} days | {formatMoney(item.priceAmount)}
                </p>
                <p className="sub" style={{ marginTop: 4 }} data-package-plan-relation>
                  {t.relation}: {item.planType} / {item.fulfillmentKind}
                </p>
                <p className="sub" style={{ marginTop: 4 }} data-package-service-scope>
                  {t.scopeLabel}: {item.serviceScope.length ? item.serviceScope.join(", ") : t.allServices}
                </p>
                <p className="sub" style={{ marginTop: 4 }}>{t.updatedAt}: {formatDateTime(item.updatedAt)}</p>
                <button type="button" className="fdPillBtn" style={{ marginTop: 8 }} onClick={() => bindTemplate(item)} data-package-edit>
                  {t.editAction}
                </button>
              </article>
            ))}
            {!templates.length ? <div className="fdGlassText">{loading ? t.reloading : t.empty}</div> : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-package-out-of-scope>
          <h2 className="sectionTitle">{t.outOfScope}</h2>
          <p className="fdGlassText" style={{ marginBottom: 10 }}>{t.outOfScopeHint}</p>
          <ul className="fdGlassText" style={{ margin: 0, paddingLeft: 18 }}>
            <li><a href="/manager/plans">{t.scope1}</a></li>
            <li><a href="/manager/services">{t.scope2}</a></li>
            <li><a href="/manager/coach-slots">{t.scope3}</a></li>
            <li><a href="/manager/settings/operations">{t.scope4}</a></li>
            <li>{t.scope5}</li>
          </ul>
        </section>
      </section>
    </main>
  );
}
