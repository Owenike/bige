"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

type TenantItem = {
  id: string;
  name: string;
  status: string;
};

type BillingItem = {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  paidAmount: number;
  refundedAmount: number;
  netAmount: number;
  paidPayments: number;
  refundedPayments: number;
  ordersPaid: number;
  ordersPending: number;
  activeSubscriptions: number;
  expiringIn14Days: number;
  collectionRate: number;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  subscriptionStartsAt: string | null;
  subscriptionEndsAt: string | null;
  subscriptionGraceEndsAt: string | null;
  subscriptionRemainingDays: number | null;
  subscriptionUsable: boolean;
  subscriptionAccessCode: string | null;
};

type BillingPayload = {
  range: { since: string; until: string; days: number };
  items: BillingItem[];
  totals: {
    paidAmount: number;
    refundedAmount: number;
    netAmount: number;
    paidPayments: number;
    refundedPayments: number;
    activeSubscriptions: number;
    expiringIn14Days: number;
    usableTenants: number;
  };
  expiring: Array<{
    tenantId: string;
    tenantName: string;
    memberId: string;
    memberName: string;
    validTo: string | null;
  }>;
};

type SubscriptionPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type SubscriptionItem = {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  subscriptionId: string | null;
  planCode: string | null;
  planName: string | null;
  status: string | null;
  startsAt: string | null;
  endsAt: string | null;
  graceEndsAt: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  remainingDays: number | null;
  isUsable: boolean;
  blockedCode: string | null;
  warningCode: string | null;
};

type SubscriptionPayload = {
  items: SubscriptionItem[];
  plans: SubscriptionPlan[];
};

type ApiEnvelope<TData> = {
  ok?: boolean;
  data?: TData;
  error?: { code?: string; message?: string } | string;
  message?: string;
  [key: string]: unknown;
};

function formatDateTime(value: string | null, locale: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(locale);
}

function isoDateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toIsoFromDateInput(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as ApiEnvelope<Record<string, unknown>>;
  if (typeof record.error === "string" && record.error) return record.error;
  if (record.error && typeof record.error === "object") {
    const message = (record.error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  if (typeof record.message === "string" && record.message) return record.message;
  return fallback;
}

export default function PlatformBillingPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [days, setDays] = useState("30");
  const [data, setData] = useState<BillingPayload | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);

  const [manageTenantId, setManageTenantId] = useState("");
  const [managePlanCode, setManagePlanCode] = useState("");
  const [manageStatus, setManageStatus] = useState("active");
  const [manageStartsAt, setManageStartsAt] = useState("");
  const [manageEndsAt, setManageEndsAt] = useState("");
  const [manageGraceEndsAt, setManageGraceEndsAt] = useState("");
  const [manageNotes, setManageNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedSubscription = useMemo(
    () => subscriptions.find((item) => item.tenantId === manageTenantId) || null,
    [subscriptions, manageTenantId],
  );

  useEffect(() => {
    if (!selectedSubscription) return;
    setManagePlanCode(selectedSubscription.planCode || plans[0]?.code || "");
    setManageStatus(selectedSubscription.status || "active");
    setManageStartsAt(isoDateInput(selectedSubscription.startsAt));
    setManageEndsAt(isoDateInput(selectedSubscription.endsAt));
    setManageGraceEndsAt(isoDateInput(selectedSubscription.graceEndsAt));
    setManageNotes(selectedSubscription.notes || "");
  }, [selectedSubscription, plans]);

  async function loadTenants() {
    const res = await fetch("/api/platform/tenants");
    const payload = (await res.json().catch(() => null)) as ApiEnvelope<{ items?: TenantItem[] }> | null;
    if (!res.ok) throw new Error(errorMessage(payload, zh ? "載入租戶失敗" : "Load tenants failed"));
    const list = payload?.data?.items || (payload?.items as TenantItem[] | undefined) || [];
    setTenants(list);
    const nextTenant = tenantId || list[0]?.id || "";
    setTenantId(nextTenant);
    setManageTenantId((prev) => prev || nextTenant);
  }

  async function loadBilling(nextTenantId?: string, nextDays?: string) {
    const useTenant = nextTenantId ?? tenantId;
    const useDays = nextDays ?? days;
    const params = new URLSearchParams();
    if (useTenant) params.set("tenantId", useTenant);
    params.set("days", useDays);
    const res = await fetch(`/api/platform/billing?${params.toString()}`);
    const payload = (await res.json().catch(() => null)) as ApiEnvelope<BillingPayload> | null;
    if (!res.ok) throw new Error(errorMessage(payload, zh ? "載入計費失敗" : "Load billing failed"));
    const nextData = (payload?.data || payload) as BillingPayload;
    setData(nextData);
  }

  async function loadSubscriptions(nextTenantId?: string) {
    const params = new URLSearchParams();
    const useTenant = nextTenantId ?? "";
    if (useTenant) params.set("tenantId", useTenant);
    const res = await fetch(`/api/platform/subscriptions?${params.toString()}`);
    const payload = (await res.json().catch(() => null)) as ApiEnvelope<SubscriptionPayload> | null;
    if (!res.ok) throw new Error(errorMessage(payload, zh ? "載入訂閱失敗" : "Load subscriptions failed"));
    const nextData = (payload?.data || payload) as SubscriptionPayload;
    setPlans(nextData.plans || []);
    setSubscriptions(nextData.items || []);
    if (!manageTenantId && nextData.items?.length) {
      setManageTenantId(nextData.items[0].tenantId);
    }
    if (!managePlanCode && nextData.plans?.length) {
      setManagePlanCode(nextData.plans[0].code);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      await loadTenants();
      await Promise.all([loadBilling(), loadSubscriptions()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "載入失敗" : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSubscription() {
    if (!manageTenantId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body = {
        tenantId: manageTenantId,
        planCode: managePlanCode,
        status: manageStatus,
        startsAt: toIsoFromDateInput(manageStartsAt),
        endsAt: toIsoFromDateInput(manageEndsAt),
        graceEndsAt: toIsoFromDateInput(manageGraceEndsAt),
        notes: manageNotes || null,
      };
      const res = await fetch("/api/platform/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as ApiEnvelope<Record<string, unknown>> | null;
      if (!res.ok) throw new Error(errorMessage(payload, zh ? "儲存訂閱失敗" : "Save subscription failed"));
      setMessage(zh ? "租戶訂閱已更新" : "Subscription updated");
      await Promise.all([loadBilling(manageTenantId), loadSubscriptions(manageTenantId)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "儲存訂閱失敗" : "Save subscription failed");
    } finally {
      setSaving(false);
    }
  }

  async function runSubscriptionAction(action: "renew" | "enter_grace" | "suspend" | "restore") {
    if (!manageTenantId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body =
        action === "renew"
          ? { action, extendDays: 30 }
          : action === "enter_grace"
            ? { action, graceEndsAt: toIsoFromDateInput(manageGraceEndsAt) }
            : action === "restore"
              ? { action, endsAt: toIsoFromDateInput(manageEndsAt) }
              : { action };

      const res = await fetch(`/api/platform/subscriptions/${encodeURIComponent(manageTenantId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as ApiEnvelope<Record<string, unknown>> | null;
      if (!res.ok) throw new Error(errorMessage(payload, zh ? "更新訂閱狀態失敗" : "Update subscription failed"));
      const actionLabel =
        action === "renew"
          ? zh
            ? "已續約"
            : "Renewed"
          : action === "enter_grace"
            ? zh
              ? "已設定寬限"
              : "Grace updated"
            : action === "suspend"
              ? zh
                ? "已停權"
                : "Suspended"
              : zh
                ? "已恢復"
                : "Restored";
      setMessage(actionLabel);
      await Promise.all([loadBilling(manageTenantId), loadSubscriptions(manageTenantId)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "更新訂閱狀態失敗" : "Update subscription failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "平台 / 訂閱與計費" : "PLATFORM / BILLING"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "租戶訂閱與計費總覽" : "Tenant Subscription & Billing"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "保留原計費統計，同時管理每個租戶方案、到期、寬限與停權狀態。"
                : "Keep billing analytics while managing tenant plans, expiry, grace period, and suspension."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "篩選" : "Filters"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <select className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
              <option value="">{zh ? "全部租戶" : "All tenants"}</option>
              {tenants.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <input className="input" value={days} onChange={(event) => setDays(event.target.value)} placeholder={zh ? "統計天數" : "days"} />
            <button
              type="button"
              className="fdPillBtn fdPillBtnPrimary"
              onClick={() => void Promise.all([loadBilling(), loadSubscriptions()])}
              disabled={loading}
            >
              {loading ? (zh ? "載入中..." : "Loading...") : (zh ? "更新" : "Refresh")}
            </button>
          </div>
        </section>

        <section className="fdInventorySummary" style={{ marginTop: 14 }}>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "總收款" : "Paid Total"}</div>
            <strong className="fdInventorySummaryValue">{data ? `NT$${data.totals.paidAmount}` : "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "總退款" : "Refunded Total"}</div>
            <strong className="fdInventorySummaryValue">{data ? `NT$${data.totals.refundedAmount}` : "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "淨收款" : "Net Total"}</div>
            <strong className="fdInventorySummaryValue">{data ? `NT$${data.totals.netAmount}` : "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "可用租戶" : "Usable Tenants"}</div>
            <strong className="fdInventorySummaryValue">{data ? data.totals.usableTenants : "-"}</strong>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "租戶計費與訂閱狀態" : "Tenant Billing & Subscription"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {(data?.items || []).map((item) => (
              <div key={item.tenantId} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  <strong>{item.tenantName}</strong> ({item.tenantStatus})
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "方案/狀態" : "plan/status"}: {item.planName || item.planCode || "-"} / {item.subscriptionStatus || "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "到期/寬限/剩餘天數" : "ends/grace/remaining"}:{" "}
                  {formatDateTime(item.subscriptionEndsAt, locale)} / {formatDateTime(item.subscriptionGraceEndsAt, locale)} /{" "}
                  {item.subscriptionRemainingDays ?? "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "可用狀態" : "access"}: {item.subscriptionUsable ? (zh ? "可用" : "usable") : (zh ? "不可用" : "blocked")}{" "}
                  {item.subscriptionAccessCode ? `(${item.subscriptionAccessCode})` : ""}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "收款/退款/淨額" : "paid/refunded/net"}: NT${item.paidAmount} / NT${item.refundedAmount} / NT${item.netAmount}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "已付訂單/待收訂單" : "paid/pending orders"}: {item.ordersPaid} / {item.ordersPending}
                </p>
              </div>
            ))}
            {!loading && (data?.items || []).length === 0 ? (
              <p className="fdGlassText">{zh ? "目前沒有可顯示的資料。" : "No data found."}</p>
            ) : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "租戶訂閱管理" : "Tenant Subscription Management"}</h2>
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <select value={manageTenantId} onChange={(event) => setManageTenantId(event.target.value)} className="input">
              {tenants.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <div className="fdThreeCol" style={{ gap: 10 }}>
              <select value={managePlanCode} onChange={(event) => setManagePlanCode(event.target.value)} className="input">
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.code}>{plan.name} ({plan.code})</option>
                ))}
              </select>
              <select value={manageStatus} onChange={(event) => setManageStatus(event.target.value)} className="input">
                <option value="trial">trial</option>
                <option value="active">active</option>
                <option value="grace">grace</option>
                <option value="suspended">suspended</option>
                <option value="expired">expired</option>
                <option value="canceled">canceled</option>
              </select>
              <input
                value={manageNotes}
                onChange={(event) => setManageNotes(event.target.value)}
                className="input"
                placeholder={zh ? "備註" : "notes"}
              />
            </div>
            <div className="fdThreeCol" style={{ gap: 10 }}>
              <input type="date" className="input" value={manageStartsAt} onChange={(event) => setManageStartsAt(event.target.value)} />
              <input type="date" className="input" value={manageEndsAt} onChange={(event) => setManageEndsAt(event.target.value)} />
              <input type="date" className="input" value={manageGraceEndsAt} onChange={(event) => setManageGraceEndsAt(event.target.value)} />
            </div>
            <div className="actions">
              <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={saving} onClick={() => void saveSubscription()}>
                {zh ? "建立/更新訂閱" : "Create/Update Subscription"}
              </button>
              <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void runSubscriptionAction("renew")}>
                {zh ? "續約 +30 天" : "Renew +30d"}
              </button>
              <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void runSubscriptionAction("enter_grace")}>
                {zh ? "進入寬限期" : "Enter Grace"}
              </button>
              <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void runSubscriptionAction("suspend")}>
                {zh ? "手動停權" : "Suspend"}
              </button>
              <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void runSubscriptionAction("restore")}>
                {zh ? "恢復啟用" : "Restore"}
              </button>
            </div>
            {selectedSubscription ? (
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "目前狀態" : "current"}: {selectedSubscription.status || "-"} |{" "}
                {zh ? "剩餘天數" : "remaining"}: {selectedSubscription.remainingDays ?? "-"} |{" "}
                {zh ? "可用" : "usable"}: {selectedSubscription.isUsable ? "yes" : "no"}{" "}
                {selectedSubscription.blockedCode ? `(${selectedSubscription.blockedCode})` : ""}
              </p>
            ) : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "即將到期訂閱 (14 天)" : "Expiring Subscriptions (14d)"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {(data?.expiring || []).map((row, idx) => (
              <p key={`${row.memberId}-${idx}`} className="sub" style={{ marginTop: 0 }}>
                {row.tenantName} | {row.memberName} ({row.memberId}) | {formatDateTime(row.validTo, locale)}
              </p>
            ))}
            {!loading && (data?.expiring || []).length === 0 ? (
              <p className="fdGlassText">{zh ? "未找到 14 天內到期訂閱。" : "No subscriptions expiring within 14 days."}</p>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
